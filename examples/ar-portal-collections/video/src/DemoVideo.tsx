import React from "react"
import { Audio, Series, interpolate, staticFile } from "remotion"
import { Clip, Grid, MultiClip, StatsOutro, Title, type ClipSpec, type GridSpec, type MultiClipSpec, type SourceWindow } from "./components"
import { FPS } from "./theme"
import timeline from "./generated/timeline.json"

type Scene =
  | ClipSpec
  | MultiClipSpec
  | GridSpec
  | { kind: "title"; headline: string; sub: string; durationInFrames: number }
  | { kind: "stats"; durationInFrames: number }

const seconds = (value: number) => Math.max(1, Math.round(value * FPS))
const windowFrames = (window: SourceWindow) => Math.max(1, Math.round(((window.to - window.from) / window.rate) * FPS))

const clip = (src: string, from: number, to: number, rate: number, extra: Partial<ClipSpec> = {}): Scene => ({
  kind: "clip",
  src,
  from,
  to,
  rate,
  durationInFrames: seconds((to - from) / rate),
  ...extra,
})

const moneyK = (value: number) => `$${Math.round(value / 1000)}K`
const money = (value: number) => `$${Math.round(value).toLocaleString("en-US")}`

export const buildScenes = (): Scene[] => {
  const t = timeline.marks as Record<string, number>
  const stats = timeline.stats
  const broll = timeline.broll as (SourceWindow & { caption: string })[]
  const lookups = timeline.lookupBroll as SourceWindow[]
  const replay = timeline.replayBeat as SourceWindow
  const approvalRate = (t.approveDone + 2 - (t.approveClick + 3.4)) / 7

  return [
    // The hook: the problem, before the product.
    { kind: "title", headline: "Your customers each pay through their own AP portal", sub: `5 customers · ${stats.totalInvoices} invoices · ${moneyK(stats.overdue)} past due — and none of the portals are yours`, durationInFrames: seconds(5.2) },

    { kind: "grid", windows: broll, step: "01", caption: "Four customers, four portals — enterprise network, SaaS suite, e-invoicing, homegrown.", durationInFrames: seconds(6) },

    { kind: "multi", windows: lookups, step: "02", caption: "The same question — where is my invoice? — is a different journey in every one.", durationInFrames: lookups.reduce((sum, window) => sum + windowFrames(window), 0) },

    // The solution.
    clip("dashboard.webm", Math.max(0, t.establish - 1.2), t.runStart + 2.2, 1, {
      step: "03",
      caption: "DuePoint reads the overdue queue and sends one AI agent to each customer.",
    }),

    clip("dashboard.webm", t.runStart + 1.2, t.runStart + 14.4, 1.8, {
      zoom: { scale: 1.45, x: 0.845, y: 0.56 },
      step: "04",
      caption: "Four Solari cloud browsers, in parallel — no portal-specific code, it reads each UI like a person.",
    }),

    // The work, portal by portal.
    ...broll.map((item, index) =>
      clip(item.src, item.from, item.to, item.rate, {
        step: "05",
        caption: item.caption,
        zoom: [
          { scale: 1.18, x: 0.42, y: 0.45 },
          { scale: 1.18, x: 0.78, y: 0.45 },
          { scale: 1.18, x: 0.42, y: 0.42 },
          { scale: 1.18, x: 0.45, y: 0.4 },
        ][index],
      })),

    clip("dashboard.webm", t.runStart + 17, Math.max(t.runStart + 18, t.runComplete - 5), (t.runComplete - 5 - (t.runStart + 17)) / 7, {
      step: "06",
      caption: "Five minutes of real work, compressed — every finding in the portal's own words.",
    }),

    clip("dashboard.webm", Math.max(0, t.runComplete - 4.5), t.runComplete + 4, 1, {
      zoom: { scale: 1.35, x: 0.28, y: 0.14 },
      step: "07",
      caption: `${money(stats.confirmed)} confirmed, ${moneyK(stats.unblocked)} unblocked — no human touched these.`,
    }),

    // The Solari receipts: every session is a replay.
    clip(replay.src, replay.from, replay.to, replay.rate, {
      zoom: { scale: 1.32, x: 0.82, y: 0.45 },
      step: "08",
      caption: "Every browser session is recorded on Solari — the audit trail is a replay link on the invoice.",
    }),

    // The human gate.
    clip("dashboard.webm", t.reviewFilter - 0.4, t.approveClick + 3.4, 1, {
      zoom: { scale: 1.28, x: 0.82, y: 0.42 },
      step: "09",
      caption: "Disputes never auto-resolve — the agent assembles the evidence, a person decides.",
    }),
    clip("dashboard.webm", t.approveClick + 3.4, t.approveDone + 2, approvalRate, {
      zoom: { scale: 1.2, x: 0.82, y: 0.5 },
      step: "09",
      caption: "Approved — the agent re-opens the portal on a fresh recorded session and replies.",
    }),

    clip(timeline.arBroll.src ?? "ar-corvus.webm", timeline.arBroll.from, timeline.arBroll.to, timeline.arBroll.rate, {
      step: "10",
      caption: "…and the outcome lands in the legacy AR system of record.",
    }),

    { kind: "stats", durationInFrames: seconds(9) },
  ]
}

export const totalDuration = (): number => buildScenes().reduce((sum, scene) => sum + scene.durationInFrames, 0)

export const DemoVideo: React.FC = () => {
  const scenes = buildScenes()
  const stats = timeline.stats
  const total = totalDuration()
  const music = (timeline as any).music as string | undefined

  return (
    <>
      {music ? (
        <Audio
          loop
          src={staticFile(music)}
          volume={(frame) => interpolate(frame, [0, 40, total - 80, total - 10], [0, 0.3, 0.3, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
        />
      ) : null}
      <Series>
        {scenes.map((scene, index) => (
          <Series.Sequence key={index} durationInFrames={scene.durationInFrames} layout="none">
            {scene.kind === "title" ? <Title headline={scene.headline} sub={scene.sub} durationInFrames={scene.durationInFrames} /> :
              scene.kind === "grid" ? <Grid spec={scene} /> :
              scene.kind === "multi" ? <MultiClip spec={scene} /> :
              scene.kind === "stats" ? (
                <StatsOutro
                  durationInFrames={scene.durationInFrames}
                  stats={[
                    { label: "Run time", value: stats.runSec, format: "seconds" },
                    { label: "Findings", value: stats.accuracyHit, format: "ratio", suffix: String(stats.accuracyTotal) },
                    { label: "Confirmed", value: stats.confirmed, format: "money", accent: true },
                    { label: "Unblocked", value: stats.unblocked, format: "money" },
                  ]}
                  footer="Codex agents · Solari cloud browsers · portals hosted in a Solari sandbox · every session replayable"
                />
              ) : <Clip spec={scene} />}
          </Series.Sequence>
        ))}
      </Series>
    </>
  )
}
