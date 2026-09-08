/**
 * Vitest 2.x (Vite 5) resolver bug workaround for `node:sqlite`.
 *
 * Vite's bundled resolver strips the `node:` prefix and tries to resolve a
 * bare `sqlite` package, which doesn't exist. Aliased here in vitest.config.ts
 * (`test.alias`), this shim performs the import at RUNTIME via
 * createRequire — Node itself resolves the built-in correctly.
 * Used only under vitest; `tsc`/tsx/node resolve node:sqlite natively.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
export const DatabaseSync: any = require('node:sqlite').DatabaseSync;
