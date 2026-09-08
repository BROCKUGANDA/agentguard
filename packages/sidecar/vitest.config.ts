import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 10_000,
    // Vite 5's resolver strips `node:` for newer built-ins (node:sqlite) and
    // fails to load them. Alias to a runtime-require shim instead.
    alias: [
      {
        find: /^node:sqlite$/,
        replacement: new URL('./test/shims/node-sqlite.ts', import.meta.url).pathname.replace(/^\//, '') || './test/shims/node-sqlite.ts',
      },
    ],
    deps: {
      external: [/^node:/],
    },
  },
  esbuild: {
    target: 'node20',
  },
});
