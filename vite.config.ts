/**
 * Vite configuration for PP-MD PPTB Tool (Power Platform Markdown Documentation Generator).
 * Uses the official Vite React plugin for JSX/TSX transform support.
 * This tool runs in the Power Platform ToolBox iframe environment.
 */
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function fixHtmlForPptb(): Plugin {
  return {
    name: 'fix-html-for-pptb',
    enforce: 'post',
    transformIndexHtml(html) {
      const scripts: string[] = [];
      const htmlWithoutScripts = html
        .replace(/\s*type="module"/g, '')
        .replace(/\s*crossorigin/g, '')
        .replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, (script) => {
          scripts.push(script);
          return '';
        });

      if (scripts.length === 0) {
        return htmlWithoutScripts;
      }

      return htmlWithoutScripts.replace('</body>', `  ${scripts.join('\n  ')}\n</body>`);
    },
  };
}

// Captured once at bundle start (document.currentScript is null in async callbacks).
const SCRIPT_URL_GLOBAL = '__ppmdScriptUrl';
const SCRIPT_URL_INTRO =
  `var ${SCRIPT_URL_GLOBAL}=(typeof document!=="undefined"&&document.currentScript&&document.currentScript.src)||` +
  `(typeof location!=="undefined"?location.href:"");`;

export default defineConfig(({ command, mode }) => {
  const enableSourceMaps = mode !== 'production';
  const isBuild = command === 'build';

  return {
    plugins: [react(), fixHtmlForPptb()],
    base: './',
    // The build is a classic IIFE script where `import.meta` is a syntax error,
    // so polyfill the properties dependencies use (Mermaid, langium, etc.).
    define: isBuild
      ? {
          'import.meta.url': SCRIPT_URL_GLOBAL,
          'import.meta.resolve': `((s)=>new URL(s,${SCRIPT_URL_GLOBAL}).href)`,
        }
      : undefined,
    // Vite's default IIFE asset URLs read document.currentScript at render time,
    // which is null after startup; resolve from the captured script URL instead
    // (the entry lives in assets/, asset filenames are relative to dist/).
    experimental: {
      renderBuiltUrl(filename, { hostType }) {
        if (hostType !== 'js') {
          return { relative: true };
        }
        return { runtime: `new URL(${JSON.stringify(`../${filename}`)},${SCRIPT_URL_GLOBAL}).href` };
      },
    },
    build: {
      // PPTB loads a single classic script; module preload links are unused.
      modulePreload: false,
      // Output to the standard dist folder
      outDir: 'dist',
      // Keep production bundles compact; source maps stay available in non-prod builds.
      sourcemap: enableSourceMaps,
      // PPTB serves the declared entry asset only. Keep Mermaid's dynamic
      // import graph in that asset so the sandbox can render diagrams.
      chunkSizeWarningLimit: 4500,
      // Emit stable, human-readable output file names for packaging.
      cssCodeSplit: false,
      // Vite 8 bundles with Rolldown; rolldownOptions takes precedence over
      // rollupOptions, so all output settings must live here.
      rolldownOptions: {
        output: {
          // Classic IIFE (no ES modules), matching the official PPTB samples.
          format: 'iife',
          intro: SCRIPT_URL_INTRO,
          // Inline dynamic imports because PPTB does not resolve emitted chunks.
          codeSplitting: false,
          entryFileNames: 'assets/pp-md-app.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: (assetInfo) => {
            const originalName = assetInfo.name ?? '';

            if (originalName.endsWith('.css')) {
              return 'assets/pp-md-styles.css';
            }

            if (originalName.endsWith('.svg')) {
              if (originalName.includes('app-icon')) {
                return 'assets/pp-md-app-icon.svg';
              }
              return 'assets/[name][extname]';
            }

            return 'assets/[name][extname]';
          },
        },
      },
    },
  };
});
