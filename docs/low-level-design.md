# PP-MD - PPTB Edition Low-Level Design

## Purpose
This document details module internals, key functions, data contracts, and implementation-level behaviour.

## Source Layout
- Power Platform ToolBox: host runtime, injected APIs, connection services, and user-mediated file saving
- src/App.tsx: UI orchestration and application state machine
- src/parser/solutionParser.ts: Solution ZIP and XML parsing pipeline
- src/dataverse/solutionService.ts: connected solution discovery and metadata collection
- src/dataverse/componentTypes.ts: shared, corrected solution-component labels for collection, ZIP inventory, and dependencies
- src/generator/markdownGenerator.ts: Markdown composition and diagram generation
- src/types/solution.ts: Canonical domain model contracts
- src/api/*: host/browser adapters, HTML/PDF/Excel export, and document rendering
- src/components/ui/*: Reusable UI widgets
- src/context/ThemeContext.tsx: Theme state and persistence

The shipped application is a Vite-built web tool whose manifest entry point is `index.html`. It runs in the PPTB host and can also run in a browser for local development. There is no Electron main process in the current source tree.

## Module Details

### Power Platform ToolBox Host

Responsibilities:
- expose the host APIs used by the tool, including `toolboxAPI` and `dataverseAPI`
- provide active connections, settings, notifications, themes, and user-mediated file export
- keep authentication and tokens outside the tool code

The repository's connected collector does not directly construct authenticated requests. The `powerplatformAPI` environment-management capability is used only by the Environment Appendix collector, only when `connection.enabledForPowerPlatformAPI` is true; otherwise the appendix records an availability note and continues with Dataverse-only data.

### Collection Cancellation and Caching

- Each processing run owns an `AbortController`. ZIP parsing checks the signal at each progress checkpoint; Dataverse collection uses `withDataverseAbortSignal`, and every query helper in `src/dataverse/dataverseClient.ts` checks it before issuing a request. Collectors that downgrade errors to warnings rethrow cancellation errors so that a cancelled run produces no partial document.
- Plug-in steps and step images are fetched in batched FetchXML queries grouped by assembly rather than one query per assembly.
- Mermaid SVG output is held in a bounded `LruCache` (`src/utils/lruCache.ts`, 100 entries).

### Environment Appendix

- Selected with the `environmentAppendix` collection policy. After all selected solutions are collected, `collectEnvironmentAppendix` (`src/dataverse/environmentCollector.ts`) gathers environment identity, organisation settings, optional Power Platform settings, languages, currencies, aggregate inventory counts, installed solutions, application packages, publishers, and business units.
- The appendix is attached to the result rather than to individual `ParsedSolution` documents. The consolidated All Selected Solutions document is always created under this policy, and only it renders the appendix (`src/generator/sections/environmentAppendixSection.ts`) and the Excel **Environment** worksheet.
- Optional queries degrade to collection notes; counts that cannot be retrieved are shown as Unavailable.
- `src/utils/environmentAppendix.ts` applies shared, non-mutating alphabetical ordering within all groupings for collection, Markdown and Excel. Display labels use UK English; technical identifiers and source values remain exact. Dates and numeric display use `en-GB`.
- Human-user counts require an enabled account with an Entra object ID, no application ID, and either an existing direct role (`systemuserroles`) or a non-default team (`teammembership` joined to `team.isdefault = false`). FetchXML `any` filters implement the OR without multiplying users by role/team memberships. Application users use a separate count. Tenant-wide users are explicitly unavailable without a directory API.
- People totals use validated `countcolumn`/`distinct` aggregates. Component inventories page only primary keys and namespace fields, de-duplicate IDs, and classify namespaces against retrieved publishers. A failed namespace read can retain a separately validated aggregate total, but never invent a custom count. Input-limit errors do not imply a numerical lower bound.
- Publisher classification recognises unique names beginning with `Microsoft`, `msdyn`, `DefaultPublisher` or `CDSDefaultPublisher`, plus the recognised `msdyn`, `msdynce`, `mscrm`, `mspp`, `adx` and default `new` namespaces. Other `ms` prefixes without a recognised publisher remain unknown. A unique non-default publisher namespace can establish a custom item; missing/conflicting provenance stays unclassified. Solution membership and `isreadonly` are not proof of publisher origin.
- Failed solution, publisher or business-unit reads remain distinguishable from successful empty lists when deriving counts. Metadata next links are rejected as partial inventories rather than reported as complete totals.

### Application Orchestration
File: src/App.tsx

Primary state:
- results: successful solution parsing and markdown outputs
- diagramsMarkdown: optional companion output for the consolidated All Selected Solutions document
- activeIdx: currently selected documentation tab
- processing: per-file progress state
- isProcessing/statusMsg: runtime status and announcements
- documentContext/configurations: metadata context and reusable presets
- erdMode and viewer loading flags

Key internal functions:
- readSavedConfigurations and writeSavedConfigurations
  - use namespaced ToolBox settings in PPTB and localStorage as a local-development fallback
- buildConsolidatedResult
  - merges all loaded ParsedSolution objects, preserves document context and navigation, and optionally separates diagrams
- extractDiagramsDocument
  - creates a standalone diagrams-only Markdown document with its own table of contents and section links
- isLargeOrComplexMarkdown
  - computes heuristic for loading feedback on heavy markdown payloads
- file processing callbacks
  - validate, parse, generate markdown, and update UI state transitions

State machine summary:
- Idle -> FilesQueued -> Processing -> ResultsAvailable -> Export/Reset

### Parsing Pipeline
File: src/parser/solutionParser.ts

Entry point:
- parseSolutionZip(input, options)

Core parser stages:
1. open ZIP with JSZip
2. parse solution.xml for metadata
3. parse `customizations.xml` for entities and component inventories
4. parse additional folders/files (workflows, apps, plugins, reports)
5. assemble ParsedSolution with warnings and progress updates

Important helpers:
- xmlStr
  - robust value extraction across text nodes, mixed object shapes, and attributes
- getLocalizedLabel
  - resolves display labels from direct tags and localised containers
- parsePermissionFlag and parseBooleanLike
  - normalises non-uniform XML boolean/permission representations
- getEntriesWithPrefix and readZipEntry
  - resilient ZIP entry resolution and traversal

Notable defensive behaviour:
- case-insensitive tag access patterns
- mixed attribute/tag fallback chains for legacy and variant exports
- explicit parser hardening settings (entity processing disabled)

### Markdown Generation Pipeline
File: src/generator/markdownGenerator.ts

Public API:
- consolidateSolutions(solutions)
- generateMarkdown(solution, options)
- generateConsolidatedMarkdown(solutions, options)

Generation stages:
1. preprocess lookup maps (entity and attribute display names)
2. emit document header and table of contents
3. emit section generators in deterministic order
4. append back-to-top anchors and return markdown string

Representative section generators:
- entities/tables and columns
- option sets
- forms and views
- processes and automation
- apps
- web resources
- security roles and field security profiles
- integration objects (connection references, env vars)
- reports/dashboards and plugin assemblies

Key helpers:
- labelWithSchema
  - combines display and logical/schema labels consistently
- buildEntityDisplayMap and buildAttributeDisplayMap
  - lookup maps used across sections for user-friendly labels
- resolveAttributeDisplayName
  - resilient lookup for CLS attribute names with qualified-path normalisation
- parseRolePrivilege
  - decomposes privilege names into operation and table logical name

### Markdown Rendering
File: src/components/ui/MarkdownViewer.tsx

Responsibilities:
- render markdown with GitHub Flavored Markdown support
- inject heading IDs for table-of-contents linking
- intercept mermaid code fences and render MermaidDiagram component
- provide raw markdown toggle, copy, and export actions

Critical methods:
- extractText and headingId
  - deterministic heading anchor generation
- handleCopy
  - clipboard write and status feedback
- code renderer override
  - route language-mermaid blocks to diagram renderer

### Diagram Renderer
File: src/components/ui/MermaidDiagram.tsx

Responsibilities:
- lazily import Mermaid and render SVG asynchronously
- enforce accessible SVG attributes and fallback source disclosure
- support zoom, fit-to-width, and fullscreen interactions

Implementation details:
- useId-based unique diagram IDs to avoid collisions
- strict Mermaid security mode
- runtime font-size normalisation for readability

### Theme Management
File: src/context/ThemeContext.tsx

Responsibilities:
- initialise from the OS preference, then use the ToolBox theme while running inside PPTB
- apply active theme to html[data-theme]
- sync browser theme-colour metadata
- expose toggleTheme and setTheme API to consumers

Theme selection is host-controlled inside PPTB. The light/dark toggle is available in browser development, where the OS preference is observed.

## Data Contracts
File: src/types/solution.ts

Core models:
- ParsedSolution: root aggregate for all parsed components
- SolutionMetadata: identity/version/publisher metadata
- EntityDefinition and EntityAttribute: table and column schema
- ProcessDefinition and ProcessStep: workflow/process structures
- SecurityRoleDefinition and FieldSecurityProfileDefinition
- ConnectionReferenceDefinition and EnvironmentVariableDefinition
- PluginAssemblyDefinition and PluginStepDefinition
- AgentDefinition, AIModelDefinition, DesktopFlowDefinition, DataflowDefinition, CustomAPIDefinition, and OfflineProfileDefinition

Design intent:
- strict typing for parser-generator contract stability
- explicit enums for categories/types where possible
- optional fields used for partial availability across source variants

## Error Handling Strategy
- Parser warnings collected for non-fatal parse gaps.
- Component-level try/catch around variable XML structures.
- UI status messaging for processing and validation errors.
- Host notifications and accessible in-app status messages for user-visible failures.

## Performance Considerations
- Per-file progress callbacks to avoid opaque long-running operations.
- Heuristic loading state for large markdown rendering workloads.
- Mermaid is dynamically imported in source, while the production Vite configuration inlines dynamic imports into the served entry asset for PPTB packaging.
- Connected mode reads metadata only for selected solution components; it does not append environment-wide table metadata.
- Global choices are retrieved by metadata ID without data-record paging options; normal and Boolean option sets are supported.
- Site maps and image configurations have explicit record descriptors. Extended component record types resolve through `EntityDefinitions.ObjectTypeCode`, with configuration fields selected from readable, non-secured metadata rather than an all-attributes query. Each record query is restricted to the selected component IDs, matching the primary ID and the exact `<primary id>unique` solution-layer ID when present. Site maps not returned by the published query are retried with `RetrieveUnpublishedMultiple` (the only table here documented as supporting it) and labelled as unpublished; a failure of that retry is included in the warning.
- Separately packaged columns retain their metadata IDs and are documented on standard tables, including parent-table metadata lookup when the parent table is not a selected component.
- Environment-variable lookup IDs accept Web API `_environmentvariabledefinitionid_value` and SDK lookup shapes, normalised for braces and case. The current-value query filters `value` to non-null without selecting it. Presence is tri-state: Yes, No, or Unknown on collection failure.
- Connected role privilege and connection-reference enrichment uses direct OData queries scoped to selected role and solution identifiers when the host does not expose corresponding FetchXML entities.
- The build avoids depending on separately loaded dynamic-import chunks in PPTB; validate the emitted distribution in the target host. The resulting single bundle is large (Vite reports a chunk-size warning); this is accepted for host compatibility and bundle splitting is recorded as not required.
- The Markdown viewer supports browser-native full-text highlights and local Markdown import without Electron APIs.
- The documentation option panels use native disclosure controls; the generation action is sticky within the options workflow.
- Public PP-MD SVG and PNG assets are copied to the distribution, including the manifest icon under `dist/icons/`.

## Build and Packaging Internals
- `npm run build` runs `tsc`, `vite build`, and `scripts/normalize-dist-assets.mjs`.
- `npm test` runs offline package validation, lint, type checking, unit tests, contrast checks, the production build, and distribution validation.
- `scripts/validate-dist.cjs` checks the built entry point and icon; `scripts/validate-offline.cjs` performs offline package validation.
- `scripts/build-latest.ps1`, `scripts/electron-builder-after-pack.cjs`, and `scripts/stamp-exe.mjs` are legacy packaging utilities and are not part of the current npm build pipeline.

For current commands and package details, see [package.json](../package.json) and [the codebase guide](codebase-guide.md).
