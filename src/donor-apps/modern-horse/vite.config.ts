import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// LIVE WIRING (owner directive: serve the donor app exactly as delivered).
// Differences from the donor's original config are deployment wiring only:
//  - vite-plugin-singlefile is dropped: the production CSP of the platform
//    (script-src 'self') forbids inline scripts, and separate hashed assets
//    cache far better on the Workers free plan. The compiled CSS/JS output is
//    identical Tailwind 4 + React production output.
//  - base/outDir place the build at /f/modern-horse/ where Workers static
//    assets serve the donor's own index.html (its own document + fonts).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/f/modern-horse/',
  resolve: {
    dedupe: ['react','react-dom'],
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: '../../../public/f/modern-horse',
    emptyOutDir: true,
  },
});
