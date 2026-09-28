import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({root:resolve('renderer'),base:'./',build:{outDir:resolve('.cache/v40-review-build'),emptyOutDir:true,assetsInlineLimit:10_000_000,rollupOptions:{input:resolve('renderer/review.html')}}});
