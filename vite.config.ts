import { defineConfig } from 'vite';
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/QuantumZombie/' : '/',
  test: { include: ['tests/**/*.test.ts'] },
}));
