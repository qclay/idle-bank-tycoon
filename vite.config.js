import { defineConfig } from 'vite';

// Собираем игру в один ESM-файл docs/js/app.js.
// Именно в подпапку: GitHub Pages не отдаёт посторонние файлы из корня docs/. Картинки и css кладёт рядом
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
        entryFileNames: 'js/app.js',
        codeSplitting: false,
        assetFileNames: 'js/app[extname]',
      },
    },
  },
});
