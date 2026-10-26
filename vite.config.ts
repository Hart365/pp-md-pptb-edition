/**
 * Vite configuration for PP-MD PPTB Tool (Power Platform Markdown Documentation Generator).
 * Uses the official Vite React plugin for JSX/TSX transform support.
 * This tool runs in the Power Platform ToolBox iframe environment.
 */
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

interface HtmlTagLocation {
  start: number;
  end: number;
}

function isHtmlWhitespace(character: string | undefined): boolean {
  return character === ' ' || character === '\t' || character === '\n' || character === '\r' || character === '\f';
}

function findTagEnd(html: string, start: number): number {
  let quote = '';
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return -1;
}

interface HtmlTag extends HtmlTagLocation {
  name: string;
  closing: boolean;
}

function isAsciiLetter(character: string | undefined): boolean {
  return (character !== undefined && character >= 'a' && character <= 'z')
    || (character !== undefined && character >= 'A' && character <= 'Z');
}

function findNextHtmlTag(html: string, from: number): HtmlTag | undefined {
  let index = from;
  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start < 0) return undefined;

    if (html.startsWith('<!--', start)) {
      const commentEnd = html.indexOf('-->', start + 4);
      if (commentEnd < 0) return undefined;
      index = commentEnd + 3;
      continue;
    }

    let nameStart = start + 1;
    const closing = html[nameStart] === '/';
    if (closing) nameStart += 1;
    if (!isAsciiLetter(html[nameStart])) {
      const tagEnd = findTagEnd(html, start + 1);
      if (tagEnd < 0) return undefined;
      index = tagEnd;
      continue;
    }

    let nameEnd = nameStart + 1;
    while (
      nameEnd < html.length
      && !isHtmlWhitespace(html[nameEnd])
      && html[nameEnd] !== '>'
      && html[nameEnd] !== '/'
    ) {
      nameEnd += 1;
    }
    const end = findTagEnd(html, nameEnd);
    if (end < 0) return undefined;
    return {
      start,
      end,
      name: html.slice(nameStart, nameEnd).toLowerCase(),
      closing,
    };
  }
  return undefined;
}

function findClosingTag(html: string, tagName: string, from: number): HtmlTagLocation | undefined {
  let index = from;
  while (index < html.length) {
    const start = html.indexOf('<', index);
    if (start < 0) return undefined;
    const prefix = `</${tagName}`;
    const afterName = start + prefix.length;
    if (
      html.slice(start, afterName).toLowerCase() === prefix
      && (isHtmlWhitespace(html[afterName]) || html[afterName] === '>')
    ) {
      let endOfName = afterName;
      while (isHtmlWhitespace(html[endOfName])) endOfName += 1;
      if (html[endOfName] === '>') return { start, end: endOfName + 1 };
    }
    index = start + 1;
  }
  return undefined;
}

function normalizeOpeningTag(openingTag: string, tagName: string): { tag: string; hasSource: boolean } {
  const removedRanges: Array<[number, number]> = [];
  let hasSource = false;
  let cursor = tagName.length + 1;

  while (cursor < openingTag.length) {
    const whitespaceStart = cursor;
    while (isHtmlWhitespace(openingTag[cursor])) cursor += 1;
    if (openingTag[cursor] === '>' || openingTag[cursor] === '/' || cursor >= openingTag.length) break;

    const nameStart = cursor;
    while (
      cursor < openingTag.length
      && !isHtmlWhitespace(openingTag[cursor])
      && openingTag[cursor] !== '='
      && openingTag[cursor] !== '>'
      && openingTag[cursor] !== '/'
    ) {
      cursor += 1;
    }
    if (cursor === nameStart) {
      cursor += 1;
      continue;
    }

    const name = openingTag.slice(nameStart, cursor).toLowerCase();
    const nameEnd = cursor;
    while (isHtmlWhitespace(openingTag[cursor])) cursor += 1;
    let value = '';
    let attributeEnd = nameEnd;
    if (openingTag[cursor] === '=') {
      cursor += 1;
      while (isHtmlWhitespace(openingTag[cursor])) cursor += 1;
      const quote = openingTag[cursor] === '"' || openingTag[cursor] === "'" ? openingTag[cursor] : '';
      if (quote) cursor += 1;
      const valueStart = cursor;
      if (quote) {
        while (cursor < openingTag.length && openingTag[cursor] !== quote) cursor += 1;
        value = openingTag.slice(valueStart, cursor);
        if (openingTag[cursor] === quote) cursor += 1;
      } else {
        while (
          cursor < openingTag.length
          && !isHtmlWhitespace(openingTag[cursor])
          && openingTag[cursor] !== '>'
        ) {
          cursor += 1;
        }
        value = openingTag.slice(valueStart, cursor);
      }
      attributeEnd = cursor;
    } else {
      cursor = nameEnd;
    }

    if (tagName === 'script' && name === 'src') hasSource = true;
    if (name === 'crossorigin' || (tagName === 'script' && name === 'type' && value.toLowerCase() === 'module')) {
      removedRanges.push([whitespaceStart, attributeEnd]);
    }
  }

  let tag = openingTag;
  for (let index = removedRanges.length - 1; index >= 0; index -= 1) {
    const [start, end] = removedRanges[index];
    tag = tag.slice(0, start) + tag.slice(end);
  }
  return { tag, hasSource };
}

export function transformHtmlForPptb(html: string): string {
  const scripts: string[] = [];
  let output = '';
  let cursor = 0;
  let tag = findNextHtmlTag(html, cursor);

  while (tag) {
    output += html.slice(cursor, tag.start);
    if (!tag.closing && tag.name === 'script') {
      const closing = findClosingTag(html, 'script', tag.end);
      if (!closing) {
        output += html.slice(tag.start);
        return output;
      }

      const openingTag = normalizeOpeningTag(html.slice(tag.start, tag.end), tag.name);
      const body = html.slice(tag.end, closing.start);
      if (openingTag.hasSource && body.trim() === '') {
        scripts.push(openingTag.tag + body + html.slice(closing.start, closing.end));
      } else {
        output += openingTag.tag + body + html.slice(closing.start, closing.end);
      }
      cursor = closing.end;
    } else {
      output += !tag.closing
        ? normalizeOpeningTag(html.slice(tag.start, tag.end), tag.name).tag
        : html.slice(tag.start, tag.end);
      cursor = tag.end;
    }
    tag = findNextHtmlTag(html, cursor);
  }

  output += html.slice(cursor);
  if (scripts.length === 0) return output;

  const bodyClosing = findClosingTag(output, 'body', 0);
  if (!bodyClosing) return output;
  return output.slice(0, bodyClosing.start)
    + `  ${scripts.join('\n  ')}\n`
    + output.slice(bodyClosing.start);
}

function fixHtmlForPptb(): Plugin {
  return {
    name: 'fix-html-for-pptb',
    enforce: 'post',
    transformIndexHtml: transformHtmlForPptb,
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
