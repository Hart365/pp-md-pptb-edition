/**
 * @file App.tsx
 * @description Root application component for PP-MD - PPTB Edition.
 *
 * Application flow:
 *  1. User lands on the drop zone (welcome screen).
 *  2. User selects/drops one or more solution ZIP files.
 *  3. Each ZIP is parsed asynchronously (individual progress per file).
 *  4. For each parsed solution a Markdown document is generated.
 *  5. The generated documentation is displayed in the MarkdownViewer.
 *  6. A sidebar lists all parsed solutions for navigation.
 *  7. Users can export each document as a .md file.
 *
 * WCAG 2.2 compliance:
 *  - 2.4.1 Bypass Blocks: A "Skip to main content" link is the first
 *    focusable element on the page.
 *  - 1.3.1 Info & Relationships: Landmark roles (header, main, nav) used.
 *  - 4.1.3 Status Messages: Processing status announced via aria-live.
 *  - 3.2.2 On Input: No unexpected context changes on file selection alone;
 *    user must click Generate.
 */

import { useState, useCallback, useEffect, useRef, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react';
import JSZip from 'jszip';
import { DropZone }          from './components/ui/DropZone';
import { DataverseSolutionBrowser } from './components/ui/DataverseSolutionBrowser';
import { ProgressBar }       from './components/ui/ProgressBar';
import { MarkdownViewer }    from './components/ui/MarkdownViewer';
import { SolutionSidebar }   from './components/SolutionSidebar';
import { parseSolutionZip }  from './parser/solutionParser';
import {
  generateMarkdown,
  generateConsolidatedMarkdown,
  generateDependencyReportMarkdown,
  consolidateSolutions,
  fillSolutionGapsFromPeerSolutions,
  type DocumentContext,
  type EnrichmentIndicators,
} from './generator/markdownGenerator';
import type { ParsedSolution } from './types/solution';
import {
  buildParsedSolutionFromDataverse,
  enrichSolutionsWithDataverseMetadata,
  listDataverseSolutions,
  type DataverseSolutionSummary,
} from './dataverse/solutionService';
import { useToolboxAPI }     from './hooks/useToolboxAPI';
import { exportMarkdown, exportZip } from './api/fileManager';
import { showNotification }  from './api/toolboxAPI';
import appIcon from './assets/app-icon.svg';
import githubMark from './assets/github-mark.svg';
import packageJson from '../package.json';
import styles from './App.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** State for a single file being processed */
interface ProcessingEntry {
  fileName: string;
  progress: number; // 0–100
  error?: string;
}

/** A fully-processed result */
interface SolutionResult {
  solution:  ParsedSolution;
  markdown:  string;
  fileName:  string;
  isConsolidated?: boolean;
  peerGapFillApplied?: boolean;
  dataverseMetadataEnriched?: boolean;
}

type ErdMode = 'compact' | 'detailed-relationships';
type LaunchMode = 'local' | 'dataverse';

interface GenerationPreferences {
  erdMode: ErdMode;
  includeDiagrams: boolean;
  includeDefaultColumns: boolean;
}

interface SavedDocumentConfiguration extends DocumentContext {
  id: string;
  name: string;
}

interface ConfigurationFile {
  configurations: SavedDocumentConfiguration[];
}

const LOCAL_CONFIG_STORAGE_KEY = 'pp-md-pptb-edition-doc-configurations';
const LOCAL_HIDDEN_CONFIG_IDS_KEY = 'pp-md-pptb-edition-hidden-doc-configuration-ids';

const EMPTY_DOCUMENT_CONTEXT: DocumentContext = {
  client: '',
  project: '',
  contract: '',
  sow: '',
  sprint: '',
  releaseDate: '',
};

const APP_VERSION = packageJson.version;
const GITHUB_REPO_URL = typeof packageJson.repository === 'string'
  ? packageJson.repository
  : packageJson.repository?.url ?? 'https://github.com';
const WEBSITE_URL = 'https://HartOfTheMidlands.co.uk';

function toSafeMarkdownBaseName(rawName: string | undefined | null, fallback: string): string {
  const source = (rawName || fallback).trim();
  return source
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, '_');
}

function solutionDisplayName(solution: ParsedSolution): string {
  return (solution.metadata.displayName || solution.metadata.uniqueName || '').trim();
}

function sortSolutionResults(results: SolutionResult[]): SolutionResult[] {
  return [...results].sort((left, right) => solutionDisplayName(left.solution).localeCompare(
    solutionDisplayName(right.solution),
    undefined,
    { numeric: true, sensitivity: 'base' },
  ));
}

function sortFilesByName(files: File[]): File[] {
  return [...files].sort((left, right) => left.name.localeCompare(
    right.name,
    undefined,
    { numeric: true, sensitivity: 'base' },
  ));
}

function resultEnrichmentIndicators(result: Pick<SolutionResult, 'peerGapFillApplied' | 'dataverseMetadataEnriched'>): EnrichmentIndicators {
  return {
    peerGapFillApplied: result.peerGapFillApplied,
    dataverseMetadataEnriched: result.dataverseMetadataEnriched,
  };
}

function isInvalidArchiveError(message: string): boolean {
  return /invalid|zip|archive|solution\.xml|central directory/i.test(message);
}

function readSavedConfigurations(): SavedDocumentConfiguration[] {
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((entry) => typeof entry === 'object' && entry !== null)
      .map((entry) => entry as SavedDocumentConfiguration)
      .filter((entry) => !!entry.id && !!entry.name);
  } catch {
    return [];
  }
}

function writeSavedConfigurations(configs: SavedDocumentConfiguration[]): void {
  try {
    localStorage.setItem(LOCAL_CONFIG_STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // Best effort only; continue without blocking UX.
  }
}

function readHiddenConfigurationIds(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_HIDDEN_CONFIG_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  } catch {
    return [];
  }
}

function writeHiddenConfigurationIds(ids: string[]): void {
  try {
    localStorage.setItem(LOCAL_HIDDEN_CONFIG_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Best effort only; continue without blocking UX.
  }
}

function buildConsolidatedResult(
  results: SolutionResult[],
  generationPreferences: GenerationPreferences,
  documentContext: DocumentContext,
): SolutionResult {
  const solutions = results.map((r) => r.solution);
  const aggregated: ParsedSolution = consolidateSolutions(solutions);
  const indicators: EnrichmentIndicators = {
    peerGapFillApplied: results.some((result) => result.peerGapFillApplied),
    dataverseMetadataEnriched: results.some((result) => result.dataverseMetadataEnriched),
  };
  const summaryMarkdown = generateConsolidatedMarkdown(solutions, {
    documentContext,
    enrichmentIndicators: indicators,
    includeDiagrams: generationPreferences.includeDiagrams,
    includeDefaultColumns: generationPreferences.includeDefaultColumns,
  });
  const detailedMarkdown = generateMarkdown(aggregated, {
    erdMode: generationPreferences.erdMode,
    documentContext,
    enrichmentIndicators: indicators,
    includeDiagrams: generationPreferences.includeDiagrams,
    includeDefaultColumns: generationPreferences.includeDefaultColumns,
  });
  const markdown = `${summaryMarkdown}\n\n---\n\n${detailedMarkdown}`;

  return {
    solution: aggregated,
    markdown,
    fileName: 'all-selected-solutions.md',
    isConsolidated: true,
    peerGapFillApplied: indicators.peerGapFillApplied,
    dataverseMetadataEnriched: indicators.dataverseMetadataEnriched,
  };
}

function buildResultsWithCombinedDocument(
  baseResults: SolutionResult[],
  generationPreferences: GenerationPreferences,
  documentContext: DocumentContext,
): SolutionResult[] {
  const sortedBase = sortSolutionResults(baseResults
    .filter((entry) => !entry.isConsolidated));

  const enrichedBase = sortedBase.map((entry, index, allEntries) => {
    const peerSolutions = allEntries
      .filter((_, peerIndex) => peerIndex !== index)
      .map((peer) => peer.solution);
    const enrichedSolution = fillSolutionGapsFromPeerSolutions(entry.solution, peerSolutions);

    return {
      ...entry,
      solution: enrichedSolution,
      peerGapFillApplied: peerSolutions.length > 0,
      markdown: generateMarkdown(enrichedSolution, {
        erdMode: generationPreferences.erdMode,
        documentContext,
        includeDiagrams: generationPreferences.includeDiagrams,
        includeDefaultColumns: generationPreferences.includeDefaultColumns,
        enrichmentIndicators: resultEnrichmentIndicators({
          peerGapFillApplied: peerSolutions.length > 0,
          dataverseMetadataEnriched: entry.dataverseMetadataEnriched,
        }),
      }),
    };
  });

  if (enrichedBase.length > 1) {
    return [...enrichedBase, buildConsolidatedResult(enrichedBase, generationPreferences, documentContext)];
  }

  return enrichedBase;
}

function getLastBaseResultIndex(items: SolutionResult[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index].isConsolidated) {
      return index;
    }
  }
  return 0;
}

function rebuildResults(
  results: SolutionResult[],
  generationPreferences: GenerationPreferences,
  documentContext: DocumentContext,
): SolutionResult[] {
  const base = results.filter((entry) => !entry.isConsolidated);
  return buildResultsWithCombinedDocument(base, generationPreferences, documentContext);
}

/**
 * Estimates whether Markdown content is expensive to render.
 *
 * This keeps the UI responsive by showing a temporary "Please Wait" state
 * before mounting very large/complex markdown documents.
 */
function isLargeOrComplexMarkdown(markdown: string): boolean {
  const lengthThreshold = 45000;
  const headingThreshold = 80;
  const tableRowThreshold = 250;
  const mermaidThreshold = 6;

  const headingCount = (markdown.match(/^#{2,6}\s+/gm) ?? []).length;
  const tableRowCount = (markdown.match(/^\|.*\|\s*$/gm) ?? []).length;
  const mermaidCount = (markdown.match(/```mermaid/g) ?? []).length;

  return markdown.length >= lengthThreshold
    || headingCount >= headingThreshold
    || tableRowCount >= tableRowThreshold
    || mermaidCount >= mermaidThreshold;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Main application component.
 */
export default function App() {
  /** List of results (one per successfully processed ZIP) */
  const [results,       setResults]       = useState<SolutionResult[]>([]);
  /** Index of the currently displayed result */
  const [activeIdx,     setActiveIdx]     = useState<number>(0);
  /** Per-file progress tracking (shown during processing) */
  const [processing,    setProcessing]    = useState<ProcessingEntry[]>([]);
  /** Whether any files are currently being processed */
  const [isProcessing,  setIsProcessing]  = useState<boolean>(false);
  /** Top-level status message (announced to screen readers) */
  const [statusMsg,     setStatusMsg]     = useState<string>('');
  /** ERD rendering mode */
  const [erdMode,       setErdMode]       = useState<ErdMode>('detailed-relationships');
  /** Include diagram sections in generated markdown */
  const [includeDiagrams, setIncludeDiagrams] = useState<boolean>(true);
  /** Include default/system columns in table documentation */
  const [includeDefaultColumns, setIncludeDefaultColumns] = useState<boolean>(true);
  /** Document context for MD header details */
  const [documentContext, setDocumentContext] = useState<DocumentContext>(EMPTY_DOCUMENT_CONTEXT);
  /** Preset configurations loaded from JSON */
  const [configurations, setConfigurations] = useState<SavedDocumentConfiguration[]>([]);
  /** Selected configuration id from dropdown */
  const [selectedConfigId, setSelectedConfigId] = useState<string>('custom');
  /** Configuration load failure text */
  const [configLoadError, setConfigLoadError] = useState<string>('');
  /** New configuration name for save action */
  const [newConfigName, setNewConfigName] = useState<string>('');
  /** True when switching to a heavy markdown document so we can show feedback */
  const [isViewerLoading, setIsViewerLoading] = useState<boolean>(false);
  /** Launch mode selected by the user */
  const [launchMode, setLaunchMode] = useState<LaunchMode | null>(null);
  /** Solutions read from the active Dataverse environment */
  const [dataverseSolutions, setDataverseSolutions] = useState<DataverseSolutionSummary[]>([]);
  /** Dataverse solution browser loading state */
  const [isDataverseLoading, setIsDataverseLoading] = useState<boolean>(false);
  /** Dataverse solution browser error */
  const [dataverseError, setDataverseError] = useState<string>('');
  /** Search term for Dataverse solutions */
  const [dataverseSearch, setDataverseSearch] = useState<string>('');
  /** Sort order for Dataverse solutions */
  const [dataverseSort, setDataverseSort] = useState<'name-asc' | 'name-desc' | 'version-asc' | 'version-desc'>('name-asc');
  /** Managed / unmanaged filter */
  const [dataverseManagedFilter, setDataverseManagedFilter] = useState<'all' | 'managed' | 'unmanaged'>('all');
  /** Selected publishers used to filter Dataverse solutions */
  const [selectedPublishers, setSelectedPublishers] = useState<string[]>([]);
  /** Selected Dataverse solution IDs for batch generation */
  const [selectedDataverseSolutionIds, setSelectedDataverseSolutionIds] = useState<string[]>([]);
  /** Dataverse solution IDs currently being processed */
  const [busySolutionIds, setBusySolutionIds] = useState<string[]>([]);
  /** ZIP files queued in local mode drop zone */
  const [queuedLocalFiles, setQueuedLocalFiles] = useState<File[]>([]);
  /** Forces DropZone queue reset after generation or mode changes */
  const [dropZoneResetToken, setDropZoneResetToken] = useState<number>(0);
  /** Blocking invalid ZIP modal message */
  const [invalidArchiveMessage, setInvalidArchiveMessage] = useState<string | null>(null);
  /** Whether standalone dependency report export is enabled */
  const [includeDependencyReport, setIncludeDependencyReport] = useState<boolean>(false);
  const invalidArchiveOkRef = useRef<HTMLButtonElement | null>(null);

  const generationPreferences: GenerationPreferences = {
    erdMode,
    includeDiagrams,
    includeDefaultColumns,
  };

  /**
   * Guard against host click-through on startup opening external links.
   * A mouse click is accepted only when the same anchor received mousedown first.
   * Keyboard activation (detail === 0) is always allowed.
   */
  const handleExternalLinkMouseDown = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.currentTarget.dataset.ppmdArmed = 'true';
  }, []);

  const handleExternalLinkClick = useCallback((event: ReactMouseEvent<HTMLAnchorElement>) => {
    const anchor = event.currentTarget;
    const armed = anchor.dataset.ppmdArmed === 'true';
    delete anchor.dataset.ppmdArmed;

    // Keyboard-triggered anchor activation should continue to work.
    if (event.detail === 0) return;

    if (!armed) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  // Initialize PPTB API integration
  const {
    connection,
    isLoading: pptbLoading,
    isInPPTB,
    initializeConnection,
  } = useToolboxAPI({ autoInitConnection: false });

  const displayVersion = (window as Window & { __PPMD_VERSION__?: string }).__PPMD_VERSION__ || APP_VERSION;

  useEffect(() => {
    if (!isInPPTB) return;

    const timer = window.setTimeout(() => {
      void initializeConnection();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isInPPTB, initializeConnection]);

  useEffect(() => {
    let active = true;

    const loadConfigurations = async () => {
      const localConfigs = readSavedConfigurations();
      const hiddenConfigIds = new Set(readHiddenConfigurationIds());

      try {
        const response = await fetch('./doc-configurations.json', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const data = (await response.json()) as ConfigurationFile;
        if (!Array.isArray(data.configurations)) {
          throw new Error('Invalid configuration shape');
        }
        if (!active) return;
        setConfigurations(
          [...data.configurations, ...localConfigs].filter((config) => !hiddenConfigIds.has(config.id)),
        );
        setConfigLoadError('');
      } catch (err: unknown) {
        if (!active) return;
        setConfigurations(localConfigs.filter((config) => !hiddenConfigIds.has(config.id)));
        setConfigLoadError(`Could not load doc-configurations.json: ${(err as Error).message}`);
      }
    };

    loadConfigurations();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (invalidArchiveMessage) {
      invalidArchiveOkRef.current?.focus();
    }
  }, [invalidArchiveMessage]);

  const applyConfiguration = useCallback((config: SavedDocumentConfiguration) => {
    const nextDocumentContext: DocumentContext = {
      client: config.client ?? '',
      project: config.project ?? '',
      contract: config.contract ?? '',
      sow: config.sow ?? '',
      sprint: config.sprint ?? '',
      releaseDate: config.releaseDate ?? '',
    };

    setDocumentContext({
      client: nextDocumentContext.client,
      project: nextDocumentContext.project,
      contract: nextDocumentContext.contract,
      sow: nextDocumentContext.sow,
      sprint: nextDocumentContext.sprint,
      releaseDate: nextDocumentContext.releaseDate,
    });
    setResults((prev) => rebuildResults(prev, generationPreferences, nextDocumentContext));
  }, [generationPreferences]);

  const handleConfigurationSelect = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSelectedConfigId(value);
    if (value === 'custom') return;
    const selected = configurations.find((config) => config.id === value);
    if (!selected) return;
    applyConfiguration(selected);
    setNewConfigName(selected.name);
  }, [configurations, applyConfiguration]);

  const handleContextChange = useCallback((field: keyof DocumentContext, value: string) => {
    const nextDocumentContext = { ...documentContext, [field]: value };
    setSelectedConfigId('custom');
    setDocumentContext(nextDocumentContext);
    setResults((prev) => rebuildResults(prev, generationPreferences, nextDocumentContext));
  }, [documentContext, generationPreferences]);

  const handleSaveConfiguration = useCallback(() => {
    const name = newConfigName.trim();
    if (!name) {
      setStatusMsg('Please enter a configuration name before saving.');
      return;
    }

    const configId = `local-${Date.now()}`;
    const configToSave: SavedDocumentConfiguration = {
      id: configId,
      name,
      client: documentContext.client,
      project: documentContext.project,
      contract: documentContext.contract,
      sow: documentContext.sow,
      sprint: documentContext.sprint,
      releaseDate: documentContext.releaseDate,
    };

    const savedConfigs = readSavedConfigurations();
    const withoutExistingName = savedConfigs.filter((cfg) => cfg.name.toLowerCase() !== name.toLowerCase());
    const updatedSavedConfigs = [...withoutExistingName, configToSave];
    writeSavedConfigurations(updatedSavedConfigs);

    setConfigurations((prev) => {
      const withoutExistingNameInDropdown = prev.filter((cfg) => cfg.name.toLowerCase() !== name.toLowerCase());
      return [...withoutExistingNameInDropdown, configToSave];
    });

    setSelectedConfigId(configId);
    setStatusMsg(`Configuration "${name}" saved.`);
  }, [newConfigName, documentContext]);

  const handleDeleteConfiguration = useCallback((configId: string) => {
    if (configId === 'custom') return;

    const configToDelete = configurations.find((config) => config.id === configId);
    if (!configToDelete) return;

    const updatedHiddenIds = Array.from(new Set([...readHiddenConfigurationIds(), configId]));
    writeHiddenConfigurationIds(updatedHiddenIds);

    if (configId.startsWith('local-')) {
      const updatedSaved = readSavedConfigurations().filter((config) => config.id !== configId);
      writeSavedConfigurations(updatedSaved);
    }

    setConfigurations((prev) => prev.filter((config) => config.id !== configId));

    if (selectedConfigId === configId) {
      setSelectedConfigId('custom');
      setNewConfigName('');
    }

    setStatusMsg(`Configuration "${configToDelete.name}" deleted.`);
  }, [configurations, selectedConfigId]);

  const loadDataverseSolutions = useCallback(async () => {
    const activeConnection = connection ?? await initializeConnection();
    if (!activeConnection) {
      setDataverseSolutions([]);
      setDataverseError('No active Dataverse connection is available. Open or activate a connection in Power Platform ToolBox, then refresh this list.');
      return;
    }

    setIsDataverseLoading(true);
    setDataverseError('');

    try {
      const solutions = await listDataverseSolutions();
      setDataverseSolutions(solutions);
      setStatusMsg(`Loaded ${solutions.length} solution${solutions.length === 1 ? '' : 's'} from ${activeConnection.name}.`);

      const publishers = Array.from(new Set(
        solutions
          .map((solution) => solution.publisherName?.trim())
          .filter((name): name is string => Boolean(name)),
      )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

      setSelectedPublishers(publishers);
      setSelectedDataverseSolutionIds([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read solutions from Dataverse.';
      setDataverseSolutions([]);
      setSelectedPublishers([]);
      setSelectedDataverseSolutionIds([]);
      setDataverseError(message);
      setStatusMsg(`Failed to load Dataverse solutions: ${message}`);
    } finally {
      setIsDataverseLoading(false);
    }
  }, [connection, initializeConnection]);

  const handleSelectLaunchMode = useCallback((mode: LaunchMode) => {
    setLaunchMode(mode);
    setResults([]);
    setActiveIdx(0);
    setProcessing([]);
    setIsProcessing(false);
    setDataverseError('');
    setSelectedDataverseSolutionIds([]);
    setQueuedLocalFiles([]);
    setDropZoneResetToken((prev) => prev + 1);
    setStatusMsg(mode === 'local'
      ? 'Local Solutions mode selected. Upload one or more solution ZIP files to continue.'
      : 'Dataverse Connected mode selected. Choose a solution from the active environment to continue.');
    if (mode === 'dataverse') {
      void loadDataverseSolutions();
    }
  }, [loadDataverseSolutions]);

  const handleReturnToModeSelection = useCallback(() => {
    setLaunchMode(null);
    setResults([]);
    setActiveIdx(0);
    setProcessing([]);
    setIsProcessing(false);
    setBusySolutionIds([]);
    setSelectedPublishers([]);
    setSelectedDataverseSolutionIds([]);
    setQueuedLocalFiles([]);
    setDropZoneResetToken((prev) => prev + 1);
    setInvalidArchiveMessage(null);
    setStatusMsg('Choose how you want to generate solution documentation.');
  }, []);

  const updateProcessingEntry = useCallback(
    (index: number, updater: (entry: ProcessingEntry) => ProcessingEntry) => {
      setProcessing((prev) => {
        if (!prev[index]) return prev;
        const updated = [...prev];
        updated[index] = updater(updated[index]);
        return updated;
      });
    },
    [],
  );

  // ── File processing ───────────────────────────────────────────────────────

  /**
   * Processes an array of ZIP files sequentially, updating progress state
   * as each file is parsed.
   *
   * @param files - Files selected by the user
   */
  const handleFilesSelected = useCallback(async (files: File[]) => {
    const sortedFiles = sortFilesByName(files);

    setIsProcessing(true);
    setStatusMsg(`Processing ${sortedFiles.length} file${sortedFiles.length > 1 ? 's' : ''}…`);

    // Initialise progress tracking for all files
    const initial: ProcessingEntry[] = sortedFiles.map((f) => ({
      fileName: f.name,
      progress: 0,
    }));
    setProcessing(initial);

    const newResults: SolutionResult[] = [];
    const invalidArchiveFiles: string[] = [];

    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];

      try {
        setStatusMsg(`Parsing ${file.name}…`);

        const solution = await parseSolutionZip(file, (pct) => {
          // Update progress for this specific file
          updateProcessingEntry(i, (entry) => ({ ...entry, progress: pct }));
        });

        setStatusMsg(`Generating documentation for ${file.name}…`);
        const markdown = generateMarkdown(solution, {
          erdMode,
          documentContext,
          includeDiagrams,
          includeDefaultColumns,
        });

        newResults.push({ solution, markdown, fileName: file.name });

        // Mark as complete
        updateProcessingEntry(i, (entry) => ({ ...entry, progress: 100 }));
      } catch (err: unknown) {
        const msg = (err as Error).message ?? 'Unknown error';
        updateProcessingEntry(i, (entry) => ({ ...entry, progress: 0, error: msg }));
        if (isInvalidArchiveError(msg)) {
          invalidArchiveFiles.push(file.name);
        }
        // Continue with remaining files rather than aborting
      }
    }

    if (newResults.length > 0) {
      const existingBase = results.filter((r) => !r.isConsolidated);
      const mergedBase = [...existingBase, ...newResults];
      const nextResults = buildResultsWithCombinedDocument(mergedBase, generationPreferences, documentContext);

      setResults(nextResults);
      setActiveIdx(getLastBaseResultIndex(nextResults));
      const count  = newResults.length;
      const failed = sortedFiles.length - count;
      setStatusMsg(
        failed > 0
          ? `Done: ${count} document${count > 1 ? 's' : ''} generated, ${failed} file${failed > 1 ? 's' : ''} failed.`
          : `Done: ${count} document${count > 1 ? 's' : ''} generated successfully.`,
      );
    } else {
      setStatusMsg('No documents generated. Check that the files are valid Power Platform solution ZIPs.');
    }

    setIsProcessing(false);
    if (invalidArchiveFiles.length > 0) {
      setInvalidArchiveMessage(
        invalidArchiveFiles.length === 1
          ? `${invalidArchiveFiles[0]} is not a valid Power Platform solution ZIP archive and was removed from the selection list.`
          : `${invalidArchiveFiles.length} invalid ZIP archives were removed from the selection list.`,
      );
    }
    // Clear progress indicators after a brief delay
    setTimeout(() => setProcessing([]), 1500);
  }, [
    results,
    erdMode,
    documentContext,
    includeDiagrams,
    includeDefaultColumns,
    generationPreferences,
    updateProcessingEntry,
  ]);

  const handleGenerateSelectedDataverseSolutions = useCallback(async () => {
    if (selectedDataverseSolutionIds.length === 0) {
      setDataverseError('Select at least one solution to generate documentation.');
      return;
    }

    const activeConnection = connection ?? await initializeConnection();
    if (!activeConnection) {
      setDataverseError('No active Dataverse connection is available. Open or activate a connection in Power Platform ToolBox and try again.');
      return;
    }

    const selectedSummaries = dataverseSolutions.filter(
      (solution) => selectedDataverseSolutionIds.includes(solution.solutionId),
    );
    if (selectedSummaries.length === 0) {
      setDataverseError('The selected solutions are no longer available. Refresh the list and try again.');
      return;
    }

    setBusySolutionIds(selectedSummaries.map((solution) => solution.solutionId));
    setIsProcessing(true);
    setProcessing(selectedSummaries.map((solution) => ({ fileName: solution.displayName, progress: 0 })));
    setStatusMsg(`Reading ${selectedSummaries.length} solution${selectedSummaries.length === 1 ? '' : 's'} from ${activeConnection.name}...`);

    try {
      const generatedResults: SolutionResult[] = [];

      for (let index = 0; index < selectedSummaries.length; index += 1) {
        const summary = selectedSummaries[index];

        const solution = await buildParsedSolutionFromDataverse(summary.solutionId, ({ message, percent }) => {
          setStatusMsg(message);
          updateProcessingEntry(index, (entry) => ({ ...entry, progress: percent }));
        });

        const markdown = generateMarkdown(solution, {
          erdMode,
          documentContext,
          includeDiagrams,
          includeDefaultColumns,
        });
        generatedResults.push({
          solution,
          markdown,
          fileName: `${summary.uniqueName}.dataverse`,
          dataverseMetadataEnriched: false,
        });

        updateProcessingEntry(index, (entry) => ({ ...entry, progress: 100 }));
      }

      const existingBase = results.filter((entry) => !entry.isConsolidated);
      const mergedBase = sortSolutionResults([...existingBase, ...generatedResults]);

      let metadataEnrichedBase = mergedBase;
      try {
        const enrichedSolutions = await enrichSolutionsWithDataverseMetadata(
          mergedBase.map((entry) => entry.solution),
          ({ message }) => {
            setStatusMsg(message);
          },
        );
        metadataEnrichedBase = mergedBase.map((entry, index) => ({
          ...entry,
          solution: enrichedSolutions[index] ?? entry.solution,
          dataverseMetadataEnriched: entry.fileName.endsWith('.dataverse')
            ? true
            : entry.dataverseMetadataEnriched,
        }));
      } catch (metadataError) {
        const metadataMessage = metadataError instanceof Error
          ? metadataError.message
          : 'Unable to enrich selected solutions with Dataverse metadata.';
        setStatusMsg(`Dataverse metadata enrichment warning: ${metadataMessage}`);
      }

      const nextResults = buildResultsWithCombinedDocument(metadataEnrichedBase, generationPreferences, documentContext);

      setResults(nextResults);
      setActiveIdx(getLastBaseResultIndex(nextResults));
      setStatusMsg(`Documentation generated for ${generatedResults.length} Dataverse solution${generatedResults.length === 1 ? '' : 's'}.`);
      await showNotification(
        'Documentation Ready',
        `${generatedResults.length} Dataverse solution${generatedResults.length === 1 ? '' : 's'} documented.`,
        'success',
        3000,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to read the selected solution.';
      setProcessing((prev) => prev.map((entry) => ({ ...entry, error: message })));
      setStatusMsg(`Failed to generate Dataverse documentation: ${message}`);
      await showNotification('Dataverse Read Failed', message, 'error', 4000);
    } finally {
      setBusySolutionIds([]);
      setIsProcessing(false);
      setTimeout(() => setProcessing([]), 1500);
    }
  }, [
    connection,
    dataverseSolutions,
    documentContext,
    erdMode,
    includeDiagrams,
    includeDefaultColumns,
    generationPreferences,
    initializeConnection,
    results,
    selectedDataverseSolutionIds,
    updateProcessingEntry,
  ]);

  const handleTogglePublisher = useCallback((publisher: string) => {
    setSelectedPublishers((prev) => (
      prev.includes(publisher)
        ? prev.filter((entry) => entry !== publisher)
        : [...prev, publisher]
    ));
  }, []);

  const handleSelectAllPublishers = useCallback(() => {
    const allPublishers = Array.from(new Set(
      dataverseSolutions
        .map((solution) => solution.publisherName?.trim())
        .filter((name): name is string => Boolean(name)),
    )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
    setSelectedPublishers(allPublishers);
  }, [dataverseSolutions]);

  const handleClearPublishers = useCallback(() => {
    setSelectedPublishers([]);
  }, []);

  const handleToggleDataverseSolution = useCallback((solutionId: string) => {
    setSelectedDataverseSolutionIds((prev) => (
      prev.includes(solutionId)
        ? prev.filter((id) => id !== solutionId)
        : [...prev, solutionId]
    ));
  }, []);

  const handleClearSelectedDataverseSolutions = useCallback(() => {
    setSelectedDataverseSolutionIds([]);
  }, []);

  const handleToggleErdMode = useCallback(() => {
    const nextMode: ErdMode = erdMode === 'detailed-relationships' ? 'compact' : 'detailed-relationships';

    const nextPreferences: GenerationPreferences = {
      ...generationPreferences,
      erdMode: nextMode,
    };

    setResults((prev) => rebuildResults(prev, nextPreferences, documentContext));

    setErdMode(nextMode);
    setStatusMsg(`ERD mode switched to ${nextMode === 'compact' ? 'Compact' : 'Detailed-Relationships'}.`);
  }, [erdMode, documentContext, generationPreferences]);

  const handleToggleIncludeDiagrams = useCallback(() => {
    const nextIncludeDiagrams = !includeDiagrams;
    const nextPreferences: GenerationPreferences = {
      ...generationPreferences,
      includeDiagrams: nextIncludeDiagrams,
    };

    setIncludeDiagrams(nextIncludeDiagrams);
    setResults((prev) => rebuildResults(prev, nextPreferences, documentContext));
    setStatusMsg(nextIncludeDiagrams
      ? 'Generate Diagrams enabled.'
      : 'Generate Diagrams disabled. Diagram sections will be excluded.');
  }, [includeDiagrams, generationPreferences, documentContext]);

  const handleToggleIncludeDefaultColumns = useCallback(() => {
    const nextIncludeDefaultColumns = !includeDefaultColumns;
    const nextPreferences: GenerationPreferences = {
      ...generationPreferences,
      includeDefaultColumns: nextIncludeDefaultColumns,
    };

    setIncludeDefaultColumns(nextIncludeDefaultColumns);
    setResults((prev) => rebuildResults(prev, nextPreferences, documentContext));
    setStatusMsg(nextIncludeDefaultColumns
      ? 'Include Default Columns enabled.'
      : 'Include Default Columns disabled. Default/system columns will be excluded.');
  }, [includeDefaultColumns, generationPreferences, documentContext]);

  const handleGenerateLocalQueuedSolutions = useCallback(() => {
    if (isProcessing || queuedLocalFiles.length === 0) return;
    const filesToGenerate = sortFilesByName(queuedLocalFiles);
    setQueuedLocalFiles([]);
    setDropZoneResetToken((prev) => prev + 1);
    void handleFilesSelected(filesToGenerate);
  }, [isProcessing, queuedLocalFiles, handleFilesSelected]);

  /**
   * Handles sidebar document selection with optional loading feedback for
   * large markdown payloads.
   */
  const handleSelectResult = useCallback((index: number) => {
    const next = results[index];
    if (!next) return;

    if (!isLargeOrComplexMarkdown(next.markdown)) {
      setActiveIdx(index);
      setIsViewerLoading(false);
      return;
    }

    setIsViewerLoading(true);

    // Yield one frame so the loading indicator can paint before heavy render work.
    window.setTimeout(() => {
      setActiveIdx(index);
      window.setTimeout(() => {
        setIsViewerLoading(false);
      }, 300);
    }, 50);
  }, [results]);

  // ── Export ────────────────────────────────────────────────────────────────

  /**
   * Exports the active solution's Markdown as a downloadable .md file.
   */
  const handleExport = useCallback(async () => {
    const result = results[activeIdx];
    if (!result) return;
    const safeName = toSafeMarkdownBaseName(
      result.solution.metadata.displayName || result.solution.metadata.uniqueName,
      'solution',
    );
    try {
      await exportMarkdown(result.markdown, `${safeName}-documentation`);
      await showNotification('Export Successful', 'Markdown document exported successfully.', 'success', 3000);
    } catch (error) {
      console.error('Export failed:', error);
      await showNotification('Export Failed', 'Failed to export markdown document.', 'error', 3000);
    }
  }, [results, activeIdx]);

  /**
   * Exports the active solution's standalone dependency report.
   */
  const handleExportDependencyReport = useCallback(async () => {
    const result = results[activeIdx];
    if (!result) return;

    const reportMarkdown = generateDependencyReportMarkdown(result.solution, { documentContext });
    const safeName = toSafeMarkdownBaseName(
      result.solution.metadata.displayName || result.solution.metadata.uniqueName,
      'solution',
    );

    try {
      await exportMarkdown(reportMarkdown, `${safeName}-dependency-report`);
      await showNotification('Export Successful', 'Dependency report exported successfully.', 'success', 3000);
    } catch (error) {
      console.error('Dependency export failed:', error);
      await showNotification('Export Failed', 'Failed to export dependency report.', 'error', 3000);
    }
  }, [results, activeIdx, documentContext]);

  /**
   * Exports all generated Markdown documents as a single ZIP archive.
   */
  const handleExportAll = useCallback(async () => {
    if (results.length === 0) return;

    try {
      const zip = new JSZip();
      results.forEach((result, idx) => {
        const fallback = result.isConsolidated ? 'consolidated' : `solution_${idx + 1}`;
        const safeName = toSafeMarkdownBaseName(
          result.solution.metadata.displayName || result.solution.metadata.uniqueName,
          fallback,
        );
        const suffix = result.isConsolidated ? '-summary.md' : '-documentation.md';
        zip.file(`${safeName}${suffix}`, result.markdown);

        if (includeDependencyReport && !result.isConsolidated) {
          const reportMarkdown = generateDependencyReportMarkdown(result.solution, { documentContext });
          zip.file(`${safeName}-dependency-report.md`, reportMarkdown);
        }
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      await exportZip(blob, 'pp-md-pptb-edition-markdown-documents');
      await showNotification(
        'Export Successful',
        includeDependencyReport
          ? 'All markdown documents and dependency reports exported as ZIP.'
          : 'All markdown documents exported as ZIP.',
        'success',
        3000,
      );
    } catch (error) {
      console.error('Export all failed:', error);
      await showNotification('Export Failed', 'Failed to export markdown documents as ZIP.', 'error', 3000);
    }
  }, [results, includeDependencyReport, documentContext]);

  // ── Reset ─────────────────────────────────────────────────────────────────

  /**
   * Clears all results and returns to the welcome/drop zone screen.
   */
  const handleReset = useCallback(() => {
    setResults([]);
    setActiveIdx(0);
    setProcessing([]);
    setQueuedLocalFiles([]);
    setDropZoneResetToken((prev) => prev + 1);
    setStatusMsg('');
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────

  const hasResults     = results.length > 0;
  const canGenerateLocal = launchMode === 'local' && queuedLocalFiles.length > 0 && !isProcessing;
  const canGenerateDataverse = launchMode === 'dataverse' && selectedDataverseSolutionIds.length > 0 && busySolutionIds.length === 0 && !isProcessing;
  const combinedResultIndex = results.findIndex((entry) => entry.isConsolidated);
  const activeResult   = results[activeIdx];
  const isWelcome      = launchMode === 'local' && !hasResults && !isProcessing;
  const shouldShowModeSelection = launchMode === null && !hasResults && !isProcessing;
  const shouldShowDataverseBrowser = launchMode === 'dataverse' && !hasResults && !isProcessing;
  const publisherOptions = Array.from(new Set(
    dataverseSolutions
      .map((solution) => solution.publisherName?.trim())
      .filter((name): name is string => Boolean(name)),
  )).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

  const filteredDataverseSolutions = dataverseSolutions
    .filter((solution) => {
      if (dataverseManagedFilter === 'managed' && !solution.isManaged) return false;
      if (dataverseManagedFilter === 'unmanaged' && solution.isManaged) return false;
      if (selectedPublishers.length > 0) {
        const publisherName = solution.publisherName?.trim() || '';
        if (!selectedPublishers.includes(publisherName)) return false;
      }

      const search = dataverseSearch.trim().toLowerCase();
      if (!search) return true;
      return solution.displayName.toLowerCase().includes(search)
        || solution.uniqueName.toLowerCase().includes(search)
        || solution.version.toLowerCase().includes(search)
        || (solution.publisherName?.toLowerCase().includes(search) ?? false);
    })
    .sort((left, right) => {
      switch (dataverseSort) {
        case 'name-desc':
          return right.displayName.localeCompare(left.displayName, undefined, { sensitivity: 'base' });
        case 'version-asc':
          return left.version.localeCompare(right.version, undefined, { sensitivity: 'base', numeric: true });
        case 'version-desc':
          return right.version.localeCompare(left.version, undefined, { sensitivity: 'base', numeric: true });
        case 'name-asc':
        default:
          return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
      }
    });

  const handleSelectAllVisibleDataverseSolutions = useCallback(() => {
    setSelectedDataverseSolutionIds(filteredDataverseSolutions.map((solution) => solution.solutionId));
  }, [filteredDataverseSolutions]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className={styles.appRoot}>
      {/*
       * Skip to main content link — MUST be the first focusable element
       * (WCAG 2.4.1 Bypass Blocks).
       */}
      <a href="#main-content" className={styles.skipLink}>
        Skip to main content
      </a>

      {/* ── Global header ─────────────────────────────────────────────── */}
      <header className={styles.header} role="banner">
        <div className={styles.headerInner}>
          <div className={styles.headerLeft}>
            <div className={styles.brand}>
              <img src={appIcon} className={styles.brandIcon} alt="" aria-hidden="true" />
              <div className={styles.brandCopy}>
                <h1 className={styles.brandName}>PP-MD - PPTB Edition</h1>
                <span className={styles.brandTagline}>Power Platform Documentation Generator</span>
              </div>
            </div>
          </div>

          <div className={styles.headerCenter}>
            <span className={styles.connectionText}>
              {pptbLoading
                ? 'Connecting to ToolBox...'
                : (isInPPTB
                  ? `Connected to: ${connection?.name ?? 'No active connection'}`
                  : 'Running outside ToolBox (local dev mode)')}
            </span>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.headerActions}>
            {hasResults && !isProcessing && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={handleToggleErdMode}
                aria-label="Toggle ERD detail level"
              >
                {erdMode === 'compact' ? 'ERD: Compact' : 'ERD: Detailed'}
              </button>
            )}

            {hasResults && !isProcessing && (
              <button
                type="button"
                className={`${styles.headerBtn} ${includeDependencyReport ? styles.headerBtnActive : ''}`}
                onClick={() => {
                  const next = !includeDependencyReport;
                  setIncludeDependencyReport(next);
                  setStatusMsg(next
                    ? 'Standalone dependency report export enabled.'
                    : 'Standalone dependency report export disabled.');
                }}
                aria-label="Toggle standalone dependency report export"
              >
                {includeDependencyReport ? 'Dependency Report: On' : 'Dependency Report: Off'}
              </button>
            )}

            {hasResults && !isProcessing && includeDependencyReport && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={handleExportDependencyReport}
                aria-label="Download standalone dependency report"
              >
                ⬇ Dependency .md
              </button>
            )}

            {hasResults && !isProcessing && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={handleExportAll}
                aria-label="Download all generated Markdown files"
              >
                {includeDependencyReport ? '⬇ All + Dependencies' : '⬇ All .md'}
              </button>
            )}

            {hasResults && !isProcessing && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={handleReset}
                aria-label="Clear all results and add new files"
              >
                ＋ New
              </button>
            )}
            {launchMode && (
              <button
                type="button"
                className={styles.headerBtn}
                onClick={handleReturnToModeSelection}
                aria-label="Return to mode selection"
              >
                Change Mode
              </button>
            )}
            </div>
          </div>
        </div>
      </header>

      {/*
       * Status message region — announced to screen readers via aria-live.
       * Visually hidden when empty.
       */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className={styles.statusRegion}
        role="status"
      >
        {statusMsg}
      </div>

      {/* ── Main content area ─────────────────────────────────────────── */}
      <div className={styles.body}>
        {/* Sidebar (only when we have results) */}
        {hasResults && (
          <SolutionSidebar
            solutions={results.map((r) => r.solution)}
            activeIndex={activeIdx}
            combinedIndex={combinedResultIndex}
            onSelect={handleSelectResult}
            onReset={handleReset}
          />
        )}

        {/* Main content */}
        <main id="main-content" className={styles.main} tabIndex={-1}>

          {/* Launch mode / local / connected screens */}
          {(shouldShowModeSelection || isWelcome || shouldShowDataverseBrowser) && (
            <section
              className={styles.welcomeSection}
              aria-labelledby="welcome-heading"
            >
              {shouldShowModeSelection ? (
                <>
                  <h2 id="welcome-heading" className={styles.welcomeHeading}>
                    Choose how you want to document your solution
                  </h2>
                  <p className={styles.welcomeSubtitle}>
                    Start with local ZIP files or connect to Dataverse and read solution metadata directly from the active environment.
                  </p>

                  <div className={styles.modeGrid}>
                    <button type="button" className={styles.modeCard} onClick={() => handleSelectLaunchMode('local')}>
                      <span className={styles.modeCardTitle}>Local Solutions</span>
                      <span className={styles.modeCardBody}>
                        Upload one or more exported solution ZIP files. No active Dataverse connection is required.
                      </span>
                    </button>

                    <button type="button" className={styles.modeCard} onClick={() => handleSelectLaunchMode('dataverse')}>
                      <span className={styles.modeCardTitle}>Dataverse Connected</span>
                      <span className={styles.modeCardBody}>
                        Browse solutions from the currently active Power Platform ToolBox environment and generate documentation directly from Dataverse metadata.
                      </span>
                    </button>
                  </div>

                  <section className={styles.modeBranding} aria-label="Product details and links">
                    <img src={appIcon} className={styles.modeBrandIcon} alt="PP-MD logo" />
                    <p className={styles.modeBrandTitle}>Power Platform Markdown Document Generator</p>
                    <p className={styles.modeBrandByline}>by Mike Hartley / Hart of the Midlands</p>
                    <div className={styles.modeBrandLinks}>
                      <a
                        href={WEBSITE_URL}
                        target="_blank"
                        rel="noreferrer"
                        onMouseDown={handleExternalLinkMouseDown}
                        onClick={handleExternalLinkClick}
                      >
                        HartOfTheMidlands.co.uk
                      </a>
                      <a
                        href={GITHUB_REPO_URL}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.iconLink}
                        onMouseDown={handleExternalLinkMouseDown}
                        onClick={handleExternalLinkClick}
                      >
                        <img src={githubMark} className={styles.linkIcon} alt="" aria-hidden="true" />
                        <span>GitHub Repo</span>
                      </a>
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <h2 id="welcome-heading" className={styles.welcomeHeading}>
                    {launchMode === 'local'
                      ? 'Generate documentation from your solution files'
                      : 'Generate documentation from the active Dataverse environment'}
                  </h2>
                  <p className={styles.welcomeSubtitle}>
                    {launchMode === 'local'
                      ? 'Drop one or more Power Platform solution ZIP archives below. PP-MD - PPTB Edition will parse every component and produce comprehensive Markdown documentation — including architecture and ERD Mermaid diagrams.'
                      : 'Choose a solution from the active environment. PP-MD - PPTB Edition reads metadata through Power Platform ToolBox and generates Markdown documentation without exporting or uploading the solution.'}
                  </p>

                  <section className={styles.contextPanel} aria-labelledby="context-heading">
                    <h3 id="context-heading" className={styles.contextHeading}>Document Header Details</h3>

                    <div className={styles.contextRow}>
                      <label htmlFor="config-select" className={styles.contextLabel}>Configuration</label>
                      <div className={styles.contextSelectRow}>
                        <select
                          id="config-select"
                          className={styles.contextSelect}
                          value={selectedConfigId}
                          onChange={handleConfigurationSelect}
                          aria-label="Select document configuration"
                        >
                          <option value="custom">Custom (manual entry)</option>
                          {configurations.map((config) => (
                            <option key={config.id} value={config.id}>{config.name}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className={styles.contextDeleteBtn}
                          onClick={() => handleDeleteConfiguration(selectedConfigId)}
                          disabled={selectedConfigId === 'custom'}
                          aria-label="Delete selected configuration"
                          title="Delete selected configuration"
                        >
                          🗑
                        </button>
                      </div>
                    </div>

                    <div className={styles.contextSaveRow}>
                      <input
                        type="text"
                        className={styles.contextNameInput}
                        placeholder="Configuration name"
                        value={newConfigName}
                        onChange={(e) => setNewConfigName(e.target.value)}
                        aria-label="Configuration name"
                      />
                      <button
                        type="button"
                        className={styles.contextSaveBtn}
                        onClick={handleSaveConfiguration}
                      >
                        Save Configuration
                      </button>
                    </div>

                    {configLoadError && (
                      <p className={styles.contextWarning} role="alert">⚠ {configLoadError}</p>
                    )}

                    <div className={styles.contextGrid}>
                      <label className={styles.contextField}>
                        <span>Client</span>
                        <input
                          type="text"
                          value={documentContext.client}
                          onChange={(e) => handleContextChange('client', e.target.value)}
                        />
                      </label>
                      <label className={styles.contextField}>
                        <span>Contract</span>
                        <input
                          type="text"
                          value={documentContext.contract}
                          onChange={(e) => handleContextChange('contract', e.target.value)}
                        />
                      </label>
                      <label className={styles.contextField}>
                        <span>Contract ID/SoW</span>
                        <input
                          type="text"
                          value={documentContext.sow}
                          onChange={(e) => handleContextChange('sow', e.target.value)}
                        />
                      </label>
                      <label className={styles.contextField}>
                        <span>Project</span>
                        <input
                          type="text"
                          value={documentContext.project}
                          onChange={(e) => handleContextChange('project', e.target.value)}
                        />
                      </label>
                      <label className={styles.contextField}>
                        <span>Sprint</span>
                        <input
                          type="text"
                          value={documentContext.sprint}
                          onChange={(e) => handleContextChange('sprint', e.target.value)}
                        />
                      </label>
                      <label className={styles.contextField}>
                        <span>Release Date</span>
                        <input
                          type="date"
                          value={documentContext.releaseDate}
                          onChange={(e) => handleContextChange('releaseDate', e.target.value)}
                        />
                      </label>
                    </div>
                  </section>

                  <section className={styles.generatePanel} aria-labelledby="generate-doc-heading">
                    <div className={styles.generatePanelHeader}>
                      <h3 id="generate-doc-heading" className={styles.generatePanelHeading}>Generate Documentation</h3>
                      <p className={styles.generatePanelSubtitle}>
                        Use one shared generation action for the selected mode and choose what to include in output.
                      </p>
                    </div>

                    <div className={styles.generatePanelActions}>
                      {launchMode === 'local' ? (
                        <button
                          type="button"
                          className={styles.generatePrimaryBtn}
                          onClick={handleGenerateLocalQueuedSolutions}
                          disabled={!canGenerateLocal}
                          aria-label={`Generate documentation for ${queuedLocalFiles.length} queued file${queuedLocalFiles.length === 1 ? '' : 's'}`}
                        >
                          Generate Documentation ({queuedLocalFiles.length})
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={styles.generatePrimaryBtn}
                          onClick={handleGenerateSelectedDataverseSolutions}
                          disabled={!canGenerateDataverse}
                          aria-label={`Generate documentation for ${selectedDataverseSolutionIds.length} selected Dataverse solution${selectedDataverseSolutionIds.length === 1 ? '' : 's'}`}
                        >
                          Generate Selected ({selectedDataverseSolutionIds.length})
                        </button>
                      )}

                      <label className={styles.generateToggle}>
                        <input
                          type="checkbox"
                          checked={includeDiagrams}
                          onChange={handleToggleIncludeDiagrams}
                        />
                        <span>Generate Diagrams</span>
                      </label>

                      <label className={styles.generateToggle}>
                        <input
                          type="checkbox"
                          checked={includeDefaultColumns}
                          onChange={handleToggleIncludeDefaultColumns}
                        />
                        <span>Include Default Columns</span>
                      </label>
                    </div>
                  </section>

                  {launchMode === 'local' ? (
                    <>
                      <div className={styles.dropZoneWrapper}>
                        <DropZone
                          onFilesSelected={handleFilesSelected}
                          disabled={isProcessing}
                          onQueueChange={setQueuedLocalFiles}
                          showGenerateButton={false}
                          resetToken={dropZoneResetToken}
                        />
                      </div>

                      <section
                        className={styles.featureGrid}
                        aria-labelledby="features-heading"
                      >
                        <h3 id="features-heading" className="sr-only">Supported components</h3>
                        {[
                          { icon: '🗃️', label: 'Tables & Columns' },
                          { icon: '📋', label: 'Forms & Views' },
                          { icon: '⚙️', label: 'Power Automate Flows' },
                          { icon: '🔄', label: 'Classic Workflows & BPFs' },
                          { icon: '🎨', label: 'Canvas & Model Apps' },
                          { icon: '🌐', label: 'Web Resources (JS/TS/HTML)' },
                          { icon: '🔒', label: 'Security Roles & CLS' },
                          { icon: '🔌', label: 'Plugins & Plugin Steps' },
                          { icon: '🔗', label: 'Connection References' },
                          { icon: '⚙️', label: 'Environment Variables' },
                          { icon: '📊', label: 'Reports & Dashboards' },
                          { icon: '📈', label: 'Mermaid Diagrams' },
                        ].map(({ icon, label }) => (
                          <div key={label} className={styles.featureCard}>
                            <span className={styles.featureIcon} aria-hidden="true">{icon}</span>
                            <span className={styles.featureLabel}>{label}</span>
                          </div>
                        ))}
                      </section>
                    </>
                  ) : (
                    <DataverseSolutionBrowser
                      solutions={filteredDataverseSolutions}
                      publisherOptions={publisherOptions}
                      selectedPublishers={selectedPublishers}
                      selectedSolutionIds={selectedDataverseSolutionIds}
                      search={dataverseSearch}
                      sort={dataverseSort}
                      managedFilter={dataverseManagedFilter}
                      isLoading={isDataverseLoading}
                      error={dataverseError}
                      busySolutionIds={busySolutionIds}
                      onSearchChange={setDataverseSearch}
                      onSortChange={setDataverseSort}
                      onManagedFilterChange={setDataverseManagedFilter}
                      onTogglePublisher={handleTogglePublisher}
                      onSelectAllPublishers={handleSelectAllPublishers}
                      onClearPublishers={handleClearPublishers}
                      onToggleSolution={handleToggleDataverseSolution}
                      onSelectAllVisibleSolutions={handleSelectAllVisibleDataverseSolutions}
                      onClearSelectedSolutions={handleClearSelectedDataverseSolutions}
                      onRefresh={() => { void loadDataverseSolutions(); }}
                    />
                  )}
                </>
              )}
            </section>
          )}

          {/* Processing state */}
          {isProcessing && (
            <section
              className={styles.processingSection}
              aria-labelledby="processing-heading"
              aria-busy="true"
            >
              <h2 id="processing-heading" className={styles.processingHeading}>
                Processing solutions…
              </h2>
              <div className={styles.progressList}>
                {processing.map((entry) => (
                  <div key={entry.fileName} className={styles.progressItem}>
                    {entry.error ? (
                      <div
                        role="alert"
                        className={styles.progressError}
                      >
                        <span aria-hidden="true">❌</span> {entry.fileName}: {entry.error}
                      </div>
                    ) : (
                      <ProgressBar
                        value={entry.progress}
                        label={entry.fileName}
                        showLabel
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* Show drop zone to allow additional files during processing */}
            </section>
          )}

          {/* Post-processing errors (when processing done but some failed) */}
          {!isProcessing && processing.some((e) => e.error) && (
            <div
              role="alert"
              className={styles.errorSummary}
            >
              {processing
                .filter((e) => e.error)
                .map((e) => (
                  <p key={e.fileName} className={styles.errorLine}>
                    ❌ <strong>{e.fileName}</strong>: {e.error}
                  </p>
                ))}
            </div>
          )}

          {/* Documentation viewer */}
          {hasResults && activeResult && !isProcessing && (
            <div className={styles.viewerWrapper}>
              {isViewerLoading ? (
                <div className={styles.viewerLoadingState} role="status" aria-live="polite" aria-busy="true">
                  <div className={styles.viewerLoadingCard}>
                    <span className={styles.viewerLoadingSpinner} aria-hidden="true" />
                    <p className={styles.viewerLoadingText}>Please Wait - rendering markdown document...</p>
                  </div>
                </div>
              ) : (
                <MarkdownViewer
                  markdown={activeResult.markdown}
                  title={activeResult.solution.metadata.displayName || activeResult.solution.metadata.uniqueName}
                  onExport={handleExport}
                />
              )}
            </div>
          )}

          {hasResults && !isProcessing && launchMode && (
            <section className={styles.generatePanel} aria-labelledby="generate-more-heading">
              <div className={styles.generatePanelHeader}>
                <h3 id="generate-more-heading" className={styles.generatePanelHeading}>Generate More Documentation</h3>
                <p className={styles.generatePanelSubtitle}>
                  Apply generation settings and create additional documents from your current mode.
                </p>
              </div>

              <div className={styles.generatePanelActions}>
                {launchMode === 'local' ? (
                  <button
                    type="button"
                    className={styles.generatePrimaryBtn}
                    onClick={handleGenerateLocalQueuedSolutions}
                    disabled={!canGenerateLocal}
                  >
                    Generate Documentation ({queuedLocalFiles.length})
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.generatePrimaryBtn}
                    onClick={handleGenerateSelectedDataverseSolutions}
                    disabled={!canGenerateDataverse}
                  >
                    Generate Selected ({selectedDataverseSolutionIds.length})
                  </button>
                )}

                <label className={styles.generateToggle}>
                  <input
                    type="checkbox"
                    checked={includeDiagrams}
                    onChange={handleToggleIncludeDiagrams}
                  />
                  <span>Generate Diagrams</span>
                </label>

                <label className={styles.generateToggle}>
                  <input
                    type="checkbox"
                    checked={includeDefaultColumns}
                    onChange={handleToggleIncludeDefaultColumns}
                  />
                  <span>Include Default Columns</span>
                </label>
              </div>
            </section>
          )}

          {/* Additional local file drop zone when results exist */}
          {hasResults && !isProcessing && launchMode === 'local' && (
            <details className={styles.addMoreDetails}>
              <summary className={styles.addMoreSummary}>
                ＋ Add more solution files
              </summary>
              <div className={styles.addMoreBody}>
                <DropZone
                  onFilesSelected={handleFilesSelected}
                  disabled={isProcessing}
                  onQueueChange={setQueuedLocalFiles}
                  showGenerateButton={false}
                  resetToken={dropZoneResetToken}
                />
              </div>
            </details>
          )}

          {/* Additional Dataverse browser when results exist */}
          {hasResults && !isProcessing && launchMode === 'dataverse' && (
            <details className={styles.addMoreDetails}>
              <summary className={styles.addMoreSummary}>
                ＋ Add more solutions from Dataverse
              </summary>
              <div className={styles.addMoreBody}>
                <DataverseSolutionBrowser
                  solutions={filteredDataverseSolutions}
                  publisherOptions={publisherOptions}
                  selectedPublishers={selectedPublishers}
                  selectedSolutionIds={selectedDataverseSolutionIds}
                  search={dataverseSearch}
                  sort={dataverseSort}
                  managedFilter={dataverseManagedFilter}
                  isLoading={isDataverseLoading}
                  error={dataverseError}
                  busySolutionIds={busySolutionIds}
                  onSearchChange={setDataverseSearch}
                  onSortChange={setDataverseSort}
                  onManagedFilterChange={setDataverseManagedFilter}
                  onTogglePublisher={handleTogglePublisher}
                  onSelectAllPublishers={handleSelectAllPublishers}
                  onClearPublishers={handleClearPublishers}
                  onToggleSolution={handleToggleDataverseSolution}
                  onSelectAllVisibleSolutions={handleSelectAllVisibleDataverseSolutions}
                  onClearSelectedSolutions={handleClearSelectedDataverseSolutions}
                  onRefresh={() => { void loadDataverseSolutions(); }}
                />
              </div>
            </details>
          )}
        </main>
      </div>

      {invalidArchiveMessage && (
        <div className={styles.modalBackdrop} role="presentation">
          <div
            className={styles.modalDialog}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="invalid-archive-title"
            aria-describedby="invalid-archive-body"
          >
            <h2 id="invalid-archive-title" className={styles.modalTitle}>Invalid ZIP Archive</h2>
            <p id="invalid-archive-body" className={styles.modalBody}>{invalidArchiveMessage}</p>
            <button
              ref={invalidArchiveOkRef}
              type="button"
              className={styles.modalOkBtn}
              onClick={() => setInvalidArchiveMessage(null)}
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className={styles.footer} role="contentinfo">
        <div className={styles.footerLeft}>
          <span>PP-MD - PPTB Edition: Power Platform Documentation Generator.</span>
          <span className={styles.footerVersion}>Version {displayVersion}</span>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className={styles.iconLink}
            onMouseDown={handleExternalLinkMouseDown}
            onClick={handleExternalLinkClick}
          >
            <img src={githubMark} className={styles.linkIcon} alt="" aria-hidden="true" />
            <span>GitHub Repo</span>
          </a>
        </div>
        <div className={styles.footerRight}>
          <span>
            {launchMode === 'dataverse'
              ? 'PP-MD - PPTB Edition reads solution metadata from the active Dataverse environment through Power Platform ToolBox. No information is uploaded to the environment and only solution data is retrieved in read-only mode.'
              : 'All local ZIP processing happens on your PC; your solution data never leaves your machine.'}
          </span>
        </div>
      </footer>
    </div>
  );
}
