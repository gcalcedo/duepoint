/**
 * Hosts the "outside world" — the four customer portals and Corvus AR — in a Solari Sandbox.
 *
 * `npm run demo:solari` uses this automatically: it reuses a live sandbox (minting a fresh
 * preview token) or provisions a new one, and the server kills the sandbox on exit unless
 * KEEP_SANDBOX=1. The `npm run host:*` commands are manual overrides over the same module.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { SolariClient } from "@solarisdk/sdk"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const envFile = path.join(projectRoot, ".env.solari")
const REMOTE = "/opt/duepoint"
const PORT = 4310

export interface HostedInfo {
  origin: string
  token: string
  sandboxId: string
  /** true when a brand-new sandbox was provisioned (vs. reusing a live one). */
  created: boolean
}

type Log = (message: string) => void

function client(): SolariClient {
  const apiKey = process.env.SOLARI_API_KEY
  if (!apiKey) throw new Error("SOLARI_API_KEY is required (put it in .env or ../../.env)")
  return new SolariClient({ apiKey })
}

export function readHostEnv(): Record<string, string> {
  if (!fs.existsSync(envFile)) return {}
  return Object.fromEntries(fs.readFileSync(envFile, "utf8").split("\n").filter((line) => line.includes("=") && !line.startsWith("#")).map((line) => {
    const index = line.indexOf("=")
    return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
  }))
}

function writeEnvFile(origin: string, token: string, sandboxId: string): void {
  fs.writeFileSync(envFile, [
    "# Managed by the DuePoint sandbox host — the mock portals + Corvus AR are served from a Solari sandbox.",
    `PUBLIC_BASE_URL=${origin}`,
    `PUBLIC_ACCESS_TOKEN=${token}`,
    `SOLARI_SANDBOX_ID=${sandboxId}`,
    "",
  ].join("\n"))
}

export function tokenMinutesLeft(token: string): number | undefined {
  // The preview token is `<base64url payload>.<signature>`; the payload carries `exp` in ms.
  for (const segment of token.split(".")) {
    try {
      const json = JSON.parse(Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"))
      if (typeof json.exp === "number") return Math.round((json.exp - Date.now()) / 60_000)
    } catch {}
  }
  return undefined
}

async function mintPreview(sandbox: { previewUrl(port: number): Promise<{ url: string }> }): Promise<{ origin: string; token: string }> {
  const { url } = await sandbox.previewUrl(PORT)
  const parsed = new URL(url)
  return { origin: parsed.origin, token: parsed.searchParams.get("pt_token") ?? "" }
}

async function answering(origin: string, token: string): Promise<boolean> {
  return fetch(`${origin}/api/state?pt_token=${token}`).then((response) => response.ok).catch(() => false)
}

/** Mint a fresh preview token for a live sandbox and persist it. */
export async function refreshPreview(sandboxId: string): Promise<{ origin: string; token: string }> {
  const sandbox = await client().sandboxes.connect(sandboxId)
  const preview = await mintPreview(sandbox)
  sandbox.close()
  writeEnvFile(preview.origin, preview.token, sandboxId)
  return preview
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

/** Create a fresh sandbox, upload the project, install, start the server, expose the preview URL. */
export async function provision(log: Log = console.log): Promise<HostedInfo> {
  const timeoutMinutes = Number(process.env.HOST_TIMEOUT_MIN ?? 180)
  const solari = client()
  log(`Provisioning a Solari sandbox for the portals (idle timeout ${timeoutMinutes} min)…`)
  const sandbox = await solari.sandboxes.create({
    template: "base",
    cpu: 2,
    memMb: 2048,
    timeoutMs: timeoutMinutes * 60_000,
    lifecycle: { onTimeout: "kill" },
    metadata: { app: "duepoint", role: "portals" },
  })
  log(`sandbox: ${sandbox.sandboxId.slice(0, 24)}…`)
  try {
    await sandbox.connect()

    // The base template ships Node 18; Playwright (a dependency of the server) needs Node 20+.
    const NODE_VERSION = process.env.HOST_NODE_VERSION ?? "22.12.0"
    const arch = (await sandbox.commands.run("uname", { args: ["-m"] })).stdout.trim() === "aarch64" ? "arm64" : "x64"
    const nodeInstall = await sandbox.commands.run("sh", {
      args: ["-c", `set -e; mkdir -p /opt/node && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz | tar -xJ -C /opt/node --strip-components=1 && /opt/node/bin/node --version`],
    })
    if (nodeInstall.exitCode !== 0) throw new Error(`Node install failed: ${nodeInstall.stderr}`)
    const withNode = (script: string) => `export PATH=/opt/node/bin:$PATH; ${script}`

    const files = projectFiles()
    log(`Uploading ${files.length} files…`)
    const directories = new Set(files.map((file) => path.dirname(file)).filter((dir) => dir !== "."))
    await sandbox.commands.run("sh", { args: ["-c", `mkdir -p ${REMOTE}/data ${[...directories].map((dir) => `${REMOTE}/${dir}`).join(" ")}`] })
    for (const file of files) {
      await sandbox.files.write(`${REMOTE}/${file}`, fs.readFileSync(path.join(projectRoot, file)))
    }

    log("Installing dependencies in the sandbox…")
    const install = await sandbox.commands.run("sh", {
      args: ["-c", withNode(`cd ${REMOTE} && npm ci --no-audit --no-fund --loglevel=error 2>&1 | tail -3`)],
      env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1", CI: "1" },
    })
    if (install.exitCode !== 0) throw new Error(`npm ci failed (${install.exitCode})`)

    const startResult = await sandbox.commands.run("sh", {
      args: ["-c", withNode(`cd ${REMOTE} && npx tsx src/seed.ts && (HOST=0.0.0.0 PORT=${PORT} AGENT_MODE=scripted EXECUTION_PROVIDER=local nohup npx tsx src/server.ts > ${REMOTE}/server.log 2>&1 &) && sleep 1 && echo started`)],
    })
    if (startResult.exitCode !== 0) throw new Error(`server start failed: ${startResult.stderr}`)

    const { origin, token } = await mintPreview(sandbox)
    log(`preview: ${origin}`)
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await answering(origin, token)) {
        writeEnvFile(origin, token, sandbox.sandboxId)
        sandbox.close()
        return { origin, token, sandboxId: sandbox.sandboxId, created: true }
      }
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
    const remoteLog = await sandbox.files.readText(`${REMOTE}/server.log`).catch(() => "(no log)")
    throw new Error(`The preview URL never answered. Server log:\n${remoteLog}`)
  } catch (error) {
    log("Provisioning failed — killing the sandbox so it is not billed.")
    await solari.sandboxes.kill(sandbox.sandboxId).catch(() => {})
    throw error
  }
}

/** Reuse the recorded sandbox when it is alive (fresh token), otherwise provision a new one. */
export async function ensureHosted(log: Log = console.log): Promise<HostedInfo> {
  const sandboxId = readHostEnv().SOLARI_SANDBOX_ID ?? process.env.SOLARI_SANDBOX_ID
  if (sandboxId) {
    try {
      const { origin, token } = await refreshPreview(sandboxId)
      if (await answering(origin, token)) {
        log(`Reusing Solari sandbox ${sandboxId.slice(0, 24)}… (fresh preview token, ${tokenMinutesLeft(token) ?? "?"} min)`)
        return { origin, token, sandboxId, created: false }
      }
      log("Recorded sandbox is not answering — provisioning a new one.")
    } catch (error) {
      log(`Recorded sandbox unusable (${error instanceof Error ? error.message : error}) — provisioning a new one.`)
    }
  }
  return provision(log)
}

/** Kill the sandbox and forget it. */
export async function stopHosted(sandboxId?: string, log: Log = console.log): Promise<void> {
  const id = sandboxId ?? readHostEnv().SOLARI_SANDBOX_ID
  if (!id) { log("No sandbox recorded."); return }
  await client().sandboxes.kill(id).catch((error) => log(`kill: ${error instanceof Error ? error.message : error}`))
  fs.rmSync(envFile, { force: true })
  log(`Solari sandbox ${id.slice(0, 24)}… killed; .env.solari removed.`)
}

/** Kill every duepoint sandbox in the org (recovery after crashes). */
export async function cleanup(log: Log = console.log): Promise<number> {
  const solari = client()
  let killed = 0
  for await (const view of solari.sandboxes.listAll({ metadata: { app: "duepoint" } })) {
    await solari.sandboxes.kill(view.sandboxId).catch((error) => log(`kill ${view.sandboxId.slice(0, 24)}…: ${error instanceof Error ? error.message : error}`))
    log(`killed ${view.sandboxId.slice(0, 24)}… (${view.state})`)
    killed++
  }
  fs.rmSync(envFile, { force: true })
  return killed
}

export async function hostStatus(log: Log = console.log): Promise<void> {
  const env = readHostEnv()
  if (!env.SOLARI_SANDBOX_ID) { log("No sandbox recorded in .env.solari"); return }
  const view = await client().sandboxes.get(env.SOLARI_SANDBOX_ID)
  log(`sandbox ${view.sandboxId.slice(0, 24)}…: ${view.state}, expires ${view.expiresAt}`)
  if (env.PUBLIC_BASE_URL) {
    const ok = await answering(env.PUBLIC_BASE_URL, env.PUBLIC_ACCESS_TOKEN ?? "")
    const minutes = tokenMinutesLeft(env.PUBLIC_ACCESS_TOKEN ?? "")
    log(`${env.PUBLIC_BASE_URL} → ${ok ? "answering" : "NOT answering"}; access token ${minutes === undefined ? "unknown" : `${minutes} min left`}`)
  }
}

export async function hostLogs(log: Log = console.log): Promise<void> {
  const env = readHostEnv()
  if (!env.SOLARI_SANDBOX_ID) { log("No sandbox recorded in .env.solari"); return }
  const sandbox = await client().sandboxes.connect(env.SOLARI_SANDBOX_ID)
  await sandbox.connect()
  const remoteLog = await sandbox.files.readText(`${REMOTE}/server.log`)
  log(remoteLog.split("\n").slice(-40).join("\n"))
  sandbox.close()
}
