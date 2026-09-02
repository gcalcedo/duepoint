const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
const usDate = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}` }
const records = await (await fetch("/api/portal/crestview/invoices")).json()

const statusText = { paid: ["PAID", "status-paid"], "approved-scheduled": ["APPROVED", "status-paid"], "pending-approval": ["IN APPROVAL QUEUE", "status-queue"], rejected: ["RETURNED TO VENDOR", "status-hold"], disputed: ["ON HOLD", "status-hold"] }
function holdReason(record) {
  switch (record.finding) {
    case "paid": return `PAID — Check No. ${record.paymentReference} dated ${usDate(record.paidOn)}`
    case "approved-scheduled": return `APPROVED — scheduled for check run ${usDate(record.scheduledPayDate)}`
    case "pending-approval": return `IN APPROVAL QUEUE — ${record.approvalDays} days (awaiting department sign-off)`
    case "rejected": return `RETURNED TO VENDOR — ${record.rejectionReason}`
    case "disputed": return `ON HOLD — ${record.disputeReason} (${money.format(record.disputeAmount)})`
  }
}
const referenceOf = (record) => record.finding === "paid" ? record.paymentReference : record.finding === "approved-scheduled" ? record.scheduledPayDate : ""
const voucher = (record) => `V${record.invoiceId.replace("INV-", "")}7`

function showPage(name) {
  document.querySelectorAll(".page").forEach((page) => page.hidden = page.id !== `page-${name}`)
}
document.querySelectorAll("[data-page]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showPage(link.dataset.page) }))

document.querySelector("#inquiry-rows").innerHTML = records.map((record) => `
  <tr><td>${voucher(record)}</td><td>${record.invoiceId}</td><td>${usDate(record.invoiceDate)}</td><td>${record.poNumber}</td><td class="amt">${money.format(record.amount)}</td><td class="${statusText[record.finding][1]}">${statusText[record.finding][0]}</td><td><a href="#" data-view="${record.invoiceId}">View</a></td></tr>`).join("")
document.querySelector("#record-count").textContent = records.length
document.querySelectorAll("[data-view]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); showDetail(link.dataset.view) }))

async function submit(invoiceId, action) {
  const response = await fetch("/api/portal/crestview/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId, action }) })
  return (await response.json()).reference
}
function showResult(container, reference) {
  document.querySelectorAll("[data-testid=submission-result]").forEach((node) => node.remove())
  const node = document.createElement("p")
  node.className = "result"
  node.dataset.testid = "submission-result"
  node.dataset.reference = reference
  node.innerHTML = `Your request has been submitted to Accounts Payable. Reference No. <b>${reference}</b>. Please allow 5-7 business days for a response.`
  container.appendChild(node)
}

function showDetail(id) {
  const record = records.find((candidate) => candidate.invoiceId === id)
  const detail = document.querySelector("#page-detail")
  const [label, cls] = statusText[record.finding]
  const actions = {
    "pending-approval": `<a href="#" id="act-status">Request Status Update</a>`,
    rejected: `<a href="#" id="act-resubmit">Resubmit Corrected Invoice</a>`,
    disputed: `<a href="#" id="act-dispute">Dispute Hold</a>`,
    paid: `<a href="#">View Remittance Advice</a>`,
  }[record.finding] ?? ""

  detail.innerHTML = `
    <h2>Invoice Detail</h2>
    <p><a href="#" id="back">&laquo; Back to Invoice Inquiry</a></p>
    <table class="kv">
      <tr><td>Voucher #</td><td>${voucher(record)}</td></tr>
      <tr><td>Vendor Invoice No</td><td>${record.invoiceId}</td></tr>
      <tr><td>PO Number</td><td>${record.poNumber}</td></tr>
      <tr><td>Invoice Date</td><td>${usDate(record.invoiceDate)}</td></tr>
      <tr><td>Invoice Amount</td><td>${money.format(record.amount)}</td></tr>
      <tr><td>Status</td><td class="${cls}" data-testid="invoice-status" data-finding="${record.finding}" data-reference="${referenceOf(record)}">${label}</td></tr>
      <tr><td>Hold Reason / Remarks</td><td data-testid="status-detail">${holdReason(record)}</td></tr>
      <tr><td>Check No</td><td>${record.paymentReference ?? "&nbsp;"}</td></tr>
      <tr><td>Check Date</td><td>${record.paidOn ? usDate(record.paidOn) : "&nbsp;"}</td></tr>
      <tr><td>In Queue Since</td><td>${record.approvalDays ? `${record.approvalDays} days` : "&nbsp;"}</td></tr>
    </table>
    <div class="actions">${actions}</div>
    <div id="action-slot"></div>`
  showPage("detail")
  detail.querySelector("#back").addEventListener("click", (event) => { event.preventDefault(); showPage("inquiry") })

  const slot = detail.querySelector("#action-slot")
  detail.querySelector("#act-status")?.addEventListener("click", (event) => {
    event.preventDefault()
    slot.innerHTML = `<form class="plainform" id="status-form"><div><label for="comments">Comments</label><textarea id="comments" required></textarea></div><div class="buttons"><button type="submit">Send Request</button></div></form>`
    slot.querySelector("#status-form").addEventListener("submit", async (event) => { event.preventDefault(); showResult(slot, await submit(record.invoiceId, "request-status")) })
  })
  detail.querySelector("#act-resubmit")?.addEventListener("click", (event) => {
    event.preventDefault()
    slot.innerHTML = `<form class="plainform" id="resubmit-form"><div><label for="r-inv">Vendor Invoice No</label><input id="r-inv" required /></div><div><label for="r-po">PO Number</label><input id="r-po" value="${record.poNumber}" readonly /></div><div><label for="r-amt">Invoice Amount</label><input id="r-amt" value="${record.amount.toFixed(2)}" readonly /></div><div class="buttons"><button type="submit">Submit Corrected Invoice</button></div></form>`
    slot.querySelector("#resubmit-form").addEventListener("submit", async (event) => { event.preventDefault(); showResult(slot, await submit(record.invoiceId, "correct-and-resubmit")) })
  })
  detail.querySelector("#act-dispute")?.addEventListener("click", (event) => {
    event.preventDefault()
    slot.innerHTML = `<form class="plainform" id="dispute-form"><div><label for="d-reason">Reason for dispute</label><textarea id="d-reason" required></textarea></div><div><label for="d-docs">Documentation provided</label><select id="d-docs"><option value="no">No</option><option value="yes">Yes - attached</option></select></div><div class="buttons"><button type="submit">Submit Dispute</button></div></form>`
    slot.querySelector("#dispute-form").addEventListener("submit", async (event) => { event.preventDefault(); showResult(slot, await submit(record.invoiceId, "respond-to-dispute")) })
  })
}

document.querySelector("#submit-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const invoiceId = document.querySelector("#s-vendor-inv").value.trim().toUpperCase()
  showResult(document.querySelector("#submit-slot"), await submit(invoiceId, "resubmit-invoice"))
})
