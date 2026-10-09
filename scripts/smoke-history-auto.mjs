// Same transport/render assertions as Phase 0, using the real history command.
if (!process.argv[2]) process.argv.push("covered")
process.argv.push("--production-history")
await import("./smoke-history-render.mjs")
