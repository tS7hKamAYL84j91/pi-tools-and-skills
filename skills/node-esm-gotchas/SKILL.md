---
name: node-esm-gotchas
description: Avoid common ESM import errors in Node.js TypeScript projects, such as missing .js extensions and using callbacks over promises.
---

# Node.js ESM and TypeScript Module Resolution

## Common operations

- Run TypeScript directly (no compile step):
  `npx jiti {{script.ts}}`

- Check if a package is importable:
  `node -e "import('{{package}}').then(m => console.log(Object.keys(m)))"`

## Import paths

- TypeScript imports must use `.js` extension (even for .ts files):
  `import { foo } from "./bar.js"` (NOT `./bar.ts` or `./bar`).
  Check this first for `ERR_MODULE_NOT_FOUND` on `.ts` imports.
- pi extensions use `jiti` for loading — TypeScript just works, but imports still need `.js` suffix.
- Don't mix `require()` and `import` in ESM — use `import` or `await import()` for dynamic imports.
- `__dirname` is not available in ESM — use `import.meta.dirname` (Node 21+) or `fileURLToPath(import.meta.url)`.

## File I/O

- Use sync fs for guards:
  `import { existsSync } from "node:fs"`
- Use async fs/promises for operations:
  `import { readFile, writeFile, mkdir } from "node:fs/promises"`
- `mkdir` from `node:fs` is callback-based, not awaitable. With the promises import:
  `await mkdir(dir, { recursive: true })`

## Running TypeScript

- Use the project's bundled loader: `npx jiti {{script.ts}}` (Pi ships `jiti`).
- `node {{script.ts}}` alone fails (`ERR_MODULE_NOT_FOUND`) when imports use `.js`
  specifiers, because Node's type stripping does not remap `.js` to `.ts`.
- `Cannot find package 'jiti'` — install dependencies (`npm ci`) first; it is not global.
