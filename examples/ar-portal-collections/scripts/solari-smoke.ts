import { Solari } from "@solarisdk/browser"

if (!process.env.SOLARI_API_KEY) {
  throw new Error("SOLARI_API_KEY is not configured")
}

const client = new Solari({ apiKey: process.env.SOLARI_API_KEY })
const startedAt = Date.now()
let connectedAt = 0
let title = ""

try {
  const browser = await client.launch({ probe: true, probeTimeoutMs: 3_000 })
  connectedAt = Date.now()
  try {
    const page = await browser.newPage()
    await page.goto("https://example.com", { waitUntil: "domcontentloaded" })
    title = await page.title()
  } finally {
    await browser.close()
  }
} finally {
  await client.close()
}

const releasedAt = Date.now()
console.log(JSON.stringify({
  ok: title === "Example Domain",
  title,
  launchMilliseconds: connectedAt - startedAt,
  totalMilliseconds: releasedAt - startedAt,
}))
