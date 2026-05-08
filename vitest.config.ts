import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@scenes": resolve(__dirname, "src/scenes"),
      "@systems": resolve(__dirname, "src/systems"),
      "@entities": resolve(__dirname, "src/entities"),
      "@ui": resolve(__dirname, "src/ui"),
      "@sdk": resolve(__dirname, "src/sdk"),
      "@config": resolve(__dirname, "src/config"),
      "@utils": resolve(__dirname, "src/utils"),
      "@types": resolve(__dirname, "src/types"),
      "@gametypes": resolve(__dirname, "src/types"),
      "@events": resolve(__dirname, "src/events"),
    },
  },
});
