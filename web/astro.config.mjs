import { defineConfig } from 'astro/config';
export default defineConfig({
  output: 'static',
  build: { format: 'directory' },
  // The Worker allows same-origin script files, not arbitrary inline scripts.
  // Astro otherwise inlines small processed scripts (including navigation),
  // which silently breaks their controls under the production CSP.
  vite: { build: { assetsInlineLimit: 0 } },
});
