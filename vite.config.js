import { defineConfig } from 'vite';

// Собираем игру в один ESM-файл docs/app.js. Картинки и css кладёт рядом
// tools/build.mjs — так все пути в рантайме остаются относительными страницы
// и одинаково работают локально, на GitHub Pages и внутри Telegram.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'docs',
    emptyOutDir: false,
    target: 'es2020',
    minify: 'oxc',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: 'js/main.js',
      output: {
        format: 'es',
        entryFileNames: 'app.js',
        codeSplitting: false,
        assetFileNames: 'app[extname]',
      },
    },
  },
});
