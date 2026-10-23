/**
 * @file MarkdownViewer.tsx
 * @description Renders Markdown with GFM, Mermaid diagram support, and a
 * raw/rendered toggle. WCAG compliant with accessible diagrams, headings,
 * tables, and copy/export actions.
 */

import { useState, useCallback, useEffect, useMemo, useRef, type ChangeEvent, type ComponentPropsWithoutRef, type MouseEvent, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { MermaidDiagram, forceRenderAllMountedDiagrams } from './MermaidDiagram';
import { ProgressBar } from './ProgressBar';
import styles from './MarkdownViewer.module.css';
import {
  buildStandaloneHtmlDocument,
  markdownSanitizationSchema,
  slugifyHeading,
  svgToPngDataUrl,
} from '../../api/documentRendering';
import { copyToClipboard } from '../../api/toolboxAPI';

export { extractText, slugifyHeading } from '../../api/documentRendering';

export interface MarkdownViewerProps {
  markdown: string;
  title?: string;
  onExport?: () => void | Promise<void>;
  /** Called with a standalone, styled HTML document string (rendered view content) for the "Export .html" action. */
  onExportHtml?: (html: string) => void | Promise<void>;
  onExportExcel?: () => void | Promise<void>;
  onExportPdf?: (markdown: string, title: string, diagramImages: ReadonlyArray<string | null>) => void | Promise<void>;
  /** Mermaid built-in theme (colour scheme) applied to generated diagrams. */
  diagramColourTheme?: 'neutral' | 'default' | 'dark' | 'forest' | 'base';
}

type HeadingRendererProps = ComponentPropsWithoutRef<'h1'> & { children?: ReactNode };

/**
 * Collects every rendered Mermaid diagram inside the given container, in
 * document order, converting each to a PNG data URL for PDF export. Diagrams
 * that failed to render (no `<svg>` present) produce `null` at their index so
 * ordering still matches the Markdown source's `mermaid` code fences.
 */
async function collectDiagramImages(container: HTMLElement): Promise<Array<string | null>> {
  const figures = Array.from(container.querySelectorAll<HTMLElement>('figure'));
  const images: Array<string | null> = [];
  for (const figure of figures) {
    const svg = figure.querySelector<SVGSVGElement>('svg');
    images.push(svg ? await svgToPngDataUrl(svg) : null);
  }
  return images;
}

function waitForBrowserPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0);
      return;
    }

    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Renders Markdown with diagram support, raw/rendered toggle, and export.
 */
export function MarkdownViewer({ markdown, title, onExport, onExportHtml, onExportExcel, onExportPdf, diagramColourTheme }: MarkdownViewerProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchMatchCount, setSearchMatchCount] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchRangesRef = useRef<Range[]>([]);
  const [renderedDiagramIds, setRenderedDiagramIds] = useState<ReadonlySet<string>>(() => new Set());
  const [diagramProgressResetKey, setDiagramProgressResetKey] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportKind, setExportKind] = useState<'markdown' | 'html' | 'pdf' | 'excel' | null>(null);
  const [pendingPdfExport, setPendingPdfExport] = useState(false);
  const exportMenuRef = useRef<HTMLDetailsElement>(null);

  /** Total `mermaid` code fences in the current document, used for render progress. */
  const totalDiagrams = useMemo(() => (markdown.match(/```mermaid/g) ?? []).length, [markdown]);

  // Reset diagram render progress whenever a new document is shown or rendered view is re-entered.
  // Adjusted during render (React's documented pattern for resetting state on prop change)
  // rather than in an effect, to avoid an extra cascading render.
  const nextDiagramProgressResetKey = `${markdown}:${showRaw}`;
  if (diagramProgressResetKey !== nextDiagramProgressResetKey) {
    setDiagramProgressResetKey(nextDiagramProgressResetKey);
    if (renderedDiagramIds.size > 0) setRenderedDiagramIds(new Set());
  }

  const handleDiagramRendered = useCallback((id: string) => {
    setRenderedDiagramIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  const renderedDiagramCount = Math.min(renderedDiagramIds.size, totalDiagrams);
  const diagramsStillRendering = !showRaw && totalDiagrams > 0 && renderedDiagramCount < totalDiagrams;

  const focusSearchMatch = useCallback((index: number) => {
    const ranges = searchRangesRef.current;
    if (!CSS.highlights || !ranges[index]) return;
    const range = ranges[index];
    CSS.highlights.set('ppmd-search-active', new Highlight(range));
    const container = range.startContainer.parentElement;
    container?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setSearchIndex(index);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    CSS.highlights?.delete('ppmd-search');
    CSS.highlights?.delete('ppmd-search-active');
    searchRangesRef.current = [];
    const query = searchQuery.trim().toLowerCase();
    if (!searchOpen || showRaw || !CSS.highlights || !contentRef.current || query.length < 3) {
      queueMicrotask(() => {
        setSearchIndex(-1);
        setSearchMatchCount(0);
      });
      return;
    }

    const ranges: Range[] = [];
    const walker = document.createTreeWalker(contentRef.current, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.toLowerCase() ?? '';
      for (let index = text.indexOf(query); index !== -1; index = text.indexOf(query, index + query.length)) {
        const range = new Range();
        range.setStart(node, index);
        range.setEnd(node, index + query.length);
        ranges.push(range);
      }
    }
    searchRangesRef.current = ranges;
    if (ranges.length > 0) {
      CSS.highlights.set('ppmd-search', new Highlight(...ranges));
    }
    queueMicrotask(() => {
      setSearchIndex(-1);
      setSearchMatchCount(ranges.length);
    });
  }, [markdown, searchOpen, searchQuery, showRaw]);

  const scrollToHeading = useCallback((href: string) => {
    if (!contentRef.current || !href.startsWith('#')) return false;

    const rawTarget = href.slice(1).trim();
    if (!rawTarget) return false;

    const decodedTarget = (() => {
      try {
        return decodeURIComponent(rawTarget);
      } catch {
        return rawTarget;
      }
    })();

    if (decodedTarget.toLowerCase() === 'table-of-contents') {
      contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      window.history.replaceState(null, '', '#table-of-contents');
      return true;
    }

    const escapedId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(decodedTarget)
      : decodedTarget.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');

    let target = contentRef.current.querySelector<HTMLElement>(`#${escapedId}`);

    if (!target) {
      const lower = decodedTarget.toLowerCase();
      target = Array
        .from(contentRef.current.querySelectorAll<HTMLElement>('[id]'))
        .find((el) => el.id.toLowerCase() === lower) ?? null;
    }

    if (!target) return false;

    target.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
    window.history.replaceState(null, '', `#${rawTarget}`);
    return true;
  }, []);

  const makeHeading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') => {
    return ({ children, ...props }: HeadingRendererProps) => {
      const id = slugifyHeading(children);
      return <Tag id={id} {...props}>{children}</Tag>;
    };
  };

  const components: Components = useMemo(() => ({
    code: ({ className, children, ...props }) => {
      const classNameText = typeof className === 'string' ? className : '';
      const lang = /language-(\w+)/.exec(classNameText)?.[1] ?? '';
      if (lang !== 'mermaid') {
        return <code className={classNameText} {...props}>{children}</code>;
      }
      const src = String(children).replace(/\n$/, '');
      const cap = src.match(/%%\s*(.+?)\s*%%/)?.[1] ?? 'Diagram';
      return <MermaidDiagram chart={src} caption={cap} onRendered={handleDiagramRendered} theme={diagramColourTheme} />;
    },
    h1: makeHeading('h1'),
    h2: makeHeading('h2'),
    h3: makeHeading('h3'),
    h4: makeHeading('h4'),
    h5: makeHeading('h5'),
    h6: makeHeading('h6'),
    a: ({ href, children, ...props }) => {
      const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
        if (!href?.startsWith('#')) return;
        if (!scrollToHeading(href)) return;
        event.preventDefault();
      };

      return <a href={href} {...props} onClick={handleClick}>{children}</a>;
    },
    table: ({ children, ...props }) => (
      <div style={{ overflowX: 'auto', margin: '1rem 0' }} role="region" aria-label="Table">
        <table {...props}>{children}</table>
      </div>
    ),
  }), [handleDiagramRendered, diagramColourTheme, scrollToHeading]);

  const renderedMarkdown = useMemo(() => (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      // Solution metadata can contain HTML. Parse it for generated table
      // badges, then remove scriptable or unsafe elements and attributes.
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizationSchema]]}
      components={components}
    >
      {markdown}
    </ReactMarkdown>
  ), [markdown, components]);

  const handleCopy = useCallback(async () => {
    try {
      await copyToClipboard(markdown);
      setCopyMsg('Copied!');
      setTimeout(() => setCopyMsg(''), 2000);
    } catch {
      setCopyMsg('Copy failed — select and copy manually.');
      setTimeout(() => setCopyMsg(''), 3000);
    }
  }, [markdown]);

  const handleContentClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute('href') || '';
    if (!href.startsWith('#')) return;

    if (scrollToHeading(href)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [scrollToHeading]);

  const handleExportHtml = useCallback(() => {
    if (!onExportHtml || !contentRef.current) return;
    return onExportHtml(buildStandaloneHtmlDocument(title || 'PP-MD Documentation', contentRef.current.innerHTML));
  }, [onExportHtml, title]);

  const runExport = useCallback((action: (() => void | Promise<void>) | undefined, kind: 'markdown' | 'html' | 'pdf' | 'excel') => {
    exportMenuRef.current?.removeAttribute('open');
    if (!action || exporting) return;
    setExporting(true);
    setExportKind(kind);
    void Promise.resolve()
      .then(async () => {
        if (kind === 'pdf') await waitForBrowserPaint();
        await action();
      })
      .catch(() => undefined)
      .finally(async () => {
        if (kind === 'pdf') await waitForBrowserPaint();
        setExporting(false);
        setExportKind(null);
      });
  }, [exporting]);

  // PDF export always available; it captures the rendered view, so switch
  // out of raw mode before proceeding. Diagram activation itself is handled
  // by the effect below, once diagrams are actually mounted.
  const handlePdfExportClick = useCallback(() => {
    if (!onExportPdf || exporting) return;
    exportMenuRef.current?.removeAttribute('open');
    setPendingPdfExport(true);
    if (showRaw) setShowRaw(false);
  }, [onExportPdf, exporting, showRaw]);

  // Tells every already-mounted diagram to render immediately (skipping the
  // scroll-based lazy gate) via a direct broadcast (`forceRenderAllMountedDiagrams`)
  // rather than by changing `components`/react-markdown props — mutating those
  // would remount and re-parse the whole document, freezing the UI before any
  // progress message could paint. This also covers the raw→rendered transition,
  // since it re-runs once `showRaw` flips to false and diagrams have mounted.
  useEffect(() => {
    if (!pendingPdfExport || showRaw) return;
    forceRenderAllMountedDiagrams();
  }, [pendingPdfExport, showRaw]);

  useEffect(() => {
    if (!pendingPdfExport || showRaw || diagramsStillRendering) return;
    if (!contentRef.current || !onExportPdf) {
      queueMicrotask(() => setPendingPdfExport(false));
      return;
    }
    const element = contentRef.current;
    const renderTitle = title || 'PP-MD Documentation';
    queueMicrotask(() => {
      setPendingPdfExport(false);
      runExport(async () => {
        const diagramImages = await collectDiagramImages(element);
        await onExportPdf(markdown, renderTitle, diagramImages);
      }, 'pdf');
    });
  }, [pendingPdfExport, showRaw, diagramsStillRendering, onExportPdf, title, markdown, runExport]);

  return (
    <section
      className={styles.viewer}
      aria-label={title ? `Documentation for ${title}` : 'Generated documentation'}
    >
      <div className={styles.toolbar} role="toolbar" aria-label="Documentation actions">
        {title && <h2 className={styles.viewerTitle}>{title}</h2>}
        <div className={styles.actionGroups}>
          <div className={styles.actionGroup} role="group" aria-label="View and document tools">
            <button type="button" className={styles.toolbarBtn} onClick={() => setShowRaw((v) => !v)} aria-pressed={showRaw} aria-label={showRaw ? 'Switch to rendered view' : 'Switch to raw Markdown view'}>
              <span className={styles.btnIcon} aria-hidden="true">{showRaw ? '◉' : '≡'}</span>{showRaw ? 'Rendered' : 'Raw Markdown'}
            </button>
            <button type="button" className={styles.toolbarBtn} onClick={() => setSearchOpen((open) => !open)} aria-pressed={searchOpen} disabled={showRaw} title={showRaw ? 'Switch to rendered view to search' : 'Search document'}>
              <span className={styles.btnIcon} aria-hidden="true">⌕</span>Search
            </button>
            <button type="button" className={styles.toolbarBtn} onClick={handleCopy} aria-label="Copy Markdown to clipboard">
              <span className={styles.btnIcon} aria-hidden="true">▣</span>Copy
            </button>
          </div>
          <div className={`${styles.actionGroup} ${styles.exportGroup}`} role="group" aria-label="Export formats">
            <details ref={exportMenuRef} className={styles.exportMenu}>
              <summary className={`${styles.toolbarBtn} ${styles.primary}`} aria-busy={exporting}>
                <span className={styles.exportLabel}>{exporting ? 'Exporting...' : 'Export'}</span>
                <span className={styles.dropdownArrow} aria-hidden="true">▼</span>
              </summary>
              <div className={styles.exportMenuPanel}>
                {onExport && <button type="button" className={styles.menuBtn} onClick={() => runExport(onExport, 'markdown')} disabled={exporting}>Markdown (.md)</button>}
                {onExportHtml && <button type="button" className={styles.menuBtn} onClick={() => runExport(handleExportHtml, 'html')} disabled={showRaw || exporting}>HTML (.html)</button>}
                {onExportPdf && <button type="button" className={styles.menuBtn} onClick={handlePdfExportClick} disabled={exporting || pendingPdfExport}>PDF (.pdf)</button>}
                {onExportExcel && <button type="button" className={styles.menuBtn} onClick={() => runExport(onExportExcel, 'excel')} disabled={exporting}>Excel (.xlsx)</button>}
              </div>
            </details>
          </div>
        </div>
      </div>
      {copyMsg && (
        <div aria-live="polite" className={styles.copyToast} role="status">
          {copyMsg}
        </div>
      )}
      {pendingPdfExport && (showRaw || diagramsStillRendering) && (
        <div aria-live="polite" className={styles.exportNotice} role="status">
          Preparing document for PDF export — rendering diagrams ({renderedDiagramCount} of {totalDiagrams})…
        </div>
      )}
      {exportKind === 'pdf' && !pendingPdfExport && (
        <div aria-live="polite" className={styles.exportNotice} role="status">
          Generating PDF… the Save dialog will open when the file is ready.
        </div>
      )}
      {exportKind === 'excel' && (
        <div aria-live="polite" className={styles.exportNotice} role="status">
          Generating Excel workbook… this can take a few moments for large solutions.
        </div>
      )}
      {diagramsStillRendering && (
        <div className={styles.diagramProgress}>
          <ProgressBar
            value={(renderedDiagramCount / totalDiagrams) * 100}
            label={pendingPdfExport
              ? `Rendering diagrams for PDF export (${renderedDiagramCount} of ${totalDiagrams})…`
              : `Rendering diagrams (${renderedDiagramCount} of ${totalDiagrams} — remaining diagrams render as you scroll to them)`}
          />
        </div>
      )}
      {searchOpen && !showRaw && (
        <div className={styles.searchBar} role="search">
          <label htmlFor="markdown-search" className="sr-only">Search document</label>
          <input
            ref={searchInputRef}
            id="markdown-search"
            className={styles.searchInput}
            type="search"
            value={searchQuery}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
            placeholder="Enter at least 3 characters"
          />
          <span className={styles.searchMatchCount} aria-live="polite">
            {searchQuery.trim().length < 3 ? 'Enter 3 characters' : `${searchMatchCount} matches`}
          </span>
          <button type="button" className={styles.toolbarBtn} onClick={() => focusSearchMatch((searchIndex - 1 + searchMatchCount) % searchMatchCount)} disabled={searchMatchCount === 0}>Previous</button>
          <button type="button" className={styles.toolbarBtn} onClick={() => focusSearchMatch((searchIndex + 1) % searchMatchCount)} disabled={searchMatchCount === 0}>Next</button>
        </div>
      )}
      {showRaw ? (
        <pre className={`${styles.rawSource} ppmd-printable`} aria-label="Raw Markdown source">
          <code>{markdown}</code>
        </pre>
      ) : (
        <div
          ref={contentRef}
          className={`${styles.content} markdown-body ppmd-printable`}
          onClickCapture={handleContentClickCapture}
        >
          {renderedMarkdown}
        </div>
      )}
    </section>
  );
}
