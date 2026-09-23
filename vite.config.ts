import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on GitHub Pages or any sub-path.
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
