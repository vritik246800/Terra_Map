// Static site for Vercel (no adapter). The hero's three.js chunk is ~560 kB
// minified (~150 kB gzip) and loads after the page — over Vite's 500 kB hint.
import { defineConfig } from "astro/config";

export default defineConfig({
  vite: { build: { chunkSizeWarningLimit: 700 } },
});
