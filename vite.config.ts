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

export default defineConfig(({ mode }) => {
  const enableSourceMaps = mode !== 'production';

  return {
    plugins: [react(), fixHtmlForPptb()],
    base: './',
    build: {
      // Output to the standard dist folder
      outDir: 'dist',
      // Keep production bundles compact; source maps stay available in non-prod builds.
      sourcemap: enableSourceMaps,
      // PPTB serves the declared entry asset only. Keep Mermaid's dynamic
      // import graph in that asset so the sandbox can render diagrams.
      chunkSizeWarningLimit: 4500,
      // Emit stable, human-readable output file names for packaging.
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          format: 'iife',
          inlineDynamicImports: true,
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
      // Inline dynamic imports because PPTB does not resolve emitted chunks.
      rolldownOptions: {
        output: {
          codeSplitting: false,
        },
      },
    },
  };
});
