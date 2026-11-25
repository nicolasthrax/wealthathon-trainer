import { defineConfig } from 'vitest/config';
import path from 'node:path';
const r = (p: string) => path.resolve(import.meta.dirname, p);
export default defineConfig({
  test: { include: ['packages/**/*.test.ts', 'worker/**/*.test.ts', 'src/**/*.test.ts'] },
  resolve: { alias: [
    { find: /^@engine$/, replacement: r('packages/engine/src/index.ts') },
    { find: /^@engine\//, replacement: r('packages/engine/src') + '/' },
    { find: /^@config\//, replacement: r('config') + '/' },
    { find: /^@seed\//, replacement: r('seed') + '/' },
  ] },
});
