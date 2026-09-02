import { Config } from "@remotion/cli/config"

// The raw footage + run data live next to the app, produced by `npm run record:demo`.
Config.setPublicDir("../recordings/latest")
Config.setVideoImageFormat("jpeg")
Config.setOverwriteOutput(true)
