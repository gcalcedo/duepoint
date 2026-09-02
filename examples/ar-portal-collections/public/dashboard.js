const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 })
let lastEventId = 0
let selectedId
let userPinned = false
let latestState
let view = "all"

const findingLabels = {
  paid: "Paid",
  "approved-scheduled": "Approved · payment scheduled",
  "pending-approval": "Pending approval",
  "not-received": "Not received",
  rejected: "Rejected",
  disputed: "Disputed",
  "no-portal": "No portal",
  unknown: "Could not determine",
}

const actionLabels = {
  "match-remittance": "Match remittance",
  "record-promise": "Record promise",
  "request-status": "Request status",
  "resubmit-invoice": "Resubmit invoice",
  "correct-and-resubmit": "Correct & resubmit",
  "respond-to-dispute": "Respond to dispute",
  "send-statement": "Send statement",
}

const statusLabels = { queued: "Queued", checking: "Checking", "needs-review": "Review", done: "Done", escalated: "Escalated" }
const shortResolutions = {
  "Matched & closed": "Matched",
  "Promise recorded": "Promise",
  "Status requested": "Nudged",
  Resubmitted: "Resubmitted",
  "Corrected & resubmitted": "Corrected",
  "Dispute response sent": "Responded",
  "Statement sent": "Statement",
}
const finished = ["done", "escalated"]

const views = {
  all: { title: "Overdue", match: () => true },
  active: { title: "In progress", match: (invoice) => ["queued", "checking"].includes(invoice.status) },
  review: { title: "Needs review", match: (invoice) => invoice.status === "needs-review" },
  done: { title: "Completed", match: (invoice) => finished.includes(invoice.status) },
}

function escape(value) {
  const element = document.createElement("div")
  element.textContent = String(value ?? "")
  return element.innerHTML
}

function icon(name) {
  return `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"></use></svg>`
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options })
  const body = await response.json()
  if (!response.ok) throw new Error(body.error ?? "Request failed")
  return body
}

function statusClass(invoice) {
  if (invoice.status === "done") return invoice.cashBucket === "confirmed" ? "success" : "success"
  if (invoice.status === "needs-review") return "warning"
  if (invoice.status === "escalated") return "muted"
  if (invoice.status === "checking") return "working"
  return "queued"
}

function statusText(invoice) {
  if (invoice.status === "done") return shortResolutions[invoice.resolution] ?? invoice.resolution ?? "Done"
  return statusLabels[invoice.status]
}

function contextBadge(invoice) {
  if (invoice.status === "needs-review") return { text: "Needs review", className: "review" }
  if (invoice.status === "checking") return { text: `Checking ${invoice.portal ?? ""}`.trim(), className: "working" }
  if (invoice.status === "done") return { text: invoice.resolution ?? "Done", className: "success" }
  if (invoice.status === "escalated") return { text: "Escalated", className: "" }
  return { text: "Queued", className: "" }
}

function renderDetail(invoice) {
  const detail = document.querySelector("#invoice-detail")
  if (!invoice) {
    detail.innerHTML = `<div class="empty-context"><div><span>${icon("search")}</span><h3>No invoice selected</h3><p>Select an invoice to see what the customer's portal says and what happens next.</p></div></div>`
    return
  }

  const badge = contextBadge(invoice)
  const awaitingCheck = !invoice.finding
  const isReview = invoice.requiresApproval && !finished.includes(invoice.status)
  const callout = awaitingCheck
    ? `<div class="context-callout"><b>${icon("globe")}${invoice.portal ? `Awaiting ${escape(invoice.portal)} check` : "No customer portal"}</b><p>${invoice.portal ? `The agent will look this invoice up in ${escape(invoice.portal)} and decide what to do from what the portal shows.` : `${escape(invoice.customerName)} has no AP portal on file; the queue will hold this for a manual statement.`}</p></div>`
    : `<div class="context-callout ${isReview ? "review" : ""}"><b>${icon(isReview ? "shield" : "sparkles")}${isReview ? "Approval required" : "Recommendation"}</b><p>${escape(invoice.rationale)}</p></div>`

  const footer = invoice.status === "needs-review"
    ? `<div class="context-actions"><button class="calm-button" data-reject="${invoice.id}">Escalate</button><button class="calm-button primary" data-approve="${invoice.id}">${icon("check")}Approve</button></div>`
    : invoice.status === "done"
      ? `<div class="context-confirmation">${icon("check")}Posted to Corvus AR${invoice.confirmation ? ` · ${escape(invoice.confirmation)}` : ""}</div>`
      : ""

  detail.innerHTML = `
    <div class="context-heading"><span class="${badge.className}">${escape(badge.text)}</span></div>
    <h3>${awaitingCheck ? "Not checked yet" : escape(findingLabels[invoice.finding])}</h3>
    <p class="context-subtitle">${escape(invoice.id)} · ${escape(invoice.customerName)} · PO ${escape(invoice.poNumber)}</p>
    ${callout}
    <div class="context-stats"><div><small>Amount</small><b>${money.format(invoice.amount)}</b></div><div><small>Due</small><b class="${invoice.daysOverdue >= 30 ? "urgent" : ""}">${invoice.daysOverdue}d overdue</b></div><div><small>Confidence</small><b>${invoice.confidence ? `${Math.round(invoice.confidence * 100)}%` : "—"}</b></div></div>
    <div class="context-evidence"><b>Evidence</b>
      <span>${icon("hash")}PO ${escape(invoice.poNumber)}<em>${escape(invoice.dueDate)}</em></span>
      ${invoice.findingDetail ? `<span>${icon("globe")}${escape(invoice.findingDetail)}<em>${escape(invoice.portal ?? "AR")}</em></span>` : ""}
      ${invoice.portalReference || invoice.confirmation ? `<span>${icon("file")}${escape(invoice.confirmation ?? invoice.portalReference)}<em>reference</em></span>` : ""}
      <span>${icon("mail")}${escape(invoice.apContact)}<em>AP contact</em></span>
      ${invoice.lookupSession ? `<span>${icon("cloud")}<a href="/api/replay/${escape(invoice.lookupSession)}" target="_blank" rel="noopener">Portal check replay</a><em>Solari</em></span>` : ""}
      ${invoice.actionSession ? `<span>${icon("cloud")}<a href="/api/replay/${escape(invoice.actionSession)}" target="_blank" rel="noopener">Portal action replay</a><em>Solari</em></span>` : ""}
      ${invoice.arSession ? `<span>${icon("cloud")}<a href="/api/replay/${escape(invoice.arSession)}" target="_blank" rel="noopener">Corvus AR replay</a><em>Solari</em></span>` : ""}
    </div>
    ${footer}`

  bindDecisionButtons(detail)
}

function bindDecisionButtons(scope = document) {
  scope.querySelectorAll("[data-approve]").forEach((button) => button.addEventListener("click", () => decide(button.dataset.approve, "approve")))
  scope.querySelectorAll("[data-reject]").forEach((button) => button.addEventListener("click", () => decide(button.dataset.reject, "reject")))
}

function renderPortals(state) {
  const cards = Object.entries(state.customers).map(([slug, customer]) => {
    const invoices = state.invoices.filter((invoice) => invoice.customer === slug)
    const total = invoices.reduce((sum, invoice) => sum + invoice.amount, 0)
    const checking = invoices.some((invoice) => invoice.status === "checking")
    const started = invoices.some((invoice) => invoice.status !== "queued")
    const complete = invoices.every((invoice) => invoice.status !== "queued" && invoice.status !== "checking")
    const stateLabel = checking ? "Checking" : complete && started ? "Checked" : "Queued"
    const stateClass = checking ? "working" : complete && started ? "success" : "queued"
    return `
      <article class="portal-card ${checking ? "live" : ""}">
        <span class="portal-mark ${slug}">${escape(customer.name.split(" ").map((word) => word[0]).slice(0, 2).join(""))}</span>
        <div><b>${escape(customer.name)}</b><small>${escape(customer.portal ?? customer.portalNote)}</small></div>
        <div class="portal-meta"><span>${invoices.length} inv · ${compact.format(total)}</span><span class="status ${stateClass}"><i></i>${stateLabel}</span></div>
      </article>`
  })
  document.querySelector("#portals").innerHTML = cards.join("")
}

function renderInvoices(state) {
  const visible = state.invoices.filter(views[view].match)
  const table = document.querySelector("#invoice-table")
  if (visible.length === 0) {
    table.innerHTML = `<div class="empty-list">No invoices in this view.</div>`
    return
  }

  table.innerHTML = visible.map((invoice) => `
    <button class="claim-row ${invoice.id === selectedId ? "selected" : ""} ${invoice.status === "checking" ? "active-row" : ""}" data-invoice-id="${invoice.id}">
      <span><b class="mono">${escape(invoice.id)}</b><small>PO ${escape(invoice.poNumber)}</small></span>
      <span class="customer-cell"><i class="portal-mark small ${invoice.customer}">${escape(invoice.customerName[0])}</i><span><b>${escape(invoice.customerName)}</b><small>${escape(invoice.portal ?? "No portal")}</small></span></span>
      <span><b class="value">${money.format(invoice.amount)}</b><small>${invoice.daysOverdue} days overdue</small></span>
      <span>${invoice.finding ? `<b>${escape(findingLabels[invoice.finding])}</b><small>${escape(invoice.findingDetail ?? "")}</small>` : `<small class="pending-cell">—</small>`}</span>
      <span class="action-cell">${invoice.recommendedAction ? `<i class="action-icon ${invoice.requiresApproval ? "manual" : ""}">${icon(invoice.requiresApproval ? "user-check" : "arrow")}</i><span>${escape(actionLabels[invoice.recommendedAction])}</span>` : `<small class="pending-cell">—</small>`}</span>
      <span class="status ${statusClass(invoice)}"><i></i>${escape(statusText(invoice))}</span>
    </button>`).join("")

  table.querySelectorAll("[data-invoice-id]").forEach((row) => row.addEventListener("click", () => {
    selectedId = row.dataset.invoiceId
    userPinned = true
    table.querySelectorAll("[data-invoice-id]").forEach((item) => item.classList.toggle("selected", item.dataset.invoiceId === selectedId))
    renderDetail(latestState.invoices.find((invoice) => invoice.id === selectedId))
  }))
}

function render(state) {
  latestState = state
  const { summary } = state
  const pendingReview = state.invoices.filter((invoice) => invoice.status === "needs-review")
  const queued = state.invoices.filter((invoice) => invoice.status === "queued").length
  const customerCount = new Set(state.invoices.map((invoice) => invoice.customer)).size

  document.querySelector("#stat-confirmed").textContent = money.format(summary.confirmed)
  document.querySelector("#stat-processed").textContent = summary.processed
  document.querySelector("#stat-total").textContent = summary.totalInvoices
  document.querySelector("#stat-overdue").textContent = compact.format(summary.overdue)
  document.querySelector("#stat-overdue-sub").textContent = `${summary.totalInvoices} invoices · ${customerCount} customers`
  document.querySelector("#stat-unblocked").textContent = compact.format(summary.unblocked)
  document.querySelector("#stat-review").textContent = summary.pendingApproval
  document.querySelector("#stat-review-sub").textContent = summary.atRisk ? `${compact.format(summary.atRisk)} at risk` : "Nothing at risk"
  document.querySelector("#stat-hours").textContent = summary.hoursAvoided.toFixed(1)
  document.querySelector("#queue-progress-fill").style.width = `${Math.round((summary.processed / summary.totalInvoices) * 100)}%`
  document.querySelector("#run-label").textContent = state.runStatus
  document.querySelector("#eligible-count").textContent = queued || ""
  document.body.dataset.runStatus = state.runStatus
  document.querySelector("#run-button").disabled = state.runStatus === "running" || queued === 0

  const isSolari = state.executionProvider === "solari" || state.browserMcp === "solari"
  document.querySelector("#provider-pill").textContent = state.worker ?? (isSolari ? "Solari cloud browser" : "Local browser")
  document.querySelector("#provider-icon use").setAttribute("href", isSolari ? "#icon-cloud" : "#icon-laptop")

  for (const [key, definition] of Object.entries(views)) {
    document.querySelector(`#nav-count-${key}`).textContent = key === "all" ? summary.totalInvoices : state.invoices.filter(definition.match).length || ""
  }
  document.querySelector("#view-title").textContent = views[view].title
  const visibleCount = state.invoices.filter(views[view].match).length
  document.querySelector("#queue-subtitle").textContent = `${visibleCount} ${visibleCount === 1 ? "invoice" : "invoices"}`

  const checking = state.invoices.filter((invoice) => invoice.status === "checking")
  if (checking.length && !userPinned) {
    // Follow the most recently touched active invoice so the panel tracks the parallel workers.
    const latestTouched = state.events.find((event) => event.invoiceId && checking.some((invoice) => invoice.id === event.invoiceId))
    selectedId = latestTouched?.invoiceId ?? checking[0].id
  } else if (!userPinned && pendingReview.length && state.runStatus !== "running") {
    selectedId = pendingReview[0].id
  }
  if (!selectedId || !state.invoices.some((invoice) => invoice.id === selectedId)) {
    selectedId = [...state.invoices].sort((a, b) => b.amount - a.amount)[0]?.id
  }

  renderPortals(state)
  renderInvoices(state)
  renderDetail(state.invoices.find((invoice) => invoice.id === selectedId))

  document.querySelector("#activity-stream").innerHTML = state.events.slice(0, 14).map((event) => `
    <div class="event ${event.kind}">
      <div class="event-icon">${icon(event.kind === "approval" ? "alert" : event.kind === "complete" ? "check" : event.kind === "lookup" ? "globe" : event.kind === "agent" ? "cursor" : "sparkles")}</div>
      <div><div class="event-meta"><b>${escape(event.invoiceId ?? (event.customer ? state.customers[event.customer]?.name : "System"))}</b><time>${new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></div><p>${escape(event.message)}</p></div>
    </div>`).join("")

  if (state.events[0]?.id > lastEventId && lastEventId !== 0 && state.events[0].kind !== "agent") showToast(state.events[0].message)
  lastEventId = Math.max(lastEventId, state.events[0]?.id ?? 0)
}

async function refresh() {
  try { render(await api("/api/state")) } catch (error) { showToast(error.message, true) }
}

async function decide(id, decision) {
  try {
    await api(`/api/invoices/${id}/${decision}`, { method: "POST", body: "{}" })
    selectedId = id
    userPinned = true
    showToast(decision === "approve" ? `${id} approved` : `${id} escalated to the account manager`)
    await refresh()
  } catch (error) { showToast(error.message, true) }
}

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast")
  toast.textContent = message
  toast.className = `toast show ${isError ? "error" : ""}`
  clearTimeout(window.toastTimer)
  window.toastTimer = setTimeout(() => toast.className = "toast", 3200)
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  view = button.dataset.view
  document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button))
  if (latestState) render(latestState)
}))

document.querySelector("#run-button").addEventListener("click", async () => {
  try { await api("/api/run", { method: "POST", body: "{}" }); userPinned = false; showToast("Checking customer portals"); refresh() }
  catch (error) { showToast(error.message, true) }
})

document.querySelector("#reset-button").addEventListener("click", async () => {
  try { await api("/api/reset", { method: "POST", body: "{}" }); lastEventId = 0; selectedId = undefined; userPinned = false; showToast("Queue reset"); refresh() }
  catch (error) { showToast(error.message, true) }
})

refresh()
setInterval(refresh, 600)
