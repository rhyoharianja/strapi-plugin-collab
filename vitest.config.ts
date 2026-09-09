import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /*
     * The lock logic and the session store. Both are pure and free of React, and both fail
     * in ways nobody would notice by looking: a lock that disables a field for its own
     * holder, or two browsers that disable each other and leave the field unusable for
     * everyone.
     */
    include: ['shared/**/*.test.ts', 'admin/src/session/**/*.test.ts'],
    environment: 'node',
  },
});
