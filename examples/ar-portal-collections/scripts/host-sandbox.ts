/**
 * Host the "outside world" — the four customer portals and Corvus AR — in a Solari Sandbox so
 * that Solari cloud browsers can reach them on a public preview URL.
 *
 *   npm run host:start    create a sandbox, upload this project, npm ci, start the server, write .env.solari
 *   npm run host:status   sandbox state, token time left, whether the preview URL answers
 *   npm run host:refresh  mint a fresh preview token (they last ~1 hour) and rewrite .env.solari
 *   npm run host:logs     tail the remote server log
 *   npm run host:stop     kill the sandbox and remove .env.solari
 *   npm run host:cleanup  kill every duepoint sandbox in the org (after a failed start)
 *
 * The local machine keeps running the dashboard + Codex agents (`npm run demo:solari`); only the
 * mock systems move to the sandbox. That mirrors reality: the portals are someone else's servers.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SolariClient } from "@solarisdk/sdk"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const envFile = path.join(projectRoot, ".env.solari")
const REMOTE = "/opt/duepoint"
const PORT = 4310
const command = process.argv[2] ?? "start"

const apiKey = process.env.SOLARI_API_KEY
if (!apiKey) {
  console.error("SOLARI_API_KEY is required (put it in ../../.env or .env)")
  process.exit(1)
}
const solari = new SolariClient({ apiKey })

function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(envFile)) return {}
  return Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => {
    const index = line.indexOf("=")
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
  }))
}

function projectFiles(): string[] {
  const files = ["package.json", "package-lock.json", "tsconfig.json"]
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(projectRoot, dir), { withFileTypes: true })) {
      const rel = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(rel)
      else files.push(rel)
    }
  }
  walk("src")
  walk("public")
  return files
}

async function mintPreview(sandbox: { previewUrl(port: number): Promise<{ url: string }> }): Promise<{ origin: string; token: string }> {
  const { url } = await sandbox.previewUrl(PORT)
  const parsed = new URL(url)
  const token = parsed.searchParams.get("pt_token") ?? ""
  return { origin: parsed.origin, token }
}

function tokenMinutesLeft(token: string): number | undefined {
  // The preview token is `<base64url payload>.<signature>`; the payload carries `exp` in ms.
  for (const segment of token.split(".")) {
    try {
      const json = JSON.parse(Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
      if (typeof json.exp === "number") return Math.round((json.exp - Date.now()) / 60_000)
    } catch {}
  }
  return undefined
}

function writeEnvFile(origin: string, token: string, sandboxId: string): void {
  fs.writeFileSync(envFile, [
    "# Written by `npm run host:start` / `host:refresh` — the mock portals + Corvus AR are served from a Solari sandbox.",
    `PUBLIC_BASE_URL=${origin}`,
    `PUBLIC_ACCESS_TOKEN=${token}`,
    `SOLARI_SANDBOX_ID=${sandboxId}`,
    "",
  ].join("\n"))
}

async function waitForPreview(url: string, attempts = 60): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url)
      if (response.ok) return true
      process.stdout.write(`  waiting for the server (HTTP ${response.status})\n`)
    } catch {
      process.stdout.write("  waiting for the preview URL…\n")
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  return false
}

async function start(): Promise<void> {
  const existing = readEnvFile()
  if (existing.SOLARI_SANDBOX_ID) {
    console.log(`A sandbox is already recorded in .env.solari (${existing.SOLARI_SANDBOX_ID}). Run \`npm run host:stop\` first, or \`npm run host:status\`.`)
    process.exit(1)
  }
  const timeoutMinutes = Number(process.env.HOST_TIMEOUT_MIN ?? 180)
  console.log(`Creating sandbox (template base, idle timeout ${timeoutMinutes} min)…`)
  const sandbox = await solari.sandboxes.create({
    template: "base",
    cpu: 2,
    memMb: 2048,
    timeoutMs: timeoutMinutes * 60_000,
    lifecycle: { onTimeout: "kill" },
    metadata: { app: "duepoint", role: "portals" },
  })
  console.log(`sandbox: ${sandbox.sandboxId}`)
  try {
    await provision(sandbox, timeoutMinutes)
  } catch (error) {
    console.error("Provisioning failed — killing the sandbox so it is not billed.")
    await solari.sandboxes.kill(sandbox.sandboxId).catch(() => {})
    throw error
  }
}

async function provision(sandbox: Awaited<ReturnType<typeof solari.sandboxes.create>>, timeoutMinutes: number): Promise<void> {
  await sandbox.connect()

  // The base template ships Node 18; Playwright (a dependency of the server) needs Node 20+.
  const NODE_VERSION = process.env.HOST_NODE_VERSION ?? "22.12.0"
  const arch = (await sandbox.commands.run("uname", { args: ["-m"] })).stdout.trim() === "aarch64" ? "arm64" : "x64"
  console.log(`Installing Node ${NODE_VERSION} (${arch}) into the sandbox…`)
  const nodeInstall = await sandbox.commands.run("sh", {
    args: ["-c", `set -e; mkdir -p /opt/node && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz | tar -xJ -C /opt/node --strip-components=1 && /opt/node/bin/node --version`],
  })
  if (nodeInstall.exitCode !== 0) throw new Error(`Node install failed: ${nodeInstall.stderr}`)
  console.log(`node in sandbox: ${nodeInstall.stdout.trim()}`)
  const withNode = (script: string) => `export PATH=/opt/node/bin:$PATH; ${script}`

  const files = projectFiles()
  console.log(`Uploading ${files.length} files to ${REMOTE}…`)
  const directories = new Set(files.map((file) => path.dirname(file)).filter((dir) => dir !== "."))
  await sandbox.commands.run("sh", { args: ["-c", `mkdir -p ${REMOTE}/data ${[...directories].map((dir) => `${REMOTE}/${dir}`).join(" ")}`] })
  for (const file of files) {
    await sandbox.files.write(`${REMOTE}/${file}`, fs.readFileSync(path.join(projectRoot, file)))
  }

  console.log("Installing dependencies (npm ci, browsers skipped)…")
  const install = await sandbox.commands.run("sh", {
    args: ["-c", withNode(`cd ${REMOTE} && npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -5`)],
    env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1", CI: "1" },
    onStdout: (data: string) => process.stdout.write(`  ${data}`),
    onStderr: (data: string) => process.stdout.write(`  ${data}`),
  })
  if (install.exitCode !== 0) throw new Error(`npm ci failed (${install.exitCode})`)

  console.log("Seeding data and starting the server…")
  const startResult = await sandbox.commands.run("sh", {
    args: ["-c", withNode(`cd ${REMOTE} && npx tsx src/seed.ts && (HOST=0.0.0.0 PORT=${PORT} AGENT_MODE=scripted EXECUTION_PROVIDER=local nohup npx tsx src/server.ts > ${REMOTE}/server.log 2>&1 &) && sleep 1 && echo started`)],
  })
  if (startResult.exitCode !== 0) throw new Error(`server start failed: ${startResult.stderr}`)

  const { origin, token } = await mintPreview(sandbox)
  console.log(`preview: ${origin}`)
  const ready = await waitForPreview(`${origin}/api/state?pt_token=${token}`)
  if (!ready) {
    const log = await sandbox.files.readText(`${REMOTE}/server.log`).catch(() => "(no log)")
    throw new Error(`The preview URL never answered. Server log:\n${log}`)
  }

  writeEnvFile(origin, token, sandbox.sandboxId)
  sandbox.close()

  console.log(`
Portals are live on Solari (append ?pt_token=… from .env.solari to open them in your own browser):
  ${origin}/portal/meridian     SupplierNet
  ${origin}/portal/atlas        ProcureHub
  ${origin}/portal/halvorsen    TradeLink
  ${origin}/portal/crestview    Vendor Center
  ${origin}/ar                  Corvus AR
The access token lasts about an hour — run \`npm run host:refresh\` before a demo if it has been a while.

Next:  npm run demo:solari      (local dashboard at http://127.0.0.1:4310; agents + AR posting on Solari browsers)
       npm run host:stop        when you are done — the sandbox is billed while it runs (auto-kills after ${timeoutMinutes} idle minutes)
`)
}

async function cleanup(): Promise<void> {
  let killed = 0
  for await (const view of solari.sandboxes.listAll({ metadata: { app: "duepoint" } })) {
    await solari.sandboxes.kill(view.sandboxId).catch((error) => console.log(`kill ${view.sandboxId}: ${error instanceof Error ? error.message : error}`))
    console.log(`killed ${view.sandboxId} (${view.state})`)
    killed++
  }
  fs.rmSync(envFile, { force: true })
  console.log(killed ? `${killed} sandbox(es) killed; .env.solari removed.` : "No duepoint sandboxes running.")
}

async function status(): Promise<void> {
  const env = readEnvFile()
  if (!env.SOLARI_SANDBOX_ID) { console.log("No sandbox recorded in .env.solari"); return }
  const view = await solari.sandboxes.get(env.SOLARI_SANDBOX_ID)
  console.log(`sandbox ${view.sandboxId}: ${view.state}, expires ${view.expiresAt}`)
  if (env.PUBLIC_BASE_URL) {
    const minutes = tokenMinutesLeft(env.PUBLIC_ACCESS_TOKEN ?? "")
    const ok = await fetch(`${env.PUBLIC_BASE_URL}/api/state?pt_token=${env.PUBLIC_ACCESS_TOKEN ?? ""}`).then((response) => response.ok).catch(() => false)
    console.log(`${env.PUBLIC_BASE_URL} → ${ok ? "answering" : "NOT answering"}; access token ${minutes === undefined ? "unknown" : `${minutes} min left`}`)
  }
}

async function refresh(): Promise<void> {
  const env = readEnvFile()
  if (!env.SOLARI_SANDBOX_ID) { console.log("No sandbox recorded in .env.solari"); return }
  const sandbox = await solari.sandboxes.connect(env.SOLARI_SANDBOX_ID)
  const { origin, token } = await mintPreview(sandbox)
  writeEnvFile(origin, token, env.SOLARI_SANDBOX_ID)
  sandbox.close()
  console.log(`Fresh preview token written to .env.solari (${tokenMinutesLeft(token) ?? "?"} min). Restart \`npm run demo:solari\` to pick it up.`)
}

async function logs(): Promise<void> {
  const env = readEnvFile()
  if (!env.SOLARI_SANDBOX_ID) { console.log("No sandbox recorded in .env.solari"); return }
  const sandbox = await solari.sandboxes.connect(env.SOLARI_SANDBOX_ID)
  await sandbox.connect()
  const log = await sandbox.files.readText(`${REMOTE}/server.log`)
  console.log(log.split("\n").slice(-40).join("\n"))
  sandbox.close()
}

async function stop(): Promise<void> {
  const env = readEnvFile()
  if (!env.SOLARI_SANDBOX_ID) { console.log("No sandbox recorded in .env.solari"); return }
  await solari.sandboxes.kill(env.SOLARI_SANDBOX_ID).catch((error) => console.log(`kill: ${error instanceof Error ? error.message : error}`))
  fs.rmSync(envFile, { force: true })
  console.log(`Sandbox ${env.SOLARI_SANDBOX_ID} killed; .env.solari removed.`)
}

const commands: Record<string, () => Promise<void>> = { start, status, logs, stop, cleanup, refresh }
if (!commands[command]) {
  console.error(`Unknown command "${command}". Use start | status | logs | stop | cleanup | refresh.`)
  process.exit(1)
}
await commands[command]()
