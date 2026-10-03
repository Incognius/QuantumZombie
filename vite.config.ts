import { defineConfig } from 'vite';
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dead-reckoning/' : '/',
  test: { include: ['tests/**/*.test.ts'] },
}));
