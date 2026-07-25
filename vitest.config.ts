// Unit tests. Browser e2e lives in *.e2e.test.ts, run via vitest.config.e2e.ts.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'test/**/*.e2e.test.ts'],
  },
})
