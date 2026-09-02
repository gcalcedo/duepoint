const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
const dateFmt = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
const records = await (await fetch("/api/portal/halvorsen/invoices")).json()

document.querySelector("#k-pending").textContent = records.filter((r) => r.finding === "pending-approval").length
document.querySelector("#k-failed").textContent = records.filter((r) => r.finding === "rejected").length
document.querySelector("#k-paid").textContent = records.filter((r) => r.finding === "paid").length

document.querySelectorAll("[data-view]").forEach((link) => link.addEventListener("click", (event) => {
  event.preventDefault()
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === link))
  document.querySelectorAll(".tl-view").forEach((view) => view.hidden = view.id !== `view-${link.dataset.view}`)
  document.querySelector("#crumb").textContent = link.textContent
}))

const stages = ["Received", "Validated", "Delivered to buyer", "Approved", "Paid"]
const reached = { rejected: 1, "pending-approval": 3, "approved-scheduled": 4, paid: 5 }
const badge = { paid: ["ok", "Paid"], "approved-scheduled": ["ok", "Approved"], "pending-approval": ["wait", "Awaiting approval"], rejected: ["fail", "Validation failed"], disputed: ["fail", "Disputed"] }
function messageText(record) {
  switch (record.finding) {
    case "paid": return `Paid by buyer — payment ref ${record.paymentReference}, ${dateFmt(record.paidOn)}`
    case "approved-scheduled": return `Approved by buyer — payment due ${dateFmt(record.scheduledPayDate)}`
    case "pending-approval": return `Delivered to buyer — awaiting approval for ${record.approvalDays} days`
    case "rejected": return `Validation failed — ${record.rejectionReason}`
    case "disputed": return `Buyer query — ${record.disputeReason}`
  }
}
const referenceOf = (record) => record.finding === "paid" ? record.paymentReference : record.finding === "approved-scheduled" ? record.scheduledPayDate : ""

async function submit(invoiceId, action) {
  const response = await fetch("/api/portal/halvorsen/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId, action }) })
  return (await response.json()).reference
}
function showResult(container, reference, text) {
  document.querySelectorAll("[data-testid=submission-result]").forEach((node) => node.remove())
  const node = document.createElement("div")
  node.className = "tl-submitted"
  node.dataset.testid = "submission-result"
  node.dataset.reference = reference
  node.innerHTML = `${text} TradeLink document ID <b>${reference}</b>.`
  container.appendChild(node)
}

document.querySelector("#status-form").addEventListener("submit", (event) => {
  event.preventDefault()
  const buyer = document.querySelector("#buyer").value
  const reference = document.querySelector("#reference").value.trim().toUpperCase()
  const record = buyer === "halvorsen" ? records.find((candidate) => candidate.invoiceId === reference) : undefined
  const result = document.querySelector("#status-result")

  if (!record) {
    result.innerHTML = `<div class="tl-notfound"><b>No document found</b><p>No document found with reference ${reference} for this buyer. Check the reference, or key the invoice in manually so it reaches the buyer's AP system.</p><button type="button" class="tl-primary" id="key-in">Key in a new invoice</button><div id="key-slot"></div></div>`
    result.querySelector("#key-in").addEventListener("click", () => {
      const slot = result.querySelector("#key-slot")
      slot.innerHTML = `<form class="tl-panel" id="key-form" style="margin:14px 0 0"><p>Manual invoice — Halvorsen Logistics</p><div class="tl-fields"><div><label for="k-po">PO reference</label><input id="k-po" required /></div><div><label for="k-ref">Invoice reference</label><input id="k-ref" required /></div><div><label for="k-amount">Amount</label><input id="k-amount" required /></div></div><button type="submit" class="tl-primary">Submit to buyer</button></form>`
      slot.querySelector("#key-form").addEventListener("submit", async (event) => {
        event.preventDefault()
        const invoiceId = slot.querySelector("#k-ref").value.trim().toUpperCase()
        showResult(slot, await submit(invoiceId, "resubmit-invoice"), `Invoice ${invoiceId} delivered to Halvorsen Logistics.`)
      })
    })
    return
  }

  const [badgeClass, badgeText] = badge[record.finding]
  const level = reached[record.finding] ?? 0
  const actions = {
    "pending-approval": `<div class="tl-actions"><button type="button" class="tl-primary" id="remind">Send buyer a reminder</button></div><div id="action-slot"></div>`,
    rejected: `<div class="tl-actions"><button type="button" class="tl-primary" id="amend">Amend and resend</button></div><div id="action-slot"></div>`,
  }[record.finding] ?? ""

  result.innerHTML = `
    <div class="tl-result">
      <div class="tl-result-head"><div><b>${record.invoiceId}</b><small>Halvorsen Logistics · PO ${record.poNumber} · ${money.format(record.amount)}</small></div><span class="tl-badge ${badgeClass}" data-testid="invoice-status" data-finding="${record.finding}" data-reference="${referenceOf(record)}">${badgeText}</span></div>
      <div class="tl-timeline">${stages.map((stage, index) => `<div class="tl-step ${index < level ? "done" : ""} ${record.finding === "rejected" && index === 1 ? "fail" : ""}">${stage}</div>`).join("")}</div>
      <div class="tl-message ${badgeClass}" data-testid="status-detail">${messageText(record)}</div>
      <div class="tl-details"><div><small>Invoice date</small>${dateFmt(record.invoiceDate)}</div><div><small>Due date</small>${dateFmt(record.dueDate)}</div><div><small>Buyer entity</small>Halvorsen Logistics AS</div><div><small>Channel</small>TradeLink network</div></div>
      ${actions}
    </div>`

  result.querySelector("#remind")?.addEventListener("click", () => {
    const slot = result.querySelector("#action-slot")
    slot.innerHTML = `<div class="tl-panel"><p>A reminder will be sent to the buyer's AP team referencing ${record.invoiceId}. TradeLink limits reminders to one per document per 7 days.</p><button type="button" class="tl-primary" id="remind-confirm">Send reminder</button></div>`
    slot.querySelector("#remind-confirm").addEventListener("click", async () => showResult(slot, await submit(record.invoiceId, "request-status"), "Reminder sent to Halvorsen Logistics AP."))
  })
  result.querySelector("#amend")?.addEventListener("click", () => {
    const slot = result.querySelector("#action-slot")
    slot.innerHTML = `<form class="tl-panel" id="amend-form"><p>Correct the failing field and resend. The document keeps its original reference.</p><div class="tl-fields"><div><label for="billto">Bill-to entity</label><select id="billto" required><option value="">Select entity</option><option value="rotterdam">Halvorsen Logistics — Rotterdam (legacy)</option><option value="oslo">Halvorsen Logistics AS — Oslo (buyer master)</option></select></div><div><label for="a-ref">Reference</label><input id="a-ref" value="${record.invoiceId}" readonly /></div><div><label for="a-amount">Total</label><input id="a-amount" value="${record.amount.toFixed(2)}" readonly /></div></div><button type="submit" class="tl-primary">Resend</button></form>`
    slot.querySelector("#amend-form").addEventListener("submit", async (event) => {
      event.preventDefault()
      showResult(slot, await submit(record.invoiceId, "correct-and-resubmit"), `${record.invoiceId} re-validated and delivered to the buyer.`)
    })
  })
})
