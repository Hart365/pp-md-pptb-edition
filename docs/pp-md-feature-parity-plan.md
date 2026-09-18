# PP-MD Feature Parity Gap Analysis And Implementation Plan

## Purpose

Bring PP-MD - PPTB Edition to functional and output parity with the canonical standalone PP-MD project at `C:\Users\mhartley\VS Projects\PP-MD` (version 1.2.3), while exploiting the extra read-only information available from a Power Platform ToolBox Dataverse connection.

This assessment uses the following evidence:

- Canonical standalone PP-MD: `C:\Users\mhartley\VS Projects\PP-MD`
- Current PPTB port: `src/parser/solutionParser.ts`, `src/dataverse/solutionService.ts`, and `src/generator/markdownGenerator.ts`
- Generated local and connected reports supplied on 2026-09-07
- `docs/research/pptb-platform-reference.md`
- `docs/research/dataverse-retrieval-reference.md`
- `docs/research/solution-component-types.json`

## Current-State Finding

The connected report is not solution scoped. It emits 705 tables and 44 relationships for a solution that the local ZIP report identifies as seven tables. This is caused by connected-mode enrichment appending every metadata entity returned by `getAllEntitiesMetadata`, rather than resolving and collecting only the selected solution's components and explicit relationship context.

The falsifiable acceptance check is simple: generating the supplied solution in connected mode must retain the seven solution tables as the primary inventory. It may add a small, clearly labelled set of directly related external tables only when that option is enabled; it must never emit the environment catalogue.

## Mode Capability Model

| Capability | Local ZIP mode | Connected Dataverse mode | Recommended behaviour |
| --- | --- | --- | --- |
| Solution artifact inventory | Complete for exported components and files | Complete only through `solutioncomponent` routing | Build a common component manifest in both modes. |
| Table metadata | Exported customizations metadata | Current authoritative metadata, including requiredness, primary attributes, keys, ownership and cascade rules | Connected mode enriches only selected solution tables. |
| Forms, views, roles, apps, processes and web resources | Included when exported | Current active records and metadata | Preserve solution-component scope in both modes. |
| Flow definitions | ZIP workflow artifacts, where included | `workflow.clientdata` and scoped workflow records | Parse into the same normalized process model. |
| Component dependencies | Can be read from solution dependencies when present | Can be queried by selected solution/component IDs | Produce dependency sections in both modes, with availability warnings. |
| Environment configuration and capacity | Not available | Available through `powerplatformAPI` when the connection permits it | Separate optional environment appendix; never treat it as solution content. |
| Secrets | Never available | Must never be queried or rendered | Exclude secure plug-in configuration and environment-variable current values. |

## Output And Feature Gap Matrix

| Area | Standalone PP-MD 1.2.3 | PPTB status | Gap / required parity work |
| --- | --- | --- | --- |
| Solution component inventory | Component inventory and component relationship graph | No corresponding output | Add normalized inventory and relationship graph sections. |
| Dependency reporting | In-document dependencies and exportable dependency report | Exportable dependency report exists, but no complete dependency collection/output model | Add scoped dependency collector, document section, and retain standalone export. |
| Data-model scope | Solution-only entities by default | Connected enrichment appends environment-wide metadata | Replace enrichment with opt-in, bounded direct-reference context. |
| Table metadata detail | 17 configurable column/scope options | Only default columns and diagrams are configurable | Port metadata option contract and generator column selection. |
| Tables and relationships | Rich metadata and bounded ERDs | Baseline section exists; connected output has inaccurate scope and incomplete type-specific metadata | Correct scope; add entity keys, typed attribute facets, relationship descriptions and configurable detail. |
| Option sets | Dedicated choice section | Type model exists; output must be confirmed and matched to standalone detail | Port standalone choice labels, values, descriptions and local/global references. |
| Forms and views | Dedicated detailed section | Types and collector exist; current attached reports omit it | Complete ZIP and connected collectors and output. |
| Processes and automation | Detailed workflows, cloud flows, BPFs, actions, desktop flows and dataflows | Workflows and custom APIs are partial; desktop flows/dataflows absent | Normalize workflow definitions and add desktop flow/dataflow sections. |
| Apps | Model-driven, canvas, custom/code app coverage | Model-driven/canvas partial | Add sitemap/navigation, canvas connector details, custom pages and code-app routing. |
| Agents and AI models | Copilot Studio agent and AI-model sections | Absent from model, parser, collector and generator | Add typed artifacts, component routing and sections. |
| Custom APIs and offline profiles | Dedicated sections | Custom APIs collected but output parity is incomplete; offline profiles absent | Add full custom API definition/output and offline-profile support. |
| Web resources | Inventory plus richer resource details | Baseline inventory exists | Add content size and relevant source summary while avoiding sensitive content. |
| Security | Role matrices, field-security profiles and scope filters | Baseline matrices/profile support, no standalone filtering options | Port solution/custom-table filters, field flags and verified depth decoding. |
| Integration | Connection refs and environment variables | Baseline sections exist; current-value handling must stay non-secret | Add schema/type/default metadata and usage cross references; do not render values. |
| Reporting and plugins | Reports, dashboards, assemblies/types/steps | Types and collectors exist but attached output omits them | Complete generator sections and scope tests. |
| Consolidated reports | Multi-solution summary and aggregate detailed output | Present | Reuse the expanded common model and prevent cross-solution identity collisions. |
| Companion diagrams | Optional diagrams-only Markdown document | Available for All Selected Solutions when enabled | Split consolidated diagrams into a standalone Markdown document with its own TOC, document header, and Back to Top links. |
| Markdown import and search | Open existing Markdown and full-text search | Absent | Add as host-compatible viewer capabilities after generation parity. |
| Export formats | Markdown, ZIP, accessible PDF, styled XLSX | Markdown and ZIP only | Keep Markdown/ZIP. Research confirms no documented PPTB iframe PDF-export API, so implement PDF/XLSX only through a host-supported file/export path or mark as a separate discovery item. |
| Configuration presets | Reusable document presets | Uses host settings for only the current limited preferences | Persist the expanded settings schema through `toolboxAPI.settings`, never localStorage. |
| Accessibility validation | Axe tests and contrast checks | Unit tests only; no dedicated axe/contrast gate | Add WCAG 2.2 AA automated checks for PPTB UI, rendered Markdown and Mermaid fallbacks. |

## Proposed Architecture

Create one mode-neutral `SolutionDocumentationModel` that extends the existing `ParsedSolution` only with portable documentation concepts: component inventory, dependencies, agents, AI models, desktop flows, dataflows, offline profiles, expanded metadata facets and availability warnings. Both collectors must populate this contract. Markdown generation must consume this contract without knowing whether its source was ZIP or Dataverse.

Use an explicit collection policy:

- `solutionOnly` (default): selected solution components only.
- `solutionAndDirectReferences` (opt-in): selected components plus direct relationship endpoints or process references, marked `enrichedFromDataverse` and excluded from solution inventories/counts.
- `environmentAppendix` (opt-in, connected only): separately collected environment metadata with its own heading and availability note. Do not merge it into solution sections.

## Delivery Route

### Phase 0: Baseline And Guardrails

1. Add report fixtures based on the supplied local and connected Change Management Accelerator outputs.
2. Add snapshot/assertion tests for solution counts, section presence, and absence of environment-wide table leakage.
3. Port standalone option defaults into a typed settings schema persisted with `toolboxAPI.settings`.
4. Add a compatibility matrix that records which fields are ZIP-only, connected-only, unavailable, or unavailable by design.

Exit criteria: connected generation for the fixture has seven primary tables and warnings are rendered for unavailable fields.

### Phase 1: Correct Connected Collection Scope

1. Query `solutioncomponents` once for the selected solution and route every `componenttype` through `docs/research/solution-component-types.json`.
2. Resolve entity `MetadataId` values only for selected entity components; collect their metadata individually with `$select`/metadata property lists from the Dataverse research reference.
3. Remove the environment-wide append from `enrichSolutionsWithDataverseMetadata`; replace it with an opt-in direct-reference resolver capped to discovered references.
4. Thread the documented `connectionTarget` through all Dataverse calls and apply per-section failure warnings, with retry only for HTTP 429.

Exit criteria: no full-environment metadata call is used to append output; component and table counts are stable and solution scoped.

### Phase 2: Shared Output-Model Parity

1. Port standalone component inventory, relationship graph, dependencies, richer table metadata, choices, forms/views, security filters, integration cross references, reports/dashboards and plug-in sections.
2. Port the expanded generation settings so every section and metadata column can be included or excluded without changing collection correctness.
3. Port companion diagram splitting and ensure Mermaid source/fallback content is exposed accessibly.
4. Upgrade the TOC to reflect only generated sections and correct counts.

Exit criteria: local ZIP output covers all standalone core sections that have source artifacts; settings yield deterministic markdown.

### Phase 3: Modern Power Platform Artifacts

1. Extend the common model and ZIP parser for desktop flows, dataflows, offline profiles, Copilot Studio agents and AI models.
2. Add matching connected collectors only for component types verified in the component map and Dataverse metadata.
3. Add custom API request/response detail and model-driven/canvas/custom-page/code-app enrichment.

Exit criteria: all standalone v1.2.3 content sections have a PPTB equivalent, or a documented PPTB host/API limitation.

### Phase 4: Workflow And Export Experience

1. Add preset management via `toolboxAPI.settings`, Markdown import and in-view search.
2. Retain host file-system Markdown and ZIP exports.
3. Investigate host-supported accessible PDF/XLSX export. Do not use browser print as a parity claim until accessibility and host support are verified.

Exit criteria: each retained export works through PPTB APIs and has a documented accessible result.

### Phase 5: Quality Gate And Release

1. Add unit tests per parser, connected collector and generator section, including warning and secret-redaction tests.
2. Add Playwright plus axe-core WCAG 2.2 AA tests for both launch modes, options, error states, tables, search, focus order and Mermaid fallback interaction.
3. Add token contrast checks for all themes, build, PPTB manifest validation and a connected-mode smoke fixture.
4. Increment the tool version only when an implementation phase changes shipped behaviour; document each release delta in the README and design docs.

### Current Release Status (1.1.0)

- Completed: solution-scoped connected collection, modern artifact coverage, dependency reporting, explicit Dataverse collection policies, ToolBox-backed preset persistence, Markdown import/search, companion diagrams, sanitised rendering, and the automated contrast audit.
- Completed: TypeScript, lint, offline package validation, unit tests, contrast checks, and production build are wired into the standard `npm test` command.
- Host verification still required: Playwright/axe checks inside the PPTB iframe, screen-reader spot checks, 320 CSS pixel reflow, and forced-colours behaviour. These cannot be proven by the current repository runner because it has no PPTB host or browser automation dependency.
- Completed: searchable text-based PDF, styled XLSX, HTML, Markdown, and grouped ZIP exports use the documented ToolBox file-system bridge.
- Out of scope by design: secure configuration values, credentials, and environment-wide metadata as implicit solution documentation.

## Efficiency Principles

- Build the typed common model and component manifest before porting individual output sections; this prevents separate ZIP and connected implementations from drifting.
- Query connected data in grouped, component-scoped batches with explicit field selection. Avoid broad metadata enumeration except resolving selected entity metadata IDs.
- Store raw flow/XML payload only while parsing, then retain normalized fields needed for output. This limits memory and generated Markdown size.
- Generate summaries first and defer expensive diagrams/details behind selected inclusion options.
- Use one test fixture per representative artifact family, not a duplicated full-solution fixture for every section.

## WCAG 2.2 AA Requirements

- Use semantic headings, labelled controls, native checkboxes/switches and programmatic status/progress updates.
- Do not encode security privilege or warning states by colour alone; retain meaningful visible text.
- Keep generated Markdown tables navigable with headers and concise text alternatives for diagrams.
- Maintain keyboard access, visible focus, target sizes, contrast and no keyboard traps in the Markdown viewer and diagram controls.
- Sanitise rendered Markdown and do not allow untrusted HTML to bypass accessible structure or security controls.

## Host Verification Boundaries

- Connected collection of secure configuration, environment-variable current values or credentials.
- Native Save-dialog timing and file-system behavior inside the PPTB host.
- Screen-reader combinations, forced colours, 400% zoom, and final keyboard/reflow checks inside the PPTB iframe.
- Environment-wide metadata as implicit solution documentation.