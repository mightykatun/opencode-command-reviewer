import { build } from "esbuild"
import { transformAsync } from "@babel/core"
import { readFile } from "node:fs/promises"

await build({
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/tui.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2023",
  external: ["solid-js", "solid-js/*", "@opentui/*", "@opencode-ai/*"],
  plugins: [{
    name: "opentui-solid",
    setup(builder) {
      builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
        const result = await transformAsync(await readFile(path, "utf8"), {
          filename: path,
          babelrc: false,
          configFile: false,
          presets: [
            ["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }],
            ["@babel/preset-typescript", { allExtensions: true, isTSX: true }],
          ],
        })
        return { contents: result.code, loader: "js" }
      })
    },
  }],
})
