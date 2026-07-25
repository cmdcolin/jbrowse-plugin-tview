// Puppeteer e2e tests. beforeAll starts the dev server, so timeouts are long.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    include: ['test/**/*.e2e.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
