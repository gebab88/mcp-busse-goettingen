import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Git worktrees unter .worktrees/ enthalten eine vollständige Kopie des Projekts.
    // Ohne diesen Ausschluss zählt Vitest die Testdateien doppelt.
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
  },
});
