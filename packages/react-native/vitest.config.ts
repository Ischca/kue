import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Errors outside the screens follow the active display language; pin it so a machine's LANG never decides.
    setupFiles: ["./test/setup.ts"],
  },
});
