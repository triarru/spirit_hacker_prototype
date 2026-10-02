import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // core/ is framework-free, so its tests run in plain Node — no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
