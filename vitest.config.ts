import { defineConfig } from 'vitest/config';
// import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // alias: {
    //   '@run-iq/core': path.resolve(__dirname, '../core/src/index.ts'),
    //   '@run-iq/plugin-sdk': path.resolve(__dirname, '../plugin-sdk/src/index.ts'),
    //   '@run-iq/dsl-jsonlogic': path.resolve(__dirname, '../dsl-jsonlogic/src/index.ts'),
    // },
  },
});
