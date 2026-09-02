import React from "react"
import {
  AbsoluteFill, Loop, OffthreadVideo, Series, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing,
} from "remotion"
import { FPS, theme } from "./theme"

// ---------- primitives ----------------------------------------------------------------

export const Fade: React.FC<{ children: React.ReactNode; inFrames?: number; outFrames?: number; durationInFrames: number }> = ({ children, inFrames = 8, outFrames = 8, durationInFrames }) => {
  const frame = useCurrentFrame()
  const opacity = Math.min(
    interpolate(frame, [0, inFrames], [0, 1], { extrapolateRight: "clamp" }),
    interpolate(frame, [durationInFrames - outFrames, durationInFrames], [1, 0], { extrapolateLeft: "clamp" }),
  )
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

const springIn = (frame: number, fps: number, delay = 0) =>
  spring({ frame: frame - delay, fps, config: { damping: 200, stiffness: 110 } })

// ---------- caption: one quiet line under the frame -----------------------------------

export const Caption: React.FC<{ step?: string; text: string; delayFrames?: number }> = ({ step, text, delayFrames = 10 }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = springIn(frame, fps, delayFrames)
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, top: 986,
      display: "flex", justifyContent: "center", alignItems: "baseline", gap: 22,
      opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [10, 0])}px)`,
    }}>
      {step ? <span style={{ fontFamily: theme.mono, fontSize: 24, color: theme.green, letterSpacing: 1 }}>{step}</span> : null}
      <span style={{ fontFamily: theme.sans, fontSize: 33, fontWeight: 500, color: theme.body, letterSpacing: -0.3 }}>{text}</span>
    </div>
  )
}

// ---------- shared inset frame --------------------------------------------------------

export const FRAME = { width: 1600, height: 900, top: 52 }

const frameStyle: React.CSSProperties = {
  position: "absolute", top: FRAME.top, left: (1920 - FRAME.width) / 2,
  width: FRAME.width, height: FRAME.height,
  borderRadius: 12, border: `1px solid ${theme.hairline}`,
  boxShadow: "0 1px 2px rgba(22,24,21,0.03), 0 16px 48px rgba(22,24,21,0.05)",
  overflow: "hidden", background: theme.white,
}

export interface SourceWindow {
  src: string
  from: number
  to: number
  rate: number
}

const Video: React.FC<{ window: SourceWindow }> = ({ window }) => (
  <OffthreadVideo
    muted
    src={staticFile(window.src)}
    startFrom={Math.round(window.from * FPS)}
    endAt={Math.max(Math.round(window.to * FPS), Math.round(window.from * FPS) + 1)}
    playbackRate={window.rate}
    style={{ width: "100%", height: "100%", objectFit: "cover" }}
  />
)

// ---------- single clip with speed + zoom ---------------------------------------------

export interface ZoomSpec {
  scale: number
  /** Focal point in 0..1 of the frame. */
  x: number
  y: number
}

export interface ClipSpec extends SourceWindow {
  kind: "clip"
  zoom?: ZoomSpec
  step?: string
  caption?: string
  durationInFrames: number
}

export const Clip: React.FC<{ spec: ClipSpec }> = ({ spec }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const zoomProgress = spec.zoom ? springIn(frame, fps, 6) : 0
  const scale = spec.zoom ? interpolate(zoomProgress, [0, 1], [1, spec.zoom.scale]) : 1
  // Pan toward the focal point, clamped so the scaled frame always covers its inset (no gaps).
  const clampPan = (raw: number, dimension: number) => {
    const limit = ((scale - 1) * dimension) / 2
    return Math.max(-limit, Math.min(limit, raw))
  }
  const translateX = spec.zoom ? clampPan(interpolate(zoomProgress, [0, 1], [0, (0.5 - spec.zoom.x) * FRAME.width * scale]), FRAME.width) : 0
  const translateY = spec.zoom ? clampPan(interpolate(zoomProgress, [0, 1], [0, (0.5 - spec.zoom.y) * FRAME.height * scale]), FRAME.height) : 0

  return (
    <Fade durationInFrames={spec.durationInFrames}>
      <AbsoluteFill style={{ background: theme.paper }}>
        <div style={frameStyle}>
          <AbsoluteFill style={{ transform: `translate(${translateX}px, ${translateY}px) scale(${scale})` }}>
            <Video window={spec} />
          </AbsoluteFill>
          {spec.rate > 1.6 ? <SpeedBadge rate={spec.rate} /> : null}
        </div>
        {spec.caption ? <Caption step={spec.step} text={spec.caption} /> : null}
      </AbsoluteFill>
    </Fade>
  )
}

// ---------- multi-clip: several takes back-to-back under ONE caption ------------------

export interface MultiClipSpec {
  kind: "multi"
  windows: SourceWindow[]
  step?: string
  caption?: string
  durationInFrames: number
}

export const MultiClip: React.FC<{ spec: MultiClipSpec }> = ({ spec }) => (
  <Fade durationInFrames={spec.durationInFrames}>
    <AbsoluteFill style={{ background: theme.paper }}>
      <div style={frameStyle}>
        <Series>
          {spec.windows.map((window, index) => (
            <Series.Sequence key={index} durationInFrames={Math.max(1, Math.round(((window.to - window.from) / window.rate) * FPS))}>
              <Video window={window} />
            </Series.Sequence>
          ))}
        </Series>
      </div>
      {spec.caption ? <Caption step={spec.step} text={spec.caption} /> : null}
    </AbsoluteFill>
  </Fade>
)

// ---------- grid: four portals on screen at once --------------------------------------

export interface GridSpec {
  kind: "grid"
  windows: SourceWindow[]
  step?: string
  caption?: string
  durationInFrames: number
}

export const Grid: React.FC<{ spec: GridSpec }> = ({ spec }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <Fade durationInFrames={spec.durationInFrames}>
      <AbsoluteFill style={{ background: theme.paper }}>
        <div style={{ ...frameStyle, border: "none", boxShadow: "none", background: "transparent", overflow: "visible", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 14 }}>
          {spec.windows.slice(0, 4).map((window, index) => {
            const progress = springIn(frame, fps, 2 + index * 4)
            return (
              <div key={index} style={{
                position: "relative", overflow: "hidden", borderRadius: 10,
                border: `1px solid ${theme.hairline}`, background: theme.white,
                boxShadow: "0 1px 2px rgba(22,24,21,0.03), 0 10px 30px rgba(22,24,21,0.05)",
                opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [12, 0])}px)`,
              }}>
                {/* Loop each take at 1× so no cell ever runs out of footage (sub-1× rates render blank). */}
                <Loop durationInFrames={Math.max(1, Math.round((window.to - window.from) * FPS))}>
                  <Video window={{ ...window, rate: 1 }} />
                </Loop>
              </div>
            )
          })}
        </div>
        {spec.caption ? <Caption step={spec.step} text={spec.caption} /> : null}
      </AbsoluteFill>
    </Fade>
  )
}

const SpeedBadge: React.FC<{ rate: number }> = ({ rate }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const progress = springIn(frame, fps, 4)
  return (
    <div style={{
      position: "absolute", top: 20, right: 24, opacity: progress,
      fontFamily: theme.mono, fontSize: 21, color: theme.body,
      background: "rgba(255,255,255,0.92)", padding: "7px 14px", borderRadius: 8,
      border: `1px solid ${theme.hairline}`,
    }}>
      {rate % 1 === 0 ? rate : Math.round(rate)}× speed
    </div>
  )
}

// ---------- title ---------------------------------------------------------------------

export const Title: React.FC<{ headline: string; sub: string; durationInFrames: number }> = ({ headline, sub, durationInFrames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const mark = springIn(frame, fps, 0)
  const head = springIn(frame, fps, 10)
  const subP = springIn(frame, fps, 20)
  return (
    <Fade durationInFrames={durationInFrames} outFrames={10}>
      <AbsoluteFill style={{ background: theme.paper, alignItems: "center", justifyContent: "center", gap: 42 }}>
        <span style={{ fontFamily: theme.mono, fontSize: 24, color: theme.gray, letterSpacing: 4, textTransform: "uppercase", opacity: mark, transform: `translateY(${interpolate(mark, [0, 1], [8, 0])}px)` }}>
          duepoint
        </span>
        <div style={{ maxWidth: 1260, textAlign: "center", opacity: head, transform: `translateY(${interpolate(head, [0, 1], [16, 0])}px)` }}>
          <span style={{ fontFamily: theme.sans, fontWeight: 600, fontSize: 78, color: theme.ink, letterSpacing: -2.8, lineHeight: 1.06 }}>{headline}</span>
        </div>
        <span style={{ fontFamily: theme.sans, fontSize: 30, fontWeight: 500, color: theme.gray, opacity: subP, transform: `translateY(${interpolate(subP, [0, 1], [12, 0])}px)` }}>
          {sub}
        </span>
      </AbsoluteFill>
    </Fade>
  )
}

// ---------- animated stats outro ------------------------------------------------------

export interface Stat { label: string; value: number; format: "money" | "int" | "ratio" | "seconds"; suffix?: string; accent?: boolean }

const formatStat = (stat: Stat, progress: number): string => {
  const value = stat.value * progress
  if (stat.format === "money") return `$${Math.round(value).toLocaleString("en-US")}`
  if (stat.format === "seconds") return `${Math.round(value)}s`
  if (stat.format === "ratio") return `${Math.round(value)}/${stat.suffix}`
  return `${Math.round(value)}`
}

export const StatsOutro: React.FC<{ stats: Stat[]; footer: string; durationInFrames: number }> = ({ stats, footer, durationInFrames }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const footerP = springIn(frame, fps, 46)
  return (
    <Fade durationInFrames={durationInFrames} outFrames={14}>
      <AbsoluteFill style={{ background: theme.paper, alignItems: "center", justifyContent: "center", gap: 84 }}>
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {stats.map((stat, index) => {
            const progress = springIn(frame, fps, 8 + index * 6)
            const count = interpolate(frame - 8 - index * 6, [0, 42], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) })
            return (
              <div key={stat.label} style={{
                display: "flex", flexDirection: "column", gap: 18, padding: "10px 64px",
                borderLeft: index === 0 ? "none" : `1px solid ${theme.hairline}`,
                opacity: progress, transform: `translateY(${interpolate(progress, [0, 1], [14, 0])}px)`,
              }}>
                <span style={{ fontFamily: theme.mono, fontSize: 20, color: theme.gray, letterSpacing: 2.5, textTransform: "uppercase" }}>{stat.label}</span>
                <span style={{ fontFamily: theme.sans, fontWeight: 600, fontSize: 66, letterSpacing: -2, color: stat.accent ? theme.green : theme.ink }}>{formatStat(stat, count)}</span>
              </div>
            )
          })}
        </div>
        <span style={{ fontFamily: theme.sans, fontSize: 26, fontWeight: 500, color: theme.gray, opacity: footerP, transform: `translateY(${interpolate(footerP, [0, 1], [10, 0])}px)` }}>
          {footer}
        </span>
      </AbsoluteFill>
    </Fade>
  )
}
