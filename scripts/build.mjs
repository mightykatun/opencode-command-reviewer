import { build } from "esbuild"
import { transformAsync } from "@babel/core"
import { readFile } from "node:fs/promises"

const prompts = Object.fromEntries(await Promise.all(
  ["PERMISSION-REVIEW-PROMPT", "PERMISSION-REVIEW-CONTRACT", "PERMISSION-REVIEW-CORRECTION", "EDIT-REVIEW-PROMPT", "EDIT-REVIEW-CORRECTION"].map(async (name) => [
    name, (await readFile(new URL(`../${name === "PERMISSION-REVIEW-CONTRACT" ? "contracts" : "prompts"}/${name}.md`, import.meta.url), "utf8")).trim(),
  ]),
))

await build({
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/tui.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2023",
  define: { __REVIEW_PROMPTS__: JSON.stringify(prompts) },
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
