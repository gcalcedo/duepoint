const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
const dateFmt = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
const records = await (await fetch("/api/portal/atlas/invoices")).json()

const chip = { paid: ["paid", "Paid"], "approved-scheduled": ["approved", "Approved"], "pending-approval": ["pending", "Pending approval"], disputed: ["disputed", "Disputed"], rejected: ["disputed", "Rejected"] }
function detailText(record) {
  switch (record.finding) {
    case "paid": return `Paid · ${record.paymentReference} · ${dateFmt(record.paidOn)}`
    case "approved-scheduled": return `Approved · Payment scheduled ${dateFmt(record.scheduledPayDate)}`
    case "pending-approval": return `Pending approval · ${record.approvalDays} days with approver`
    case "disputed": return `Disputed · ${record.disputeReason} · ${money.format(record.disputeAmount)} short-paid`
    case "rejected": return `Rejected · ${record.rejectionReason}`
  }
}
const referenceOf = (record) => record.finding === "paid" ? record.paymentReference : record.finding === "approved-scheduled" ? record.scheduledPayDate : ""

document.querySelector("#c-pending").textContent = records.filter((r) => r.finding === "pending-approval").length
document.querySelector("#c-disputed").textContent = records.filter((r) => r.finding === "disputed").length
document.querySelector("#c-scheduled").textContent = records.filter((r) => r.finding === "approved-scheduled").length
document.querySelector("#c-paid").textContent = records.filter((r) => r.finding === "paid").length
document.querySelector("#activity").innerHTML = records.slice(0, 5).map((r) => `<li>${r.invoiceId} · ${chip[r.finding][1]}<span>${dateFmt(r.invoiceDate)}</span></li>`).join("")

let currentQuery = ""
document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault()
  currentQuery = document.querySelector("#global-search").value.trim().toUpperCase()
  const matches = records.filter((record) => record.invoiceId.includes(currentQuery) || record.poNumber.toUpperCase().includes(currentQuery))
  document.querySelector("#home").hidden = true
  document.querySelector("#results").hidden = false
  document.querySelector("#results-query").textContent = `for “${currentQuery}”`
  document.querySelector("#empty-query").textContent = currentQuery
  document.querySelector("#results-empty").hidden = matches.length > 0
  document.querySelector("#result-list").innerHTML = matches.map((record) => `
    <button type="button" class="ph-result" data-testid="result-card" data-open="${record.invoiceId}">
      <div><b>${record.invoiceId}</b><small>Invoice · PO ${record.poNumber} · ${dateFmt(record.invoiceDate)}</small></div>
      <div class="amount">${money.format(record.amount)}<small><span class="ph-chip ${chip[record.finding][0]}">${chip[record.finding][1]}</span></small></div>
    </button>`).join("")
  document.querySelectorAll("[data-open]").forEach((card) => card.addEventListener("click", () => openDrawer(card.dataset.open)))
})

async function submit(invoiceId, action) {
  const response = await fetch("/api/portal/atlas/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ invoiceId, action }) })
  return (await response.json()).reference
}

function confirm(text) {
  const dialog = document.querySelector("#confirm-dialog")
  document.querySelector("#confirm-text").textContent = text
  dialog.showModal()
  return new Promise((resolve) => {
    const done = (value) => { dialog.close(); ok.onclick = cancel.onclick = null; resolve(value) }
    const ok = document.querySelector("#confirm-ok"), cancel = document.querySelector("#confirm-cancel")
    ok.onclick = () => done(true)
    cancel.onclick = () => done(false)
  })
}

function showResult(container, reference, text) {
  document.querySelectorAll("[data-testid=submission-result]").forEach((node) => node.remove())
  const banner = document.createElement("div")
  banner.className = "ph-result-banner"
  banner.dataset.testid = "submission-result"
  banner.dataset.reference = reference
  banner.innerHTML = `${text} Reference <b>${reference}</b>.`
  container.appendChild(banner)
}

function openDrawer(id) {
  const record = records.find((candidate) => candidate.invoiceId === id)
  const drawer = document.querySelector("#drawer")
  const [chipClass, chipText] = chip[record.finding]
  const steps = ["Submitted", "Received", "In approval", "Approved", "Paid"]
  const reached = { "pending-approval": 3, "approved-scheduled": 4, paid: 5, disputed: 3, rejected: 2 }[record.finding]

  const actions = {
    "pending-approval": `<div class="ph-thread"><div class="ph-msg"><small>You · ${dateFmt(record.invoiceDate)}</small>Invoice submitted against PO ${record.poNumber}.</div><div class="ph-msg buyer"><small>Atlas AP · system</small>Routed to approver. ${record.approvalDays} days in queue.</div></div>
      <form class="ph-compose" id="comment-form"><label for="comment">Add a comment</label><input id="comment" required placeholder="Message the AP team" /><div class="row"><button type="submit" class="ph-primary">Post</button></div></form>`,
    disputed: `<div class="ph-thread"><div class="ph-msg buyer"><small>Atlas AP · dispute opened</small>${record.disputeReason}. Short-paid ${money.format(record.disputeAmount)} pending supplier response.</div></div>
      <form class="ph-compose" id="dispute-form"><label for="reply">Reply to dispute</label><textarea id="reply" required></textarea><label class="toggle"><input type="checkbox" id="attach" /> Include supporting documents</label><div class="row"><button type="submit" class="ph-primary">Send reply</button></div></form>`,
  }[record.finding] ?? ""

  drawer.hidden = false
  drawer.innerHTML = `
    <div class="ph-drawer-head"><div><h3>${record.invoiceId}</h3><small>Atlas Retail Group · PO ${record.poNumber}</small></div><button type="button" class="ph-close" id="close-drawer" aria-label="Close">✕</button></div>
    <div style="margin-top:14px"><span class="ph-chip ${chipClass}" data-testid="invoice-status" data-finding="${record.finding}" data-reference="${referenceOf(record)}">${chipText}</span></div>
    <div class="ph-detail ${record.finding === "disputed" ? "disputed" : ["paid", "approved-scheduled"].includes(record.finding) ? "ok" : ""}" data-testid="status-detail">${detailText(record)}</div>
    <div class="ph-grid"><div><small>Amount</small><b>${money.format(record.amount)}</b></div><div><small>Due</small><b>${dateFmt(record.dueDate)}</b></div><div><small>Invoice date</small><b>${dateFmt(record.invoiceDate)}</b></div><div><small>Payment terms</small><b>Net 30</b></div></div>
    <ul class="ph-timeline">${steps.map((step, index) => `<li class="${index < reached ? "" : "pending"}">${step}${index === 4 && record.paidOn ? `<span>${dateFmt(record.paidOn)} · ${record.paymentReference}</span>` : ""}${index === 3 && record.scheduledPayDate ? `<span>Payment scheduled ${dateFmt(record.scheduledPayDate)}</span>` : ""}</li>`).join("")}</ul>
    ${actions}`

  drawer.querySelector("#close-drawer").addEventListener("click", () => drawer.hidden = true)
  drawer.querySelector("#comment-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    showResult(drawer, await submit(record.invoiceId, "request-status"), "Comment posted to Atlas AP.")
  })
  drawer.querySelector("#dispute-form")?.addEventListener("submit", async (event) => {
    event.preventDefault()
    if (!(await confirm("Send this reply to Atlas Retail Group accounts payable? The dispute will move to “Supplier responded”."))) return
    showResult(drawer, await submit(record.invoiceId, "respond-to-dispute"), "Reply sent. The dispute is now awaiting buyer review.")
  })
}

document.querySelector("#create-invoice").addEventListener("click", async () => {
  const wizard = document.querySelector("#wizard")
  const openPos = await (await fetch("/api/portal/atlas/open-pos")).json()
  let po
  wizard.innerHTML = `
    <div class="ph-steps"><b>1 Select PO</b><span>›</span><span>2 Details</span><span>›</span><span>3 Review</span></div>
    <h3>Create invoice</h3>
    <form class="ph-compose" id="step1"><label for="po-select">Purchase order</label><select id="po-select" required><option value="">Choose an open purchase order</option>${openPos.map((item) => `<option value="${item.poNumber}">${item.poNumber} · ${money.format(item.amount)}</option>`).join("")}</select><div class="row"><button type="button" class="ph-button" id="w-cancel">Cancel</button><button type="submit" class="ph-primary">Next</button></div></form>`
  wizard.showModal()
  wizard.querySelector("#w-cancel").addEventListener("click", () => wizard.close())
  wizard.querySelector("#step1").addEventListener("submit", (event) => {
    event.preventDefault()
    po = openPos.find((item) => item.poNumber === wizard.querySelector("#po-select").value)
    wizard.innerHTML = `
      <div class="ph-steps"><span>1 Select PO</span><span>›</span><b>2 Details</b><span>›</span><span>3 Review</span></div>
      <h3>Invoice details</h3>
      <form class="ph-compose" id="step2"><label for="w-invoice">Invoice number</label><input id="w-invoice" required /><label for="w-amount">Amount</label><input id="w-amount" value="${po.amount.toFixed(2)}" /><label for="w-date">Invoice date</label><input id="w-date" value="${new Date().toISOString().slice(0, 10)}" /><div class="row"><button type="button" class="ph-button" id="w-cancel2">Cancel</button><button type="submit" class="ph-primary">Submit invoice</button></div></form>`
    wizard.querySelector("#w-cancel2").addEventListener("click", () => wizard.close())
    wizard.querySelector("#step2").addEventListener("submit", (event) => {
      event.preventDefault()
      const invoiceId = wizard.querySelector("#w-invoice").value.trim().toUpperCase()
      const amount = wizard.querySelector("#w-amount").value
      wizard.innerHTML = `
        <div class="ph-steps"><span>1 Select PO</span><span>›</span><span>2 Details</span><span>›</span><b>3 Review</b></div>
        <h3>Review and confirm</h3>
        <div class="ph-review"><div><small>Invoice</small>${invoiceId}</div><div><small>Purchase order</small>${po.poNumber}</div><div><small>Amount</small>${money.format(Number(amount))}</div><div><small>Bill to</small>Atlas Retail Group</div></div>
        <div id="w-result"></div>
        <div class="ph-dialog-actions"><button type="button" class="ph-button" id="w-back">Back</button><button type="button" class="ph-primary" id="w-confirm">Confirm</button></div>`
      wizard.querySelector("#w-back").addEventListener("click", () => wizard.close())
      wizard.querySelector("#w-confirm").addEventListener("click", async () => {
        showResult(wizard.querySelector("#w-result"), await submit(invoiceId, "resubmit-invoice"), `Invoice ${invoiceId} submitted to Atlas Retail Group.`)
        wizard.querySelector("#w-confirm").remove()
        wizard.querySelector("#w-back").textContent = "Done"
      })
    })
  })
})
