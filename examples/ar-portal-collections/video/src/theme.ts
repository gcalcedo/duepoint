import { loadFont as loadGeist } from "@remotion/google-fonts/Geist"
import { loadFont as loadDMMono } from "@remotion/google-fonts/DMMono"

const geist = loadGeist()
const dmMono = loadDMMono()

/** Light, minimal, docs-like: hairlines, quiet grays, one green accent, no cards. */
export const theme = {
  paper: "#fbfbfa",
  ink: "#161815",
  body: "#3c403c",
  gray: "#787d77",
  faint: "#a4a8a1",
  hairline: "#e7e8e3",
  green: "#1f7a5c",
  white: "#ffffff",
  sans: geist.fontFamily,
  mono: dmMono.fontFamily,
}

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
