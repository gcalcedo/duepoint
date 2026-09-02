import type { Page } from "playwright"
import { pause } from "./execution.js"
import type { Action, CustomerSlug, Finding, Invoice } from "./domain.js"
import { publicUrl, type PublicTarget } from "./public-url.js"

export interface Lookup {
  finding: Finding
  detail: string
  reference?: string
}

/**
 * One adapter per customer portal. Each portal has its own navigation, vocabulary, and forms —
 * the same "find this invoice, then act on it" job takes a different path in every one.
 */
export interface PortalAdapter {
  lookup(page: Page, invoice: Invoice): Promise<Lookup>
  act(page: Page, invoice: Invoice, action: Action): Promise<string | undefined>
}

async function readStatus(page: Page): Promise<Lookup> {
  const status = page.getByTestId("invoice-status")
  await status.waitFor()
  const finding = (await status.getAttribute("data-finding")) as Finding
  const reference = (await status.getAttribute("data-reference")) ?? undefined
  const detail = ((await page.getByTestId("status-detail").textContent()) ?? "").trim()
  return { finding, detail, reference }
}

async function readResult(page: Page): Promise<string> {
  const result = page.getByTestId("submission-result")
  await result.waitFor()
  await pause(page, 600)
  return (await result.getAttribute("data-reference")) ?? ""
}

function unsupported(portal: string, action: Action): never {
  throw new Error(`${portal} adapter has no flow for ${action}`)
}

/** SupplierNet — supplier-network style: tabbed shell, left filter panel, table → drill-down. */
const supplierNet: PortalAdapter = {
  async lookup(page, invoice) {
    await page.goto(url(page, "/portal/meridian"))
    await page.getByRole("button", { name: "Invoices", exact: true }).click()
    await page.getByLabel("Invoice number", { exact: true }).fill(invoice.id)
    await page.getByRole("button", { name: "Search", exact: true }).click()
    await pause(page)
    const link = page.getByRole("link", { name: invoice.id, exact: true })
    if ((await link.count()) === 0) return { finding: "not-received", detail: "No invoices match your filter criteria" }
    await link.click()
    return readStatus(page)
  },
  async act(page, invoice, action) {
    switch (action) {
      case "request-status":
        await page.getByLabel("Comment", { exact: true }).fill(`Following up on ${invoice.id} (PO ${invoice.poNumber}), ${invoice.daysOverdue} days past due. Could you confirm the approval status and expected payment date?`)
        await page.getByRole("button", { name: "Add Comment", exact: true }).click()
        return readResult(page)
      case "correct-and-resubmit":
        await page.getByRole("button", { name: "Edit and Resubmit", exact: true }).click()
        await page.getByLabel("Customer PO number", { exact: true }).fill(invoice.poNumber)
        await page.getByRole("button", { name: "Resubmit", exact: true }).click()
        return readResult(page)
      case "respond-to-dispute":
        await page.getByRole("button", { name: "Respond to Dispute", exact: true }).click()
        await page.getByLabel("Response", { exact: true }).fill(`Pricing on ${invoice.id} matches PO ${invoice.poNumber} as issued. PO copy and signed delivery note attached for reference.`)
        await page.getByLabel("Attach PO and delivery proof", { exact: true }).check()
        await page.getByRole("button", { name: "Send Response", exact: true }).click()
        return readResult(page)
      case "resubmit-invoice":
        await page.getByRole("button", { name: "Create Invoice from PO", exact: true }).click()
        await page.getByLabel("Purchase order number", { exact: true }).fill(invoice.poNumber)
        await page.getByRole("button", { name: "Look up", exact: true }).click()
        await page.getByTestId("po-details").waitFor()
        await pause(page)
        await page.getByLabel("Supplier invoice number", { exact: true }).fill(invoice.id)
        await page.getByRole("button", { name: "Submit Invoice", exact: true }).click()
        return readResult(page)
      case "match-remittance":
      case "record-promise":
        return undefined
      default:
        return unsupported("SupplierNet", action)
    }
  },
}

/** ProcureHub — modern P2P suite: global search, result cards, slide-over drawer, confirm dialogs. */
const procureHub: PortalAdapter = {
  async lookup(page, invoice) {
    await page.goto(url(page, "/portal/atlas"))
    const search = page.getByLabel("Search invoices and orders", { exact: true })
    await search.fill(invoice.id)
    await search.press("Enter")
    await pause(page)
    const card = page.getByTestId("result-card")
    if ((await card.count()) === 0) return { finding: "not-received", detail: `No results for ${invoice.id}` }
    await card.first().click()
    return readStatus(page)
  },
  async act(page, invoice, action) {
    switch (action) {
      case "request-status":
        await page.getByLabel("Add a comment", { exact: true }).fill(`Hi team — ${invoice.id} against PO ${invoice.poNumber} has been in approval for a while and is ${invoice.daysOverdue} days past due. Could you share an expected approval date?`)
        await page.getByRole("button", { name: "Post", exact: true }).click()
        return readResult(page)
      case "respond-to-dispute":
        await page.getByLabel("Reply to dispute", { exact: true }).fill(`Our delivery records for PO ${invoice.poNumber} show the full quantity signed for at your DC. Supporting documents attached — happy to reconcile line by line.`)
        await page.getByLabel("Include supporting documents", { exact: true }).check()
        await page.getByRole("button", { name: "Send reply", exact: true }).click()
        await page.getByRole("button", { name: "Confirm", exact: true }).click()
        return readResult(page)
      case "resubmit-invoice":
        await page.getByRole("button", { name: "Create invoice", exact: true }).click()
        await page.getByLabel("Purchase order", { exact: true }).selectOption(invoice.poNumber)
        await page.getByRole("button", { name: "Next", exact: true }).click()
        await page.getByLabel("Invoice number", { exact: true }).fill(invoice.id)
        await page.getByRole("button", { name: "Submit invoice", exact: true }).click()
        await page.getByRole("button", { name: "Confirm", exact: true }).click()
        return readResult(page)
      case "match-remittance":
      case "record-promise":
        return undefined
      default:
        return unsupported("ProcureHub", action)
    }
  },
}

/** TradeLink — e-invoicing network: sidebar menu, buyer-gated search, status timeline. */
const tradeLink: PortalAdapter = {
  async lookup(page, invoice) {
    await page.goto(url(page, "/portal/halvorsen"))
    await page.getByRole("link", { name: "Invoice status", exact: true }).click()
    await page.getByLabel("Buyer", { exact: true }).selectOption("halvorsen")
    await page.getByLabel("Your invoice reference", { exact: true }).fill(invoice.id)
    await page.getByRole("button", { name: "Go", exact: true }).click()
    await pause(page)
    if ((await page.getByTestId("invoice-status").count()) === 0) return { finding: "not-received", detail: `No document found with reference ${invoice.id} for this buyer` }
    return readStatus(page)
  },
  async act(page, invoice, action) {
    switch (action) {
      case "request-status":
        await page.getByRole("button", { name: "Send buyer a reminder", exact: true }).click()
        await page.getByRole("button", { name: "Send reminder", exact: true }).click()
        return readResult(page)
      case "correct-and-resubmit":
        await page.getByRole("button", { name: "Amend and resend", exact: true }).click()
        await page.getByLabel("Bill-to entity", { exact: true }).selectOption("oslo")
        await page.getByRole("button", { name: "Resend", exact: true }).click()
        return readResult(page)
      case "resubmit-invoice":
        await page.getByRole("button", { name: "Key in a new invoice", exact: true }).click()
        await page.getByLabel("PO reference", { exact: true }).fill(invoice.poNumber)
        await page.getByLabel("Invoice reference", { exact: true }).fill(invoice.id)
        await page.getByLabel("Amount", { exact: true }).fill(String(invoice.amount))
        await page.getByRole("button", { name: "Submit to buyer", exact: true }).click()
        return readResult(page)
      case "match-remittance":
      case "record-promise":
        return undefined
      default:
        return unsupported("TradeLink", action)
    }
  },
}

/** Vendor Center — homegrown legacy portal: link menu, scan a full table, plain forms. */
const vendorCenter: PortalAdapter = {
  async lookup(page, invoice) {
    await page.goto(url(page, "/portal/crestview"))
    await page.getByRole("link", { name: "Invoice Inquiry", exact: true }).click()
    await page.getByRole("table").waitFor()
    await pause(page)
    const row = page.getByRole("row", { name: new RegExp(invoice.id) })
    if ((await row.count()) === 0) return { finding: "not-received", detail: "Invoice not on file for this vendor" }
    await row.getByRole("link", { name: "View", exact: true }).click()
    return readStatus(page)
  },
  async act(page, invoice, action) {
    switch (action) {
      case "request-status":
        await page.getByRole("link", { name: "Request Status Update", exact: true }).click()
        await page.getByLabel("Comments", { exact: true }).fill(`Requesting status on vendor invoice ${invoice.id}, PO ${invoice.poNumber}, ${invoice.daysOverdue} days past due.`)
        await page.getByRole("button", { name: "Send Request", exact: true }).click()
        return readResult(page)
      case "correct-and-resubmit":
        await page.getByRole("link", { name: "Resubmit Corrected Invoice", exact: true }).click()
        await page.getByLabel("Vendor Invoice No", { exact: true }).fill(invoice.id)
        await page.getByRole("button", { name: "Submit Corrected Invoice", exact: true }).click()
        return readResult(page)
      case "respond-to-dispute":
        await page.getByRole("link", { name: "Dispute Hold", exact: true }).click()
        await page.getByLabel("Reason for dispute", { exact: true }).fill(`Freight on ${invoice.id} was authorized under PO ${invoice.poNumber} terms (FOB origin, freight prepaid & add). PO and carrier invoice attached.`)
        await page.getByLabel("Documentation provided", { exact: true }).selectOption("yes")
        await page.getByRole("button", { name: "Submit Dispute", exact: true }).click()
        return readResult(page)
      case "resubmit-invoice":
        await page.getByRole("link", { name: "Submit Invoice", exact: true }).click()
        await page.getByLabel("Vendor Invoice No", { exact: true }).fill(invoice.id)
        await page.getByLabel("PO Number", { exact: true }).fill(invoice.poNumber)
        await page.getByLabel("Invoice Amount", { exact: true }).fill(String(invoice.amount))
        await page.getByRole("button", { name: "Submit", exact: true }).click()
        return readResult(page)
      case "match-remittance":
      case "record-promise":
        return undefined
      default:
        return unsupported("Vendor Center", action)
    }
  },
}

export const adapters: Partial<Record<CustomerSlug, PortalAdapter>> = {
  meridian: supplierNet,
  atlas: procureHub,
  halvorsen: tradeLink,
  crestview: vendorCenter,
}

const targets = new WeakMap<Page, PublicTarget>()
export function bindBaseUrl(page: Page, baseUrl: string, accessToken?: string): void {
  targets.set(page, { baseUrl, accessToken })
}
function url(page: Page, path: string): string {
  const target = targets.get(page)
  if (!target) throw new Error("Page has no base URL bound")
  return publicUrl(target, path)
}

/** Corvus AR — the supplier's own receivables system, a legacy desktop-style workstation. */
export async function postToAr(page: Page, invoice: Invoice, status: string, reference: string | undefined, note: string, promiseDate?: string): Promise<void> {
  await page.goto(url(page, "/ar"))
  await page.getByLabel("Invoice number", { exact: true }).fill(invoice.id)
  await page.getByRole("button", { name: "Find", exact: true }).click()
  await page.getByTestId("ar-record").waitFor()
  await pause(page)
  await page.getByLabel("Collection status", { exact: true }).selectOption(status)
  if (promiseDate) await page.getByLabel("Promise date", { exact: true }).fill(promiseDate)
  if (reference) await page.getByLabel("Portal reference", { exact: true }).fill(reference)
  await page.getByLabel("Collector note", { exact: true }).fill(note)
  await page.getByRole("button", { name: "Post to ledger", exact: true }).click()
  await page.getByTestId("ar-posted").waitFor()
  await pause(page, 500)
}
