const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
let current

document.querySelector("#search-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const id = document.querySelector("#invoice-number").value.trim().toUpperCase()
  const response = await fetch(`/api/ar/invoices/${encodeURIComponent(id)}`)
  if (!response.ok) return
  current = await response.json()
  document.querySelector("#r-id").textContent = current.id
  document.querySelector("#r-customer").textContent = current.customerName
  document.querySelector("#r-po").textContent = current.poNumber
  document.querySelector("#r-date").textContent = current.invoiceDate
  document.querySelector("#r-due").textContent = current.dueDate
  document.querySelector("#r-amount").textContent = money.format(current.amount)
  document.querySelector("#r-days").textContent = current.daysOverdue
  document.querySelector("#posted").hidden = true
  document.querySelector("#post-form").reset()
  document.querySelector("#record").hidden = false
})

document.querySelector("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const response = await fetch("/api/ar/post", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceId: current.id,
      status: document.querySelector("#collection-status").value,
      promiseDate: document.querySelector("#promise-date").value,
      reference: document.querySelector("#portal-reference").value,
      note: document.querySelector("#collector-note").value,
    }),
  })
  if (response.ok) {
    document.querySelector("#posted").hidden = false
    document.querySelector("#r-last").textContent = new Date().toISOString().slice(0, 10)
  }
})
