const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
const records = await (await fetch("/api/portal/meridian/invoices")).json()
let filtered = records

const statusLabel = { paid: "Paid", "approved-scheduled": "Approved", "pending-approval": "Pending Approval", rejected: "Rejected", disputed: "Disputed" }
const statusClass = { paid: "paid", "approved-scheduled": "approved", "pending-approval": "pending", rejected: "rejected", disputed: "disputed" }
const routing = { paid: "Acknowledged", "approved-scheduled": "Acknowledged", "pending-approval": "Sent", rejected: "Failed", disputed: "Acknowledged" }

function detailText(record) {
  switch (record.finding) {
    case "paid": return `Paid — remittance ${record.paymentReference} on ${record.paidOn}`
    case "approved-scheduled": return `Approved — scheduled payment ${record.scheduledPayDate}`
    case "pending-approval": return `Pending Approval — ${record.approvalDays} days in buyer routing`
    case "rejected": return `Rejected — ${record.rejectionReason}`
    case "disputed": return `Disputed — ${record.disputeReason} (${money.format(record.disputeAmount)} withheld)`
  }
}
function referenceOf(record) {
  return record.finding === "paid" ? record.paymentReference : record.finding === "approved-scheduled" ? record.scheduledPayDate : ""
}

document.querySelector("#tile-pending").textContent = records.filter((r) => r.finding === "pending-approval").length
document.querySelector("#tile-rejected").textContent = records.filter((r) => r.finding === "rejected").length
document.querySelector("#tile-scheduled").textContent = records.filter((r) => r.finding === "approved-scheduled").length

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button))
  document.querySelectorAll(".sn-view").forEach((view) => view.hidden = view.id !== `view-${button.dataset.view}`)
  if (button.dataset.view === "invoices") showList()
}))

function showList() {
  document.querySelector("#invoice-detail").hidden = true
  document.querySelector("#invoice-create").hidden = true
  document.querySelector("#invoice-list").hidden = false
  document.querySelector(".sn-filters").hidden = false
  renderRows()
}

function renderRows() {
  const rows = document.querySelector("#invoice-rows")
  rows.innerHTML = filtered.map((record) => `
    <tr>
      <td><a href="#" data-open="${record.invoiceId}">${record.invoiceId}</a></td>
      <td>Meridian Manufacturing</td>
      <td>${record.poNumber}</td>
      <td>${record.invoiceDate}</td>
      <td class="num">${money.format(record.amount)}</td>
      <td>${routing[record.finding]}</td>
      <td><span class="sn-status ${statusClass[record.finding]}">${statusLabel[record.finding]}</span></td>
    </tr>`).join("")
  document.querySelector("#empty").hidden = filtered.length > 0
  rows.querySelectorAll("[data-open]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); openDetail(link.dataset.open) }))
}

document.querySelector("#filter-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const query = document.querySelector("#filter-invoice").value.trim().toUpperCase()
  filtered = query ? records.filter((record) => record.invoiceId.includes(query)) : records
  renderRows()
})
document.querySelector("#filter-reset").addEventListener("click", () => { document.querySelector("#filter-invoice").value = ""; filtered = records; renderRows() })

async function submit(record, action) {
  const response = await fetch("/api/portal/meridian/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId: record.invoiceId, action }) })
  return (await response.json()).reference
}

function showResult(container, reference, text) {
  document.querySelectorAll("[data-testid=submission-result]").forEach((node) => node.remove())
  const result = document.createElement("div")
  result.className = "sn-result"
  result.dataset.testid = "submission-result"
  result.dataset.reference = reference
  result.innerHTML = `<b>${text}</b> Document number <b>${reference}</b>.`
  container.appendChild(result)
}

function openDetail(id) {
  const record = records.find((candidate) => candidate.invoiceId === id)
  const detail = document.querySelector("#invoice-detail")
  document.querySelector("#invoice-list").hidden = true
  detail.hidden = false

  const actionSection = {
    "pending-approval": `<div class="sn-section"><h2>Comments</h2><p class="sn-banner info">Comments are visible to the buyer's accounts payable team.</p><form class="sn-form" id="comment-form"><label for="comment">Comment</label><textarea id="comment" required></textarea><div class="sn-actions"><button type="submit" class="sn-primary">Add Comment</button></div></form></div>`,
    rejected: `<div class="sn-section"><h2>Rejection</h2><p class="sn-banner"><b>Rejected by buyer:</b> ${record.rejectionReason}. Correct the invoice and resubmit.</p><div class="sn-actions"><button type="button" class="sn-primary" id="edit-resubmit">Edit and Resubmit</button></div><div id="resubmit-slot"></div></div>`,
    disputed: `<div class="sn-section"><h2>Dispute</h2><p class="sn-banner"><b>Buyer dispute:</b> ${record.disputeReason}. ${money.format(record.disputeAmount)} withheld pending supplier response.</p><div class="sn-actions"><button type="button" class="sn-primary" id="respond-dispute">Respond to Dispute</button></div><div id="dispute-slot"></div></div>`,
  }[record.finding] ?? ""

  detail.innerHTML = `
    <button type="button" class="sn-back" id="back">‹ Back to invoices</button>
    <div class="sn-detail">
      <div class="sn-detail-head"><div><h1>Invoice ${record.invoiceId}</h1><small>Meridian Manufacturing · Reference ${record.poNumber}</small></div>
        <span class="sn-status ${statusClass[record.finding]}" data-testid="invoice-status" data-finding="${record.finding}" data-reference="${referenceOf(record)}">${statusLabel[record.finding]}</span></div>
      <div class="sn-section"><p class="sn-banner ${["paid", "approved-scheduled"].includes(record.finding) ? "ok" : record.finding === "pending-approval" ? "info" : ""}" data-testid="status-detail">${detailText(record)}</p></div>
      <div class="sn-section"><h2>Summary</h2><div class="sn-kv">
        <div><small>Purchase order</small><b>${record.poNumber}</b></div><div><small>Invoice date</small><b>${record.invoiceDate}</b></div><div><small>Due date</small><b>${record.dueDate}</b></div><div><small>Amount</small><b>${money.format(record.amount)}</b></div></div></div>
      <div class="sn-section"><h2>Payment</h2><div class="sn-kv">
        <div><small>Scheduled payment date</small><b>${record.scheduledPayDate ?? "—"}</b></div><div><small>Payment reference</small><b>${record.paymentReference ?? "—"}</b></div><div><small>Paid on</small><b>${record.paidOn ?? "—"}</b></div><div><small>Payment terms</small><b>Net 30</b></div></div></div>
      <div class="sn-section"><h2>History</h2><ul class="sn-history"><li>${record.invoiceDate} · Invoice submitted by supplier</li><li>${record.invoiceDate} · Routing status: Sent</li>${record.finding === "rejected" ? `<li>Routing status: Failed — ${record.rejectionReason}</li>` : `<li>Routing status: Acknowledged</li>`}${record.finding === "paid" ? `<li>${record.paidOn} · Payment ${record.paymentReference} remitted</li>` : ""}</ul></div>
      ${actionSection}
    </div>`

  detail.querySelector("#back").addEventListener("click", showList)
  detail.querySelector("#comment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    showResult(detail.querySelector("#comment-form").parentElement, await submit(record, "request-status"), "Comment posted to the buyer.")
  })
  detail.querySelector("#edit-resubmit")?.addEventListener("click", () => {
    const slot = detail.querySelector("#resubmit-slot")
    slot.innerHTML = `<form class="sn-form" id="resubmit-form"><label for="po-number">Customer PO number</label><input id="po-number" required placeholder="Required by buyer" /><label for="inv-amount">Amount</label><input id="inv-amount" value="${record.amount.toFixed(2)}" readonly /><div class="sn-actions"><button type="submit" class="sn-primary">Resubmit</button></div></form>`
    slot.querySelector("#resubmit-form").addEventListener("submit", async (event) => {
      event.preventDefault()
      showResult(slot, await submit(record, "correct-and-resubmit"), "Invoice resubmitted to Meridian Manufacturing.")
    })
  })
  detail.querySelector("#respond-dispute")?.addEventListener("click", () => {
    const slot = detail.querySelector("#dispute-slot")
    slot.innerHTML = `<form class="sn-form" id="dispute-form"><label for="response">Response</label><textarea id="response" required></textarea><label class="check"><input type="checkbox" id="attach" /> Attach PO and delivery proof</label><div class="sn-actions"><button type="submit" class="sn-primary">Send Response</button></div></form>`
    slot.querySelector("#dispute-form").addEventListener("submit", async (event) => {
      event.preventDefault()
      showResult(slot, await submit(record, "respond-to-dispute"), "Dispute response sent to the buyer.")
    })
  })
}

document.querySelector("#create-invoice").addEventListener("click", () => {
  const create = document.querySelector("#invoice-create")
  document.querySelector("#invoice-list").hidden = true
  create.hidden = false
  create.innerHTML = `
    <button type="button" class="sn-back" id="create-back">‹ Back to invoices</button>
    <div class="sn-detail"><div class="sn-detail-head"><div><h1>Create Invoice from Purchase Order</h1><small>Step 1 of 2 — locate the buyer's purchase order</small></div></div>
      <div class="sn-section"><form class="sn-form" id="po-form"><label for="po-lookup">Purchase order number</label><div class="row"><input id="po-lookup" required placeholder="e.g. MM-77000" /><button type="submit" class="sn-primary">Look up</button></div></form><div id="po-slot"></div></div>
    </div>`
  create.querySelector("#create-back").addEventListener("click", showList)
  create.querySelector("#po-form").addEventListener("submit", async (event) => {
    event.preventDefault()
    const po = create.querySelector("#po-lookup").value.trim().toUpperCase()
    const response = await fetch(`/api/portal/meridian/po/${encodeURIComponent(po)}`)
    const slot = create.querySelector("#po-slot")
    if (!response.ok) { slot.innerHTML = `<p class="sn-banner">Purchase order ${po} was not found for this buyer.</p>`; return }
    const details = await response.json()
    slot.innerHTML = `
      <div class="sn-po" data-testid="po-details"><div><small>PO</small>${details.poNumber}</div><div><small>Buyer</small>${details.buyer}</div><div><small>Open amount</small>${money.format(details.amount)}</div><div><small>Description</small>${details.description}</div></div>
      <form class="sn-form" id="create-form"><label for="sup-invoice">Supplier invoice number</label><input id="sup-invoice" required /><label for="create-amount">Amount</label><input id="create-amount" value="${details.amount.toFixed(2)}" /><div class="sn-actions"><button type="submit" class="sn-primary">Submit Invoice</button></div></form>`
    slot.querySelector("#create-form").addEventListener("submit", async (event) => {
      event.preventDefault()
      const invoiceId = create.querySelector("#sup-invoice").value.trim().toUpperCase()
      showResult(slot, await submit({ invoiceId }, "resubmit-invoice"), `Invoice ${invoiceId} submitted to Meridian Manufacturing.`)
    })
  })
})
