# PP-MD - PPTB Edition File Catalogue

## Purpose and Scope

This catalogue describes the current application source, documentation, and build-support files. Generated files and installed dependencies are intentionally excluded.

- Included: `src/`, `scripts/`, `.github/workflows/`, root configuration, and documentation.
- Excluded: `node_modules/`, `dist/`, and generated solution/export artefacts.

## Project Entry and Configuration

| Path | Responsibility |
|---|---|
| `index.html` | Web entry document, content security policy, and React mount point. |
| `package.json` | PPTB manifest metadata, package inclusion, dependencies, and npm scripts. |
| `package-lock.json` | Locked npm dependency tree. |
| `tsconfig.json` | TypeScript compiler configuration. |
| `vite.config.ts` | Vite development and production-build configuration. |
| `eslint.config.js` | ESLint configuration. |
| `.gitattributes`, `.gitignore`, `.npmignore` | Git line-ending and ignore rules, and npm package exclusions. |
| `LICENSE` | MIT licence text. |
| `public/doc-configurations.json` | Default document configuration data available to the web application. |
| `public/favicon.svg`, `public/icons.svg` | Browser favicon and shared SVG icon resource. |
| `public/pp-md.svg`, `public/pp-md.png`, `public/icons/pp-md.svg`, `public/icons/pp-md.png` | Tool and in-app icon assets copied into the distribution. |

The current manifest uses `index.html` as the entry point and packages `dist`, `LICENSE`, and `README.md`. It does not define an Electron runtime or Electron packaging target.

## Application Source

### App and host integration

| Path | Responsibility |
|---|---|
| `src/main.tsx` | React entry point; mounts the application and theme provider. |
| `src/App.tsx` | Launch modes, solution processing, configuration, result navigation, consolidated output, and export orchestration. |
| `src/api/toolboxAPI.ts` | Typed wrappers around the PPTB host APIs, with browser-development fallbacks where available. |
| `src/api/fileManager.ts` | Markdown, HTML, PDF, Excel, and ZIP export adapters. |
| `src/hooks/useToolboxAPI.ts` | Active-connection initialisation and host connection state. |
| `src/context/ThemeContext.tsx` | Theme synchronisation with PPTB or the local browser's OS preference. |

### Collection, model, and generation

| Path | Responsibility |
|---|---|
| `src/parser/solutionParser.ts` | Reads solution ZIP/XML content and builds the normalised model. |
| `src/dataverse/solutionService.ts` | Orchestrates solution listing and scoped Dataverse collection; re-exports shared helpers. |
| `src/dataverse/dataverseClient.ts` | Shared query helpers, value coercion, and ambient cancellation (`withDataverseAbortSignal`). |
| `src/dataverse/entityCollector.ts` | Selected-table metadata collection. |
| `src/dataverse/componentCollectors.ts` | Solution component artefact collectors. |
| `src/dataverse/dependencyCollector.ts` | Component dependency and missing-dependency collection. |
| `src/dataverse/environmentCollector.ts` | Environment Appendix collection (Dataverse and optional Power Platform API). |
| `src/dataverse/componentTypes.ts` | Shared public solution-component type labels; extended types use connected metadata. |
| `src/types/solution.ts` | Parsed solution and artefact type definitions. |
| `src/generator/markdownGenerator.ts` | Single/consolidated Markdown generation, section output, and diagrams; re-exports consolidation and splitting helpers. |
| `src/generator/markdownFormatting.ts` | Shared Markdown escaping, heading, anchor, and sorting helpers. |
| `src/generator/solutionConsolidator.ts` | Multi-solution merge and peer gap-fill logic. |
| `src/generator/documentSplitter.ts` | Category splitting, diagram extraction, and Back to Top links. |
| `src/generator/diagnosticsGenerator.ts` | Standalone parse warnings, collection errors, and issues; excluded from solution documentation. |
| `src/generator/diagnosticsGenerator.test.ts` | Diagnostic separation, deduplication, and safe output regression tests. |
| `src/generator/sections/environmentAppendixSection.ts` | Environment Appendix Markdown rendering. |
| `src/utils/lruCache.ts` | Bounded least-recently-used cache used for Mermaid SVG output. |
| `src/utils/environmentAppendix.ts` | Shared alphabetical appendix ordering and available/unavailable count formatting. |
| `src/utils/ukEnglish.ts` | UK English display labels and readable API parameter names; technical identifiers and source values remain unchanged. |
| `src/generator/missingDependencies.ts` | Normalises installation/import dependency data. |
| `src/generator/tableMetadata.ts` | Table metadata helpers shared by output paths. |

### Rendering and export

| Path | Responsibility |
|---|---|
| `src/api/documentRendering.tsx` | Markdown sanitisation/rendering, standalone HTML, and diagram rasterisation helpers. |
| `src/api/pdfExporter.ts` | Searchable text-based PDF generation from Markdown. |
| `src/api/excelExporter.ts` | Styled workbook generation from normalised solution data. |

### UI components and assets

| Path | Responsibility |
|---|---|
| `src/components/SolutionSidebar.tsx`, `SolutionSidebar.module.css` | Solution, consolidated-document, and companion-document navigation. |
| `src/components/ui/DataverseSolutionBrowser.tsx`, `.module.css` | Connected solution search, filtering, selection, and refresh. |
| `src/components/ui/DropZone.tsx`, `.module.css` | ZIP-file selection and drag/drop queue. |
| `src/components/ui/MarkdownViewer.tsx`, `.module.css` | Markdown display, search, navigation, copy, import, and export controls. |
| `src/components/ui/MermaidDiagram.tsx` | Diagram rendering and accessible source/failure fallback. |
| `src/components/ui/ProgressBar.tsx`, `.module.css` | Processing progress presentation. |
| `src/components/ui/ThemeToggle.tsx`, `.module.css` | Browser-development theme toggle. |
| `src/components/ui/UpdateChecker.tsx`, `.module.css` | Optional GitHub release update check. |
| `src/App.module.css`, `src/assets/global.css` | Application layout and shared styles/theme tokens. |
| `src/assets/app-icon.svg`, `github-mark.svg`, `pp-md-icon.svg`, `hero.png`, `typescript.svg`, `vite.svg` | Application, service, and starter-template visual assets. |
| `src/vite-env.d.ts` | Vite and asset-import type declarations. |

### Tests

Focused unit tests are colocated with tested modules. Current test coverage includes the parser, connected collector, generator, dependency reporting, PDF and Excel exporters, viewer helpers, host API adapters, and update-check behaviour.

## Build and Validation Scripts

| Path | Responsibility |
|---|---|
| `scripts/normalize-dist-assets.mjs` | Normalises build output for the PPTB distribution. |
| `scripts/validate-dist.cjs` | Checks key built distribution assets. |
| `scripts/validate-offline.cjs` | Runs deterministic manifest/package validation without network URL checks. |
| `scripts/check-contrast.mjs` | Audits theme-token contrast. |
| `scripts/sample-doc-from-zip.ts`, `scripts/smoke-doc.ts` | Developer utilities for sample generation and synthetic smoke checks. |
| `scripts/build-latest.ps1`, `scripts/electron-builder-after-pack.cjs`, `scripts/stamp-exe.mjs` | Legacy Windows/Electron release utilities; not invoked by the current npm `build` or `test` scripts. |
| `.github/workflows/validate.yml`, `.github/workflows/release.yml` | GitHub Actions validation and release workflows. |

The standard checks are defined in `package.json`. See [the codebase guide](codebase-guide.md#validation-workflow) for the current workflow.

## Documentation

| Path | Responsibility |
|---|---|
| `README.md` | User guide, feature overview, development, and support information. |
| `CHANGELOG.md` | Release notes for documented versions. |
| `CONTRIBUTING.md` | Contributor workflow and validation guidance. |
| `SECURITY.md` | Security reporting guidance and security-related behaviour. |
| `docs/high-level-design.md` | Current runtime architecture and system boundaries. |
| `docs/low-level-design.md` | Module responsibilities and implementation behaviour. |
| `docs/codebase-guide.md` | Developer orientation and operational workflow. |
| `docs/research/` | Dataverse retrieval and PPTB platform references, plus the solution component type map. |

## Key Functions

| Module | Function | Responsibility |
|---|---|---|
| `src/parser/solutionParser.ts` | `parseSolutionZip` | Parse an exported solution archive into the normalised solution model. |
| `src/dataverse/solutionService.ts` | `listDataverseSolutions`, `buildParsedSolutionFromDataverse` | Find solutions and build normalised data from the active connection. |
| `src/generator/markdownGenerator.ts` | `generateMarkdown`, `generateConsolidatedMarkdown`, `consolidateSolutions` | Create individual or consolidated documentation from model data. |
| `src/generator/missingDependencies.ts` | Dependency-report helpers | Build optional import-prerequisite information and output. |
| `src/App.tsx` | `buildConsolidatedResult` | Prepare the consolidated result for display and export. |
| `src/api/pdfExporter.ts` | `createRenderedDocumentationPdf` | Create a PDF from Markdown content. |
| `src/api/excelExporter.ts` | `createSolutionWorkbook` | Create a styled Excel workbook from solution data. |
