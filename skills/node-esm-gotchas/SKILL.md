---
name: node-esm-gotchas
description: Avoid common ESM import errors in Node.js TypeScript projects, such as missing .js extensions and using callbacks over promises.
---


# node-esm-gotchas — Node.js ESM and TypeScript module resolution

> Avoid common ESM import errors in Node.js TypeScript projects.

## Common operations

- Run TypeScript directly (no compile step):
  `npx tsx {{script.ts}}`

- Check if a package is importable:
  `node -e "import('{{package}}').then(m => console.log(Object.keys(m)))"`

- Use fs/promises (async) not fs (callback):
  `import { readFile, writeFile, mkdir } from "node:fs/promises"`

## Patterns

- TypeScript imports must use `.js` extension (even for .ts files):
  `import { foo } from "./bar.js"` (NOT `./bar.ts` or `./bar`)

- Sync fs for guards, async fs/promises for operations:
  `import { existsSync } from "node:fs"` (sync check)
  `import { readFile, writeFile } from "node:fs/promises"` (async I/O)

- `mkdir` from `node:fs` is callback-based; from `node:fs/promises` is async:
  `import { mkdir } from "node:fs/promises"` → `await mkdir(dir, { recursive: true })`

## Gotchas

- `ERR_MODULE_NOT_FOUND` on `.ts` imports — ESM requires `.js` extension in import paths always
- `import { mkdir } from "node:fs"` gives you the CALLBACK version — not awaitable; use `node:fs/promises`
- `tsx` is not globally installed — use `npx tsx` or install it in the project
- pi extensions use `jiti` for loading — TypeScript just works, but imports still need `.js` suffix
- `Cannot find package 'tsx'` — it's a dev dependency, not available in `node -e` context; use `npx tsx`
- Don't mix `require()` and `import` in ESM — use `import` or `await import()` for dynamic imports
- `__dirname` is not available in ESM — use `import.meta.dirname` (Node 21+) or `fileURLToPath(import.meta.url)`
