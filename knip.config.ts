import type { KnipConfig } from "knip"

const config: KnipConfig = {
  // Test files are entry points — exports consumed only by tests are valid
  includeEntryExports: true,
  // Skill helper scripts referenced in markdown docs (not executed from JS)
  ignore: [
    "src-tauri/experts/skills/brainstorming/scripts/helper.js",
    "src-tauri/experts/skills/brainstorming/scripts/server.cjs",
    "src-tauri/experts/skills/systematic-debugging/condition-based-waiting-example.ts",
    "src-tauri/experts/skills/writing-skills/render-graphs.js",
  ],
  // Tauri/Rust plugins — knip only scans TS/JS; these are used in Rust code
  ignoreDependencies: [
    "@tauri-apps/plugin-updater",
    "@tauri-apps/plugin-window-state",
  ],
  // Native tool invoked by prepare-sidecars.mjs
  ignoreBinaries: ["rustc"],
}

export default config
