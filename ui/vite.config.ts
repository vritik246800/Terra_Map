import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri expects a fixed dev port and no console clearing.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    // Desktop app: the bundle loads from disk, not the network; three.js
    // alone is ~700 kB minified, so the 500 kB web default only adds noise.
    chunkSizeWarningLimit: 1500,
  },
});
