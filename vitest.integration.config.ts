import { defineConfig } from 'vitest/config';

// Integration-тесты против локального стека Supabase (`npx supabase start`).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Тесты одного файла создают свои фикстуры; файлы — последовательно.
    fileParallelism: false,
  },
});
