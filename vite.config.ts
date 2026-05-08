import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
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
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
  },
});
