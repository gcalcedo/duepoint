import React from "react"
import { Composition } from "remotion"
import { DemoVideo, totalDuration } from "./DemoVideo"
import { FPS, HEIGHT, WIDTH } from "./theme"

export const Root: React.FC = () => (
  <Composition
    id="DuePointDemo"
    component={DemoVideo}
    durationInFrames={Math.max(30, totalDuration())}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
  />
)
