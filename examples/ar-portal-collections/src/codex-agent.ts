import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { customers, formatMoney, type Action, type CustomerSlug, type Finding, type Invoice } from "./domain.js"
import { publicUrl, redactToken } from "./public-url.js"

/**
 * Runs the Codex agent (`codex exec`) as the portal worker. Codex authenticates with the local
 * Codex login (ChatGPT subscription or CODEX_API_KEY); browser control comes from an MCP server —
 * Playwright MCP against local Chromium, or Solari's hosted MCP for cloud browsers.
 *
 * Policy stays in code (see domain.ts). The agent does perception and execution in portals it
 * has never seen: it reads the page, finds the invoice, interprets the portal's own wording, and
 * fills whatever forms that portal uses.
 */

export type BrowserMcp = "playwright" | "solari"

export interface AgentEvent {
  text: string
  invoiceIds: string[]
  tool?: string
}

export interface AgentConfig {
  baseUrl: string
  mcp: BrowserMcp
  visible: boolean
  model?: string
  reasoningEffort?: string
  codexBin?: string
  onEvent?: (customer: CustomerSlug | undefined, event: AgentEvent) => void
}

export type AgentFinding = Finding | "unknown"

export interface AgentLookup {
  invoiceId: string
  finding: AgentFinding
  detail: string
  reference: string
}

export interface AgentAction {
  invoice: Invoice
  action: Action
  detail: string
}

export interface AgentActionResult {
  invoiceId: string
  completed: boolean
  reference: string
  note: string
}

const directory = path.dirname(fileURLToPath(import.meta.url))
const INVOICE_ID = /INV-\d{5}/g

const lookupSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results", "browserSessionId"],
  properties: {
    browserSessionId: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["invoiceId", "finding", "detail", "reference"],
        properties: {
          invoiceId: { type: "string" },
          finding: { type: "string", enum: ["paid", "approved-scheduled", "pending-approval", "not-received", "rejected", "disputed", "unknown"] },
          detail: { type: "string" },
          reference: { type: "string" },
        },
      },
    },
  },
}

const actionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["results", "browserSessionId"],
  properties: {
    browserSessionId: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["invoiceId", "completed", "reference", "note"],
        properties: {
          invoiceId: { type: "string" },
          completed: { type: "boolean" },
          reference: { type: "string" },
          note: { type: "string" },
        },
      },
    },
  },
}

const probeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["heading", "toolsUsed", "browserSessionId"],
  properties: { heading: { type: "string" }, toolsUsed: { type: "array", items: { type: "string" } }, browserSessionId: { type: "string" } },
}

export function browserToolGuidance(mcp: BrowserMcp): string {
  if (mcp === "solari") {
    return `Browser tools: you are using Solari cloud-browser tools. Create ONE browser session at the start with solari_browser_create and the arguments {"mode":"fast","recording":true} (recording is required — the session replay is our audit trail), and reuse that session for every invoice. Navigate with the navigate tool and read pages with read_page; take a screenshot only when the page text is not enough. When you are completely done with this task, close the browser session (solari_browser_close) and report its session id in browserSessionId.`
  }
  return `Browser tools: use the browser_* tools (navigate, snapshot, click, type, select_option, press_key). Prefer snapshot over screenshots. Set browserSessionId to an empty string.`
}

export function buildLookupPrompt(customer: CustomerSlug, invoices: Invoice[], url: string, mcp: BrowserMcp = "playwright"): string {
  const info = customers[customer]
  const lines = invoices.map((invoice) => `- ${invoice.id} — PO ${invoice.poNumber} — ${formatMoney(invoice.amount)} — invoiced ${invoice.invoiceDate}, due ${invoice.dueDate} (${invoice.daysOverdue} days past due)`).join("\n")
  return `You are a collections specialist at Northbridge Industrial Supply. You are working inside ${info.name}'s accounts-payable portal ("${info.portal}") using the browser tools available to you. Open ${url} to begin — you are already signed in as the supplier (the URL carries an access token; open it exactly as given, then navigate normally within the site).

Check what the portal shows for each of these invoices we issued to ${info.name}:
${lines}

This step is READ-ONLY. Do not submit, create, resubmit, resend, comment, reply, or change anything — only look.

Every portal is different: explore its navigation to find where invoices are listed or searched (it may be a tab, a menu item, a search box, or a table you have to scan). Portals use their own vocabulary; map what you see to exactly one finding per invoice:
- paid — the buyer has paid. detail: the portal's wording including the payment/check reference and date. reference: the payment or check reference.
- approved-scheduled — approved with a payment date scheduled. detail: the portal's wording. reference: the scheduled payment date as YYYY-MM-DD.
- pending-approval — received but still waiting for the buyer's approval (in approval queue, awaiting approval, in routing, with approver…). detail: how long it has been waiting. reference: "".
- not-received — the portal has no record of this invoice at all (search returns nothing / it is not in the list). reference: "".
- rejected — the buyer rejected, returned, or failed validation on it. detail: the stated reason, verbatim. reference: "".
- disputed — the buyer opened a dispute, hold, or short-payment against it. detail: the reason and the withheld amount. reference: "".
- unknown — only if you genuinely cannot determine the status after a reasonable effort; explain why in detail.

Quote the portal's own wording in detail. Return exactly one entry per invoice listed above, in the required JSON shape.

${browserToolGuidance(mcp)}`
}

export function buildActionPrompt(customer: CustomerSlug, actions: AgentAction[], url: string, mcp: BrowserMcp = "playwright"): string {
  const info = customers[customer]
  const lines = actions.map(({ invoice, action, detail }) => {
    const head = `- ${invoice.id} (PO ${invoice.poNumber}, ${formatMoney(invoice.amount)}, invoice date ${invoice.invoiceDate}, ${invoice.daysOverdue} days past due):`
    switch (action) {
      case "request-status":
        return `${head} it is awaiting the buyer's approval. Post a status request to the buyer's AP team through whatever the portal offers (comment, message, reminder, status-update request). Message: "Following up on ${invoice.id} against PO ${invoice.poNumber}, now ${invoice.daysOverdue} days past due. Could you confirm the approval status and expected payment date? Thank you."`
      case "resubmit-invoice":
        return `${head} the portal has no record of it. Create / submit / key in the invoice against PO ${invoice.poNumber} for ${formatMoney(invoice.amount)}, invoice number ${invoice.id}, invoice date ${invoice.invoiceDate}.`
      case "correct-and-resubmit":
        return `${head} it was rejected: "${detail}". Correct the field named in the rejection using our records and resubmit / resend it.`
      case "respond-to-dispute":
        return `${head} it is disputed: "${detail}". Respond to the dispute with this message: "Our records for PO ${invoice.poNumber} support the invoiced amount: pricing and quantities match the PO as issued and delivery was signed for. PO copy and delivery proof attached — happy to reconcile line by line." Include or attach supporting documents wherever the portal offers it.`
      default:
        return `${head} no portal action.`
    }
  }).join("\n")

  return `Continue in ${info.name}'s portal (${url}). Now take the following actions, one invoice at a time. After each action, capture the confirmation / reference / document number the portal shows and put it in "reference". Do not act on any invoice that is not listed here.

${lines}

Our details for any form: supplier "Northbridge Industrial Supply"; invoice number = the invoice id; amount and PO number as listed; bill-to entity is ${info.name} — if the portal offers several entities, choose the buyer's master / primary record; invoice date as listed. Confirm any confirmation dialogs the portal shows.

Return exactly one entry per invoice listed above: completed (true only if the portal acknowledged the submission), reference (empty string if the portal showed none), and a short note describing what you did.

${browserToolGuidance(mcp)}`
}

/** Compact, human-readable one-liner for a Codex JSONL event. Returns undefined for noise. */
export function summarizeEvent(event: any): AgentEvent | undefined {
  const item = event?.item
  if (!item) {
    if (event?.type === "error") return { text: `Error: ${event.message ?? "unknown"}`, invoiceIds: [] }
    if (event?.type === "turn.failed") return { text: `Turn failed: ${event.error?.message ?? "unknown"}`, invoiceIds: [] }
    return undefined
  }
  if (event.type !== "item.completed" && !(event.type === "item.started" && item.type === "mcp_tool_call")) return undefined

  let text: string | undefined
  let tool: string | undefined
  if (item.type === "mcp_tool_call" && event.type === "item.started") {
    tool = String(item.tool ?? "tool")
    const args = redactToken(item.arguments ? JSON.stringify(item.arguments) : "")
    text = `${tool.replace(/^(browser_|solari_browser_|solari_)/, "")} ${truncate(args, 110)}`.trim()
  } else if (item.type === "agent_message" && item.text) {
    if (String(item.text).trim().startsWith("{")) return undefined // structured final answer — surfaced as decisions/actions instead
    text = truncate(String(item.text), 220)
  } else if (item.type === "reasoning" && item.text) {
    text = `Thinking: ${truncate(String(item.text).replace(/\*\*/g, ""), 160)}`
  } else if (item.type === "command_execution") {
    text = `Ran: ${truncate(String(item.command ?? ""), 120)}`
  }
  if (!text) return undefined
  const invoiceIds = [...new Set(String(JSON.stringify(item)).match(INVOICE_ID) ?? [])]
  return { text: redactToken(text), invoiceIds, tool }
}

function sessionIdOf(output: any): string | undefined {
  const id = typeof output?.browserSessionId === "string" ? output.browserSessionId.trim() : ""
  return id.length > 0 ? id : undefined
}

function truncate(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim()
  return single.length > max ? `${single.slice(0, max - 1)}…` : single
}

export class CodexPortalAgent {
  private threads = new Map<CustomerSlug, string>()
  private workDirs = new Map<string, string>()

  constructor(private readonly config: AgentConfig) {}

  describe(): string {
    return this.config.mcp === "solari" ? "Codex · Solari MCP" : "Codex · Playwright MCP"
  }

  async lookup(customer: CustomerSlug, invoices: Invoice[]): Promise<{ results: AgentLookup[]; sessionId?: string }> {
    const url = publicUrl({ baseUrl: this.config.baseUrl }, `/portal/${customer}`)
    const { output, threadId } = await this.run(customer, buildLookupPrompt(customer, invoices, url, this.config.mcp), lookupSchema)
    if (threadId) this.threads.set(customer, threadId)
    return { results: Array.isArray(output?.results) ? output.results : [], sessionId: sessionIdOf(output) }
  }

  async act(customer: CustomerSlug, actions: AgentAction[]): Promise<{ results: AgentActionResult[]; sessionId?: string }> {
    const url = publicUrl({ baseUrl: this.config.baseUrl }, `/portal/${customer}`)
    const { output, threadId } = await this.run(customer, buildActionPrompt(customer, actions, url, this.config.mcp), actionSchema, this.threads.get(customer))
    if (threadId) this.threads.set(customer, threadId)
    return { results: Array.isArray(output?.results) ? output.results : [], sessionId: sessionIdOf(output) }
  }

  /** Tiny end-to-end check: auth + MCP browser tools + structured output. */
  async probe(url = "https://example.com"): Promise<{ heading: string; toolsUsed: string[]; browserSessionId: string }> {
    const prompt = `Use the browser tools available to you to open ${url} and read the page. Return the text of the main heading, the names of the tools you used, and browserSessionId.${this.config.mcp === "solari" ? ' You are using Solari cloud-browser tools: create a browser session first with solari_browser_create and the arguments {"mode":"fast","recording":true}, then navigate and read the page, then close the session and report its session id as browserSessionId.' : " Set browserSessionId to an empty string."}`
    const { output } = await this.run(undefined, prompt, probeSchema)
    return output
  }

  private mcpOverrides(): string[] {
    const server = "mcp_servers.browser"
    if (this.config.mcp === "solari") {
      // Tool names confirmed against the hosted server; sandbox/desktop tools are deliberately not exposed to the agent.
      const tools = ["solari_browser_create", "solari_browser_navigate", "solari_browser_read_page", "solari_browser_screenshot", "solari_browser_click", "solari_browser_type", "solari_browser_key", "solari_browser_evaluate", "solari_browser_replay_url", "solari_browser_close"]
      return [
        "-c", `${server}.url="https://mcp.getsolari.com/mcp"`,
        "-c", `${server}.bearer_token_env_var="SOLARI_API_KEY"`,
        "-c", `${server}.enabled_tools=${JSON.stringify(tools)}`,
        "-c", `${server}.default_tools_approval_mode="approve"`,
        "-c", `${server}.startup_timeout_sec=60`,
        "-c", `${server}.tool_timeout_sec=180`,
      ]
    }
    const bin = process.env.PLAYWRIGHT_MCP_BIN ?? path.resolve(directory, "../node_modules/.bin/playwright-mcp")
    const args = ["--isolated", "--executable-path", process.env.PLAYWRIGHT_MCP_EXECUTABLE ?? chromium.executablePath()]
    if (!this.config.visible) args.unshift("--headless")
    return [
      "-c", `${server}.command=${JSON.stringify(bin)}`,
      "-c", `${server}.args=${JSON.stringify(args)}`,
      "-c", `${server}.default_tools_approval_mode="approve"`,
      "-c", `${server}.startup_timeout_sec=90`,
      "-c", `${server}.tool_timeout_sec=180`,
    ]
  }

  private workDir(key: string): string {
    let dir = this.workDirs.get(key)
    if (!dir) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), `duepoint-codex-${key}-`))
      fs.writeFileSync(path.join(dir, "AGENTS.md"), "You operate web portals through the browser tools. There is no code to edit here; do not run shell commands.\n")
      this.workDirs.set(key, dir)
    }
    return dir
  }

  private run(customer: CustomerSlug | undefined, prompt: string, schema: object, resumeThread?: string): Promise<{ output: any; threadId?: string }> {
    const cwd = this.workDir(customer ?? "probe")
    const stamp = Date.now().toString(36)
    const schemaPath = path.join(cwd, `schema-${stamp}.json`)
    const outputPath = path.join(cwd, `output-${stamp}.json`)
    fs.writeFileSync(schemaPath, JSON.stringify(schema))

    const args = ["exec"]
    if (resumeThread) args.push("resume", resumeThread)
    args.push(
      "--json", "--skip-git-repo-check", "--ignore-user-config",
      "--output-schema", schemaPath, "-o", outputPath,
      "-c", 'approval_policy="never"',
      "-c", 'sandbox_mode="read-only"',
      "-c", 'web_search="disabled"',
      ...this.mcpOverrides(),
    )
    if (this.config.model) args.push("-m", this.config.model)
    if (this.config.reasoningEffort) args.push("-c", `model_reasoning_effort="${this.config.reasoningEffort}"`)
    args.push("-")

    return new Promise((resolve, reject) => {
      const child = spawn(this.config.codexBin ?? "codex", args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] })
      let threadId: string | undefined
      let lastMessage: string | undefined
      let stderr = ""
      let buffer = ""

      const handleLine = (line: string) => {
        if (!line.trim()) return
        let event: any
        try { event = JSON.parse(line) } catch { return }
        if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id
        if (event.type === "item.completed" && event.item?.type === "agent_message") lastMessage = event.item.text
        const summary = summarizeEvent(event)
        if (summary) this.config.onEvent?.(customer, summary)
      }

      child.stdout.on("data", (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        lines.forEach(handleLine)
      })
      child.stderr.on("data", (chunk) => { stderr += chunk.toString(); if (stderr.length > 20_000) stderr = stderr.slice(-20_000) })
      child.on("error", (error) => reject(new Error(`Could not start codex (${this.config.codexBin ?? "codex"}): ${error.message}`)))
      child.on("close", (code) => {
        if (buffer) handleLine(buffer)
        let raw = ""
        try { raw = fs.readFileSync(outputPath, "utf8") } catch {}
        if (!raw && lastMessage) raw = lastMessage
        if (code !== 0 && !raw) return reject(new Error(`codex exec exited with ${code}: ${stderr.trim().split("\n").slice(-6).join(" | ")}`))
        try {
          resolve({ output: JSON.parse(raw), threadId })
        } catch {
          reject(new Error(`Codex returned non-JSON output: ${truncate(raw, 300)}`))
        }
      })

      child.stdin.end(prompt)
    })
  }
}
