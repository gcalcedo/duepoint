import type { CustomerSlug, PortalRecord } from "./domain.js"

export const AS_OF = "2026-09-01"

export interface InvoiceSeed {
  id: string
  customer: CustomerSlug
  poNumber: string
  amount: number
  invoiceDate: string
  dueDate: string
}

/** The supplier's overdue list — this is what lands in Overdue_Invoices.xlsx. */
export const invoiceSeeds: InvoiceSeed[] = [
  { id: "INV-24031", customer: "meridian", poNumber: "MM-77120", amount: 18_400, invoiceDate: "2026-06-18", dueDate: "2026-07-18" },
  { id: "INV-24035", customer: "atlas", poNumber: "ATL-90411", amount: 22_900, invoiceDate: "2026-06-20", dueDate: "2026-07-20" },
  { id: "INV-24038", customer: "brightwater", poNumber: "BW-2201", amount: 7_850, invoiceDate: "2026-06-22", dueDate: "2026-07-22" },
  { id: "INV-24040", customer: "halvorsen", poNumber: "HL-3312", amount: 12_900, invoiceDate: "2026-06-24", dueDate: "2026-07-24" },
  { id: "INV-24044", customer: "crestview", poNumber: "CHS-55810", amount: 9_300, invoiceDate: "2026-06-26", dueDate: "2026-07-26" },
  { id: "INV-24047", customer: "meridian", poNumber: "MM-77188", amount: 9_850, invoiceDate: "2026-06-29", dueDate: "2026-07-29" },
  { id: "INV-24049", customer: "atlas", poNumber: "ATL-90455", amount: 58_200, invoiceDate: "2026-07-01", dueDate: "2026-07-31" },
  { id: "INV-24052", customer: "atlas", poNumber: "ATL-90470", amount: 7_640, invoiceDate: "2026-07-03", dueDate: "2026-08-02" },
  { id: "INV-24055", customer: "halvorsen", poNumber: "HL-3340", amount: 8_275, invoiceDate: "2026-07-06", dueDate: "2026-08-05" },
  { id: "INV-24058", customer: "meridian", poNumber: "MM-77201", amount: 27_300, invoiceDate: "2026-07-08", dueDate: "2026-08-07" },
  { id: "INV-24060", customer: "crestview", poNumber: "CHS-55872", amount: 31_750, invoiceDate: "2026-07-09", dueDate: "2026-08-08" },
  { id: "INV-24063", customer: "halvorsen", poNumber: "HL-3359", amount: 24_600, invoiceDate: "2026-07-11", dueDate: "2026-08-10" },
  { id: "INV-24066", customer: "meridian", poNumber: "MM-77244", amount: 6_120, invoiceDate: "2026-07-13", dueDate: "2026-08-12" },
  { id: "INV-24069", customer: "brightwater", poNumber: "BW-2260", amount: 12_400, invoiceDate: "2026-07-14", dueDate: "2026-08-13" },
  { id: "INV-24071", customer: "meridian", poNumber: "MM-77265", amount: 41_900, invoiceDate: "2026-07-15", dueDate: "2026-08-14" },
  { id: "INV-24074", customer: "crestview", poNumber: "CHS-55901", amount: 4_960, invoiceDate: "2026-07-16", dueDate: "2026-08-15" },
  { id: "INV-24077", customer: "atlas", poNumber: "ATL-90502", amount: 11_300, invoiceDate: "2026-07-17", dueDate: "2026-08-16" },
  { id: "INV-24079", customer: "halvorsen", poNumber: "HL-3387", amount: 5_480, invoiceDate: "2026-07-18", dueDate: "2026-08-17" },
  { id: "INV-24082", customer: "atlas", poNumber: "ATL-90519", amount: 16_450, invoiceDate: "2026-07-20", dueDate: "2026-08-19" },
  { id: "INV-24087", customer: "crestview", poNumber: "CHS-55940", amount: 13_100, invoiceDate: "2026-07-22", dueDate: "2026-08-21" },
  { id: "INV-24089", customer: "meridian", poNumber: "MM-77302", amount: 14_750, invoiceDate: "2026-07-23", dueDate: "2026-08-22" },
  { id: "INV-24091", customer: "halvorsen", poNumber: "HL-3402", amount: 15_200, invoiceDate: "2026-07-24", dueDate: "2026-08-23" },
  { id: "INV-24093", customer: "meridian", poNumber: "MM-77330", amount: 32_600, invoiceDate: "2026-07-25", dueDate: "2026-08-24" },
  { id: "INV-24096", customer: "atlas", poNumber: "ATL-90548", amount: 19_800, invoiceDate: "2026-07-27", dueDate: "2026-08-26" },
]

type PortalTruth = Partial<PortalRecord> & { finding: PortalRecord["finding"] }

/**
 * What each customer's AP system actually holds. This is never read by the agent directly —
 * it is only reachable by operating the portal UI, exactly like a collector would.
 */
const portalTruth: Record<string, PortalTruth> = {
  "INV-24031": { finding: "approved-scheduled", scheduledPayDate: "2026-09-12" },
  "INV-24047": { finding: "paid", paidOn: "2026-08-28", paymentReference: "ACH-5518821" },
  "INV-24058": { finding: "pending-approval", approvalDays: 19 },
  "INV-24066": { finding: "not-received" },
  "INV-24071": { finding: "rejected", rejectionReason: "Purchase order number missing" },
  "INV-24089": { finding: "approved-scheduled", scheduledPayDate: "2026-09-19" },
  "INV-24093": { finding: "disputed", disputeReason: "Unit price variance against PO", disputeAmount: 2_480 },

  "INV-24035": { finding: "pending-approval", approvalDays: 12 },
  "INV-24049": { finding: "pending-approval", approvalDays: 26 },
  "INV-24052": { finding: "paid", paidOn: "2026-08-21", paymentReference: "WIRE-0092731" },
  "INV-24077": { finding: "disputed", disputeReason: "Short shipment: 40 of 48 units received", disputeAmount: 1_883 },
  "INV-24082": { finding: "not-received" },
  "INV-24096": { finding: "approved-scheduled", scheduledPayDate: "2026-09-10" },

  "INV-24040": { finding: "rejected", rejectionReason: "Bill-to entity does not match buyer master" },
  "INV-24055": { finding: "approved-scheduled", scheduledPayDate: "2026-09-15" },
  "INV-24063": { finding: "pending-approval", approvalDays: 9 },
  "INV-24079": { finding: "paid", paidOn: "2026-08-25", paymentReference: "BACS-771022" },
  "INV-24091": { finding: "not-received" },

  "INV-24044": { finding: "paid", paidOn: "2026-08-19", paymentReference: "CHK-104488" },
  "INV-24060": { finding: "pending-approval", approvalDays: 33 },
  "INV-24074": { finding: "rejected", rejectionReason: "Vendor invoice number missing on document" },
  "INV-24087": { finding: "disputed", disputeReason: "Short pay: freight charge not on PO", disputeAmount: 640 },
}

export const portalRecords: PortalRecord[] = invoiceSeeds
  .filter((seed) => portalTruth[seed.id])
  .map((seed) => ({
    invoiceId: seed.id,
    customer: seed.customer,
    poNumber: seed.poNumber,
    amount: seed.amount,
    invoiceDate: seed.invoiceDate,
    dueDate: seed.dueDate,
    ...portalTruth[seed.id],
  }))

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000)
}
