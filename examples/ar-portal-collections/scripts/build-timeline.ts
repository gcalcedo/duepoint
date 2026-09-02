/**
 * Turns a recording (recordings/latest: meta.json + export.json + *.webm) into the edit
 * decisions the Remotion composition consumes: video/src/generated/timeline.json.
 *
 * - mark timestamps → seconds into dashboard.webm
 * - the long middle of the run → a computed speed-ramp rate that fits ~9s of screen time
 * - B-roll windows sized from the actual clip lengths (via ffprobe when available)
 * - stats (accuracy vs portal ground truth, cash buckets, run time) from export.json
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { portalRecords } from "../src/data.js"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const recordingDir = path.join(projectRoot, "recordings", "latest")
const outPath = path.join(projectRoot, "video", "src", "generated", "timeline.json")

const meta = JSON.parse(fs.readFileSync(path.join(recordingDir, "meta.json"), "utf8"))
const run = JSON.parse(fs.readFileSync(path.join(recordingDir, "export.json"), "utf8"))

// Optional sync trim: positive shifts everything earlier in the source video.
const offset = Number(process.env.SYNC_OFFSET_SEC ?? 0)
const marks: Record<string, number> = {}
for (const { label, at } of meta.marks) marks[label] = Math.max(0, (at - meta.recordStartAt) / 1000 - offset)

const durationOf = (file: string): number | undefined => {
  try {
    const output = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(recordingDir, file)], { encoding: "utf8" }).trim()
    const value = Number(output)
    return Number.isFinite(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

// Speed ramp: compress [runStart+17 .. runComplete-5] into ~10 seconds of screen time.
const rampSpan = Math.max(2, marks.runComplete - 5 - (marks.runStart + 17))
const rampRate = Math.max(2, Math.min(40, rampSpan / 10))

// Accuracy vs portal ground truth.
const truth = new Map(portalRecords.map((record) => [record.invoiceId, record.finding]))
let accuracyHit = 0
let accuracyTotal = 0
for (const invoice of run.invoices) {
  if (!invoice.portal) continue
  accuracyTotal++
  if (invoice.finding === (truth.get(invoice.id) ?? "not-received")) accuracyHit++
}

const brollDefs = [
  { src: "portal-suppliernet.webm", caption: "SupplierNet — correcting and resubmitting a rejected invoice." },
  { src: "portal-procurehub.webm", caption: "ProcureHub — replying inside a dispute thread." },
  { src: "portal-tradelink.webm", caption: "TradeLink — nudging an approval that sat for nine days." },
  { src: "portal-vendorcenter.webm", caption: "Vendor Center — a homegrown legacy portal. Same agent." },
]
const fit = (src: string, targetSec: number, fallbackDuration = 10) => {
  const duration = durationOf(src) ?? fallbackDuration
  const from = Math.min(0.4, duration * 0.05)
  const to = Math.max(from + 1, duration - 0.3)
  // Never below 1× — sub-1 playback rates break OffthreadVideo frame extraction on these webms.
  return { src, from, to, rate: Number(Math.max(1, (to - from) / targetSec).toFixed(2)) }
}

// Portal ACTION takes — ~3.5s of screen time each.
const broll = brollDefs.map((definition) => ({ ...definition, ...fit(definition.src, 4.5) }))

// Portal LOOKUP takes (same task in four UIs) — ~2.4s each.
const lookupBroll = [
  fit("lookup-suppliernet.webm", 3.2),
  fit("lookup-procurehub.webm", 3.2),
  fit("lookup-tradelink.webm", 3.2),
  fit("lookup-vendorcenter.webm", 3.2),
]

// Replay-links beat on the dashboard — ~5s.
const replayBeat = fit("replay-beat.webm", 6.5)

const arBroll = fit("ar-corvus.webm", 3.4)

// Optional music bed: video/assets/music.mp3 → copied next to the footage so Remotion can serve it.
const musicSource = path.join(projectRoot, "video", "assets", "music.mp3")
let music: string | undefined
if (fs.existsSync(musicSource)) {
  fs.copyFileSync(musicSource, path.join(recordingDir, "music.mp3"))
  music = "music.mp3"
}

const timeline = {
  generatedAt: new Date().toISOString(),
  music,
  marks,
  rampRate: Number(rampRate.toFixed(2)),
  stats: {
    runSec: Math.round((run.runDurationMs ?? 0) / 1000),
    accuracyHit,
    accuracyTotal,
    confirmed: run.summary.confirmed,
    unblocked: run.summary.unblocked,
    atRisk: run.summary.atRisk,
    processed: run.summary.processed,
    held: run.summary.pendingApproval,
    totalInvoices: run.summary.totalInvoices,
    overdue: run.summary.overdue,
    replays: run.invoices.filter((invoice: any) => invoice.lookupSession).length,
  },
  broll,
  lookupBroll,
  replayBeat,
  arBroll,
}

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2))
console.log(`timeline → ${outPath}`)
console.log(JSON.stringify({ marks, rampRate: timeline.rampRate, stats: timeline.stats }, null, 2))
