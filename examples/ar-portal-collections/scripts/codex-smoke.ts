/**
 * Smoke test for the Codex agent path: local Codex login → codex exec → MCP browser tools →
 * structured output. Uses Playwright MCP by default; set BROWSER_MCP=solari to go through
 * Solari's hosted MCP (needs SOLARI_API_KEY; consumes a few seconds of browser time).
 */
import { Solari } from "@solarisdk/browser"
import { CodexPortalAgent } from "../src/codex-agent.js"

const mcp = process.env.BROWSER_MCP === "solari" ? "solari" : "playwright"
if (mcp === "solari" && !process.env.SOLARI_API_KEY) {
  console.error("BROWSER_MCP=solari requires SOLARI_API_KEY")
  process.exit(1)
}

const agent = new CodexPortalAgent({
  baseUrl: "http://127.0.0.1:4310",
  mcp,
  visible: process.env.DEMO_MODE === "visible",
  model: process.env.CODEX_MODEL,
  reasoningEffort: process.env.CODEX_REASONING_EFFORT,
  onEvent: (_customer, event) => console.log(`  · ${event.text}`),
})

console.log(`Codex smoke (${agent.describe()})…`)
const startedAt = Date.now()
const result = await agent.probe(process.env.SMOKE_URL ?? "https://example.com")
console.log(`\nHeading: ${result.heading}`)
console.log(`Tools used: ${result.toolsUsed.join(", ")}`)
if (mcp === "solari" && result.browserSessionId) {
  const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const replay = await solari.sessions.getReplayUrl(result.browserSessionId)
      console.log(`Replay: available (presigned URL, expires in ${replay.expiresInSeconds}s)`)
      break
    } catch (error) {
      if (attempt === 5) console.log(`Replay: NOT available — ${error instanceof Error ? error.message : error}`)
      else await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
  await solari.close()
}
console.log(`Done in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)
