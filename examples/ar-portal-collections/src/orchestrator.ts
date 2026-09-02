import type { Page } from "playwright"
import { CodexPortalAgent, type AgentAction, type BrowserMcp } from "./codex-agent.js"
import {
  actionLabels, arStatus, cashBucket, customers, decide, formatMoney, resolutionLabels,
  type Action, type CustomerSlug, type Finding, type Invoice,
} from "./domain.js"
import { createBrowserSession, pause, type BrowserSession } from "./execution.js"
import { adapters, bindBaseUrl, postToAr } from "./portal-adapters.js"
import type { Store } from "./store.js"

export interface OrchestratorOptions {
  /** `codex`: a Codex agent works each portal through MCP browser tools. `scripted`: hand-written Playwright flows (test fixture). */
  agentMode: "codex" | "scripted"
  browserMcp: BrowserMcp
  visible: boolean
  model?: string
  reasoningEffort?: string
}

const NO_PORTAL_ACTIONS: Action[] = ["match-remittance", "record-promise", "send-statement"]

export class CollectionsOrchestrator {
  private active = false
  private arSessionId?: string
  private readonly agent?: CodexPortalAgent

  constructor(private readonly store: Store, private readonly baseUrl: string, private readonly options: OrchestratorOptions = { agentMode: "scripted", browserMcp: "playwright", visible: false }) {
    if (options.agentMode === "codex") {
      this.agent = new CodexPortalAgent({
        baseUrl,
        mcp: options.browserMcp,
        visible: options.visible,
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        onEvent: (customer, event) => {
          for (const id of event.invoiceIds) {
            const invoice = this.store.invoice(id)
            if (invoice?.status === "queued") this.store.updateInvoice(id, { status: "checking" })
          }
          this.store.addEvent("agent", event.text, event.invoiceIds.length === 1 ? event.invoiceIds[0] : undefined, customer)
        },
      })
    }
  }

  isActive(): boolean {
    return this.active
  }

  describeWorker(): string {
    if (this.agent) return this.agent.describe()
    return process.env.EXECUTION_PROVIDER === "solari" ? "Scripted flows · Solari browser" : "Scripted flows · Local browser"
  }

  /** Works every customer in parallel — one browser (or one agent) per portal. */
  async runQueue(): Promise<void> {
    if (this.active) throw new Error("A collections run is already active")
    this.active = true
    this.store.setRunStatus("running")
    const slugs = [...new Set(this.store.snapshot().invoices.map((invoice) => invoice.customer))]
    const portals = slugs.filter((slug) => customers[slug].portal).length
    this.store.addEvent("system", `Collections run started — ${this.describeWorker().toLowerCase()} checking ${portals} customer portals in parallel`)

    const session = await createBrowserSession()
    this.arSessionId = session.sessionId
    if (session.sessionId) this.store.addEvent("system", `Solari browser session ${session.sessionId} opened for Corvus AR (recorded)`)
    try {
      const outcomes = await Promise.allSettled(slugs.map((slug) => this.workCustomer(session, slug)))
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected")
      if (failure) throw failure.reason
      this.store.setRunStatus("complete")
      this.store.addEvent("complete", "Run complete — every portal checked; concessions and no-portal accounts held for review")
    } catch (error) {
      for (const invoice of this.store.snapshot().invoices) {
        if (invoice.status === "checking") this.store.updateInvoice(invoice.id, { status: "queued" })
      }
      this.store.addEvent("system", `Worker stopped: ${error instanceof Error ? error.message : String(error)}`)
      this.store.setRunStatus("ready")
      throw error
    } finally {
      await session.close()
      this.active = false
    }
  }

  private async workCustomer(session: BrowserSession, slug: CustomerSlug): Promise<void> {
    const customer = customers[slug]
    const invoices = this.store.invoicesFor(slug).filter((invoice) => invoice.status === "queued")
    if (invoices.length === 0) return

    if (!customer.portal) {
      for (const invoice of invoices) this.recordFinding(invoice, "no-portal", "No AP portal on file", undefined)
      return
    }

    const page = await session.newPage()
    bindBaseUrl(page, this.baseUrl)
    try {
      this.store.addEvent("lookup", `Opening ${customer.portal} for ${customer.name} — ${invoices.length} invoices, ${formatMoney(invoices.reduce((sum, invoice) => sum + invoice.amount, 0))}`, undefined, slug)
      if (this.agent) await this.workWithAgent(page, slug, invoices)
      else for (const invoice of invoices) await this.checkScripted(page, invoice)
    } finally {
      await page.close()
    }
  }

  /** Records what the portal showed, applies policy, and either holds the invoice or returns the action to execute. */
  private recordFinding(invoice: Invoice, finding: Finding, detail: string, reference: string | undefined): Action | undefined {
    const decision = decide(finding, detail, invoice)
    this.store.updateInvoice(invoice.id, {
      finding,
      findingDetail: detail,
      portalReference: reference,
      cashBucket: cashBucket(finding),
      ...decision,
    })
    if (invoice.portal) {
      this.store.addEvent("decision", `${invoice.portal}: ${detail} → ${actionLabels[decision.recommendedAction]} (${Math.round(decision.confidence * 100)}%)`, invoice.id, invoice.customer)
    }
    if (decision.requiresApproval) {
      this.store.updateInvoice(invoice.id, { status: "needs-review" })
      const why = !invoice.portal ? `no portal — statement to ${invoice.apContact} needs approval`
        : invoice.amount >= 50_000 ? "above the $50k threshold"
        : finding === "unknown" ? "status could not be determined"
        : "possible concession"
      this.store.addEvent("approval", `Held for approval — ${why}`, invoice.id, invoice.customer)
      return undefined
    }
    return decision.recommendedAction
  }

  // ---- Codex agent mode ----

  private async workWithAgent(page: Page, slug: CustomerSlug, invoices: Invoice[]): Promise<void> {
    const agent = this.agent!
    const { results: lookups, sessionId: lookupSession } = await agent.lookup(slug, invoices)
    if (lookupSession) this.store.addEvent("system", `${customers[slug].portal}: Solari browser session ${lookupSession} closed — replay available`, undefined, slug)

    const pending: AgentAction[] = []
    for (const invoice of invoices) {
      if (lookupSession) this.store.updateInvoice(invoice.id, { lookupSession })
      const found = lookups.find((item) => item.invoiceId.toUpperCase() === invoice.id)
      const finding: Finding = found?.finding ?? "unknown"
      const detail = found?.detail || (found ? "No detail reported" : "Agent returned no result for this invoice")
      const action = this.recordFinding(this.store.invoice(invoice.id)!, finding, detail, found?.reference || undefined)
      if (!action) continue
      if (NO_PORTAL_ACTIONS.includes(action)) await this.finish(page, this.store.invoice(invoice.id)!, action, false)
      else pending.push({ invoice: this.store.invoice(invoice.id)!, action, detail })
    }

    if (pending.length === 0) return
    const { results, sessionId: actionSession } = await agent.act(slug, pending)
    if (actionSession) this.store.addEvent("system", `${customers[slug].portal}: Solari browser session ${actionSession} closed — replay available`, undefined, slug)
    for (const { invoice, action } of pending) {
      if (actionSession) this.store.updateInvoice(invoice.id, { actionSession })
      const result = results.find((item) => item.invoiceId.toUpperCase() === invoice.id)
      if (!result?.completed) {
        this.store.updateInvoice(invoice.id, { status: "needs-review", rationale: `${invoice.rationale} Agent could not complete “${actionLabels[action]}”: ${result?.note ?? "no result returned"}.` })
        this.store.addEvent("approval", `Held for review — agent could not complete ${actionLabels[action]}`, invoice.id, slug)
        continue
      }
      this.store.addEvent("action", `${actionLabels[action]} submitted in ${invoice.portal} — ${result.reference ? `ref ${result.reference}` : result.note}`, invoice.id, slug)
      await this.finish(page, this.store.invoice(invoice.id)!, action, false, result.reference || undefined)
    }
  }

  // ---- Scripted mode (test fixture) ----

  private async checkScripted(page: Page, invoice: Invoice): Promise<void> {
    const adapter = adapters[invoice.customer]
    if (!adapter) throw new Error(`No adapter for ${invoice.customer}`)
    this.store.updateInvoice(invoice.id, { status: "checking" })
    const lookup = await adapter.lookup(page, invoice)
    const action = this.recordFinding(invoice, lookup.finding, lookup.detail, lookup.reference)
    if (!action) { await pause(page, 700); return }
    await this.executeScripted(page, this.store.invoice(invoice.id)!, action, false)
  }

  private async executeScripted(page: Page, invoice: Invoice, action: Action, approved: boolean): Promise<void> {
    const adapter = adapters[invoice.customer]
    let reference = invoice.portalReference
    if (adapter && action !== "send-statement") {
      const submitted = await adapter.act(page, invoice, action)
      if (submitted) {
        reference = submitted
        this.store.addEvent("action", `${actionLabels[action]} submitted in ${invoice.portal} — ref ${submitted}`, invoice.id, invoice.customer)
      }
    }
    await this.finish(page, invoice, action, approved, reference)
  }

  // ---- Shared: post to the supplier's AR system and close out ----

  private async finish(page: Page, invoice: Invoice, action: Action, approved: boolean, reference = invoice.portalReference): Promise<void> {
    const promiseDate = action === "record-promise" ? invoice.portalReference : undefined
    const note = `${approved ? "Approved by collector. " : ""}${invoice.rationale ?? ""}${reference ? ` Portal ref ${reference}.` : ""}`
    await postToAr(page, invoice, arStatus(action), reference, note, promiseDate)
    this.store.updateInvoice(invoice.id, { status: "done", resolution: resolutionLabels[action], confirmation: reference, note, arSession: this.arSessionId })
    this.store.addEvent("complete", `Corvus AR updated — ${resolutionLabels[action]}`, invoice.id, invoice.customer)
  }

  async approveInvoice(id: string): Promise<void> {
    const invoice = this.store.invoice(id)
    if (!invoice || invoice.status !== "needs-review" || !invoice.recommendedAction) throw new Error("Invoice is not awaiting approval")
    if (this.active) throw new Error("Wait for the current run to finish")

    this.active = true
    const session = await createBrowserSession()
    this.arSessionId = session.sessionId
    const page = await session.newPage()
    bindBaseUrl(page, this.baseUrl)
    try {
      const action = invoice.recommendedAction
      this.store.addEvent("approval", `Collector approved: ${actionLabels[action]}`, id, invoice.customer)
      if (this.agent && invoice.portal && !NO_PORTAL_ACTIONS.includes(action)) {
        const { results: [result], sessionId } = await this.agent.act(invoice.customer, [{ invoice, action, detail: invoice.findingDetail ?? "" }])
        if (sessionId) this.store.updateInvoice(id, { actionSession: sessionId })
        if (!result?.completed) throw new Error(`Agent could not complete ${actionLabels[action]} for ${id}: ${result?.note ?? "no result"}`)
        this.store.addEvent("action", `${actionLabels[action]} submitted in ${invoice.portal} — ${result.reference ? `ref ${result.reference}` : result.note}`, id, invoice.customer)
        await this.finish(page, invoice, action, true, result.reference || undefined)
      } else if (this.agent) {
        await this.finish(page, invoice, action, true)
      } else {
        const adapter = adapters[invoice.customer]
        if (adapter) await adapter.lookup(page, invoice)
        await this.executeScripted(page, invoice, action, true)
      }
    } catch (error) {
      this.store.addEvent("system", `Approval failed for ${id}: ${error instanceof Error ? error.message : String(error)}`, id, invoice.customer)
      throw error
    } finally {
      await page.close()
      await session.close()
      this.active = false
    }
  }

  rejectInvoice(id: string): void {
    const invoice = this.store.invoice(id)
    if (!invoice || invoice.status !== "needs-review") throw new Error("Invoice is not awaiting approval")
    this.store.updateInvoice(id, { status: "escalated", resolution: "Escalated to account manager", note: "Collector declined the proposed action; routed to the account manager." })
    this.store.addEvent("approval", "Collector declined the proposed action — escalated to the account manager", id, invoice.customer)
  }
}
