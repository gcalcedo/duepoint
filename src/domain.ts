export const customers = {
  meridian: { name: "Meridian Manufacturing", portal: "SupplierNet", portalNote: "Supplier network", apContact: "ap@meridianmfg.example" },
  atlas: { name: "Atlas Retail Group", portal: "ProcureHub", portalNote: "Procure-to-pay suite", apContact: "payables@atlasretail.example" },
  halvorsen: { name: "Halvorsen Logistics", portal: "TradeLink", portalNote: "e-Invoicing network", apContact: "invoices@halvorsen.example" },
  crestview: { name: "Crestview Health Systems", portal: "Vendor Center", portalNote: "Homegrown vendor portal", apContact: "vendors@crestviewhealth.example" },
  brightwater: { name: "Brightwater Foods", portal: null, portalNote: "No portal · email only", apContact: "ap@brightwaterfoods.example" },
} as const

export type CustomerSlug = keyof typeof customers
export const customerSlugs = Object.keys(customers) as CustomerSlug[]

export type Finding =
  | "paid"
  | "approved-scheduled"
  | "pending-approval"
  | "not-received"
  | "rejected"
  | "disputed"
  | "no-portal"
  | "unknown"

export type Action =
  | "match-remittance"
  | "record-promise"
  | "request-status"
  | "resubmit-invoice"
  | "correct-and-resubmit"
  | "respond-to-dispute"
  | "send-statement"

export type InvoiceStatus = "queued" | "checking" | "needs-review" | "done" | "escalated"
export type CashBucket = "confirmed" | "unblocked" | "at-risk"

export interface Invoice {
  id: string
  customer: CustomerSlug
  customerName: string
  portal: string | null
  poNumber: string
  amount: number
  invoiceDate: string
  dueDate: string
  daysOverdue: number
  apContact: string
  status: InvoiceStatus
  finding?: Finding
  findingDetail?: string
  portalReference?: string
  recommendedAction?: Action
  rationale?: string
  confidence?: number
  requiresApproval?: boolean
  resolution?: string
  confirmation?: string
  cashBucket?: CashBucket
  note?: string
  /** Solari browser session ids (when the run used Solari) — replays are fetched via /api/replay/:id. */
  lookupSession?: string
  actionSession?: string
  arSession?: string
}

/** What the customer's portal knows about an invoice. Only visible by operating the portal. */
export interface PortalRecord {
  invoiceId: string
  customer: CustomerSlug
  finding: Exclude<Finding, "no-portal" | "unknown">
  poNumber: string
  amount: number
  invoiceDate: string
  dueDate: string
  scheduledPayDate?: string
  paidOn?: string
  paymentReference?: string
  approvalDays?: number
  rejectionReason?: string
  disputeReason?: string
  disputeAmount?: number
}

export interface AuditEvent {
  id: number
  at: string
  invoiceId?: string
  customer?: CustomerSlug
  kind: "system" | "lookup" | "decision" | "action" | "approval" | "complete" | "agent"
  message: string
}

export interface AppState {
  runStatus: "ready" | "running" | "complete"
  invoices: Invoice[]
  events: AuditEvent[]
  startedAt?: string
  completedAt?: string
}

export interface Decision {
  recommendedAction: Action
  rationale: string
  confidence: number
  requiresApproval: boolean
}

export const APPROVAL_THRESHOLD = 50_000

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

export function decide(finding: Finding, detail: string, invoice: Pick<Invoice, "amount" | "poNumber" | "customerName" | "apContact">): Decision {
  let recommendedAction: Action
  let rationale: string
  let confidence: number
  let requiresApproval = false

  switch (finding) {
    case "paid":
      recommendedAction = "match-remittance"
      rationale = `${invoice.customerName} shows the invoice as paid (${detail}). Match the remittance and close it in AR.`
      confidence = 0.99
      break
    case "approved-scheduled":
      recommendedAction = "record-promise"
      rationale = `Approved in the portal with a payment date (${detail}). Record the promise-to-pay so the forecast reflects it.`
      confidence = 0.97
      break
    case "pending-approval":
      recommendedAction = "request-status"
      rationale = `Invoice is sitting in the buyer's approval queue (${detail}). Post a status request through the portal.`
      confidence = 0.9
      break
    case "not-received":
      recommendedAction = "resubmit-invoice"
      rationale = `The portal has no record of this invoice. Resubmit it against PO ${invoice.poNumber}.`
      confidence = 0.95
      break
    case "rejected":
      recommendedAction = "correct-and-resubmit"
      rationale = `Rejected for a data error (${detail}). The correct value is on the PO record; fix and resubmit.`
      confidence = 0.92
      break
    case "disputed":
      recommendedAction = "respond-to-dispute"
      rationale = `${invoice.customerName} disputes part of the invoice (${detail}). Any concession needs approval; the proposed response attaches PO ${invoice.poNumber} and delivery proof.`
      confidence = 0.78
      requiresApproval = true
      break
    case "no-portal":
      recommendedAction = "send-statement"
      rationale = `${invoice.customerName} has no AP portal. A statement and reminder go to ${invoice.apContact} once approved.`
      confidence = 0.85
      requiresApproval = true
      break
    case "unknown":
    default:
      recommendedAction = "request-status"
      rationale = `The agent could not determine this invoice's status in the portal (${detail || "no detail"}). Review before any action.`
      confidence = 0.4
      requiresApproval = true
  }

  if (invoice.amount >= APPROVAL_THRESHOLD) requiresApproval = true
  return { recommendedAction, rationale, confidence, requiresApproval }
}

export const actionLabels: Record<Action, string> = {
  "match-remittance": "Match remittance",
  "record-promise": "Record promise-to-pay",
  "request-status": "Request status",
  "resubmit-invoice": "Resubmit invoice",
  "correct-and-resubmit": "Correct & resubmit",
  "respond-to-dispute": "Respond to dispute",
  "send-statement": "Send statement",
}

export const resolutionLabels: Record<Action, string> = {
  "match-remittance": "Matched & closed",
  "record-promise": "Promise recorded",
  "request-status": "Status requested",
  "resubmit-invoice": "Resubmitted",
  "correct-and-resubmit": "Corrected & resubmitted",
  "respond-to-dispute": "Dispute response sent",
  "send-statement": "Statement sent",
}

export type ArStatus = "promise" | "resubmitted" | "reminder" | "dispute" | "paid" | "statement" | "escalated"

export function arStatus(action: Action): ArStatus {
  switch (action) {
    case "match-remittance": return "paid"
    case "record-promise": return "promise"
    case "request-status": return "reminder"
    case "resubmit-invoice":
    case "correct-and-resubmit": return "resubmitted"
    case "respond-to-dispute": return "dispute"
    case "send-statement": return "statement"
  }
}

export function cashBucket(finding: Finding): CashBucket {
  if (finding === "paid" || finding === "approved-scheduled") return "confirmed"
  if (finding === "disputed" || finding === "no-portal" || finding === "unknown") return "at-risk"
  return "unblocked"
}

export function formatMoney(value: number): string {
  return money.format(value)
}

export function summarize(state: AppState) {
  const sum = (invoices: Invoice[]) => invoices.reduce((total, invoice) => total + invoice.amount, 0)
  const done = state.invoices.filter((invoice) => invoice.status === "done")
  const processed = state.invoices.filter((invoice) => invoice.status === "done" || invoice.status === "escalated")
  const atRisk = state.invoices.filter((invoice) =>
    invoice.status === "escalated" ||
    invoice.status === "needs-review" ||
    (invoice.finding && cashBucket(invoice.finding) === "at-risk"))
  return {
    totalInvoices: state.invoices.length,
    overdue: sum(state.invoices),
    confirmed: sum(done.filter((invoice) => invoice.cashBucket === "confirmed")),
    unblocked: sum(done.filter((invoice) => invoice.cashBucket === "unblocked")),
    atRisk: sum(atRisk),
    checked: state.invoices.filter((invoice) => invoice.finding).length,
    processed: processed.length,
    pendingApproval: state.invoices.filter((invoice) => invoice.status === "needs-review").length,
    hoursAvoided: Number((processed.length * 0.3).toFixed(1)),
  }
}
