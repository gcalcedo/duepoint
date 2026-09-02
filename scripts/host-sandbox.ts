/**
 * Manual controls over the sandbox that hosts the portals + Corvus AR.
 * `npm run demo:solari` manages this automatically (provision/reuse on start, kill on exit);
 * these commands exist for inspection and recovery.
 *
 *   npm run host:start     provision (or reuse) and print the preview URL
 *   npm run host:status    sandbox state, token time left, whether the preview URL answers
 *   npm run host:refresh   mint a fresh preview token (they last ~1 hour)
 *   npm run host:logs      tail the remote server log
 *   npm run host:stop      kill the sandbox and remove .env.solari
 *   npm run host:cleanup   kill every duepoint sandbox in the org (after a crash)
 */
import { cleanup, ensureHosted, hostLogs, hostStatus, readHostEnv, refreshPreview, stopHosted, tokenMinutesLeft } from "../src/sandbox-host.js"

const command = process.argv[2] ?? "start"

const commands: Record<string, () => Promise<void>> = {
  async start() {
    const hosted = await ensureHosted()
    console.log(`
Portals are live on Solari (append ?pt_token=… from .env.solari to open them in your own browser):
  ${hosted.origin}/portal/meridian     SupplierNet
  ${hosted.origin}/portal/atlas        ProcureHub
  ${hosted.origin}/portal/halvorsen    TradeLink
  ${hosted.origin}/portal/crestview    Vendor Center
  ${hosted.origin}/ar                  Corvus AR

Next: npm run demo:solari  (it reuses this sandbox and kills it on exit — KEEP_SANDBOX=1 to keep it)
`)
  },
  async status() { await hostStatus() },
  async refresh() {
    const env = readHostEnv()
    if (!env.SOLARI_SANDBOX_ID) { console.log("No sandbox recorded in .env.solari"); return }
    const { token } = await refreshPreview(env.SOLARI_SANDBOX_ID)
    console.log(`Fresh preview token written to .env.solari (${tokenMinutesLeft(token) ?? "?"} min).`)
  },
  async logs() { await hostLogs() },
  async stop() { await stopHosted() },
  async cleanup() {
    const killed = await cleanup()
    console.log(killed ? `${killed} sandbox(es) killed.` : "No duepoint sandboxes running.")
  },
}

if (!commands[command]) {
  console.error(`Unknown command "${command}". Use start | status | refresh | logs | stop | cleanup.`)
  process.exit(1)
}
await commands[command]()
