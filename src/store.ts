import path from "node:path"
import { fileURLToPath } from "node:url"
import ExcelJS from "exceljs"
import { portalRecords } from "./data.js"
import { customers, type AppState, type AuditEvent, type CustomerSlug, type Invoice, type PortalRecord } from "./domain.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const workbookPath = path.resolve(directory, "../data/Overdue_Invoices.xlsx")

const slugByName = Object.fromEntries(Object.entries(customers).map(([slug, customer]) => [customer.name, slug])) as Record<string, CustomerSlug>

export async function loadInvoices(): Promise<Invoice[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(workbookPath)
  const sheet = workbook.getWorksheet("Overdue Invoices")
  if (!sheet) throw new Error("Overdue Invoices worksheet not found — run `npm run seed`")
  const headers = sheet.getRow(1).values as string[]
  const invoices: Invoice[] = []
  sheet.eachRow((row, index) => {
    if (index === 1) return
    const cells = Object.fromEntries(headers.slice(1).map((header, column) => [header, row.getCell(column + 1).value ?? ""])) as Record<string, unknown>
    const customer = slugByName[String(cells.Customer)]
    if (!customer) throw new Error(`Unknown customer in workbook: ${String(cells.Customer)}`)
    invoices.push({
      id: String(cells.Invoice),
      customer,
      customerName: customers[customer].name,
      portal: customers[customer].portal,
      poNumber: String(cells["PO Number"]),
      amount: Number(cells.Amount),
      invoiceDate: String(cells["Invoice Date"]),
      dueDate: String(cells["Due Date"]),
      daysOverdue: Number(cells["Days Overdue"]),
      apContact: String(cells["AP Contact"]),
      status: "queued",
    })
  })
  return invoices
}

export class Store {
  private eventId = 0
  private state: AppState

  constructor(private readonly seedInvoices: Invoice[]) {
    this.state = this.freshState()
  }

  private freshState(): AppState {
    this.eventId = 0
    return {
      runStatus: "ready",
      invoices: structuredClone(this.seedInvoices),
      events: [this.makeEvent("system", `Overdue list loaded from Overdue_Invoices.xlsx — ${this.seedInvoices.length} invoices across ${new Set(this.seedInvoices.map((invoice) => invoice.customer)).size} customers`)],
    }
  }

  private makeEvent(kind: AuditEvent["kind"], message: string, invoiceId?: string, customer?: CustomerSlug): AuditEvent {
    this.eventId += 1
    return { id: this.eventId, at: new Date().toISOString(), kind, message, invoiceId, customer }
  }

  reset(): AppState {
    this.state = this.freshState()
    return this.snapshot()
  }

  snapshot(): AppState {
    return structuredClone(this.state)
  }

  invoice(id: string): Invoice | undefined {
    return this.state.invoices.find((invoice) => invoice.id === id)
  }

  invoicesFor(customer: CustomerSlug): Invoice[] {
    return this.state.invoices.filter((invoice) => invoice.customer === customer)
  }

  updateInvoice(id: string, update: Partial<Invoice>): Invoice {
    const invoice = this.invoice(id)
    if (!invoice) throw new Error(`Unknown invoice ${id}`)
    Object.assign(invoice, update)
    return structuredClone(invoice)
  }

  /** Ground truth held by the customer's AP system — served only to the portal mocks. */
  portalRecords(customer: CustomerSlug): PortalRecord[] {
    return portalRecords.filter((record) => record.customer === customer && record.finding !== "not-received")
  }

  portalRecord(customer: CustomerSlug, invoiceId: string): PortalRecord | undefined {
    return this.portalRecords(customer).find((record) => record.invoiceId === invoiceId)
  }

  setRunStatus(status: AppState["runStatus"]): void {
    this.state.runStatus = status
    if (status === "running") this.state.startedAt = new Date().toISOString()
    if (status === "complete") this.state.completedAt = new Date().toISOString()
  }

  addEvent(kind: AuditEvent["kind"], message: string, invoiceId?: string, customer?: CustomerSlug): AuditEvent {
    const event = this.makeEvent(kind, message, invoiceId, customer)
    this.state.events.unshift(event)
    this.state.events = this.state.events.slice(0, 120)
    return event
  }
}
