import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ExcelJS from "exceljs"
import { AS_OF, daysBetween, invoiceSeeds } from "./data.js"
import { customers } from "./domain.js"

const directory = path.dirname(fileURLToPath(import.meta.url))
const outputDirectory = path.resolve(directory, "../data")
const outputPath = path.join(outputDirectory, "Overdue_Invoices.xlsx")

fs.mkdirSync(outputDirectory, { recursive: true })
const workbook = new ExcelJS.Workbook()
workbook.creator = "Northbridge Industrial Supply — AR"
const worksheet = workbook.addWorksheet("Overdue Invoices", { views: [{ state: "frozen", ySplit: 1 }] })
worksheet.columns = [
  { header: "Invoice", key: "invoice", width: 13 },
  { header: "Customer", key: "customer", width: 28 },
  { header: "PO Number", key: "poNumber", width: 13 },
  { header: "Invoice Date", key: "invoiceDate", width: 13 },
  { header: "Due Date", key: "dueDate", width: 13 },
  { header: "Amount", key: "amount", width: 13 },
  { header: "Days Overdue", key: "daysOverdue", width: 13 },
  { header: "AP Contact", key: "apContact", width: 34 },
]
worksheet.addRows(invoiceSeeds.map((seed) => ({
  invoice: seed.id,
  customer: customers[seed.customer].name,
  poNumber: seed.poNumber,
  invoiceDate: seed.invoiceDate,
  dueDate: seed.dueDate,
  amount: seed.amount,
  daysOverdue: daysBetween(seed.dueDate, AS_OF),
  apContact: customers[seed.customer].apContact,
})))
worksheet.getRow(1).eachCell((cell) => {
  cell.font = { bold: true, color: { argb: "FFFFFFFF" } }
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF23745A" } }
})
worksheet.autoFilter = { from: "A1", to: `H${invoiceSeeds.length + 1}` }
worksheet.getColumn("amount").numFmt = "$#,##0"
await workbook.xlsx.writeFile(outputPath)
console.log(`Workbook ready: ${outputPath} (${invoiceSeeds.length} invoices)`)
