# PP-MD Power Platform Markdown Document Generator

PP-MD generates structured Markdown documentation for Microsoft Power Platform solutions in two modes:

- Local Solutions mode (upload one or more solution ZIP files)
- Dataverse Connected mode (read solution metadata directly from the active Power Platform ToolBox environment)

## Tool Features And Capabilities

### Input and solution scope

- Process one or more exported Power Platform solution ZIP files entirely in the local tool runtime. All documentation and analysis happens on your machine; no solution data is uploaded.
- The app header shows the running version (`PP-MD - PPTB Edition v#.#.#`), and the **Generate Selected** button stays pinned to the bottom-right of the solution selection page.
- Browse, search, sort, filter, refresh, and multi-select solutions from the active Power Platform ToolBox Dataverse connection.
- Filter connected solutions by publisher and managed or unmanaged status.
- Keep connected collection read-only and scoped to the selected solution components through `solutioncomponent` records.
- Choose between solution-only collection, bounded direct-reference enrichment, and a separately labelled environment appendix.
- Page FetchXML in 5,000-record batches (up to 100,000 rows), cap OData at 5,000 rows, and batch selected-table metadata lookups with explicit safety limits.
- Treat unavailable optional modern-artifact endpoints as capability gaps without failing the rest of the document.

### Documentation coverage

- Tables, columns, requiredness, data types, keys, ownership, choices, relationships, cascade rules, Advanced Find, and field-security metadata.
- Forms, views, workflows, cloud flows, business process flows, business rules, actions, custom APIs, desktop flows, and dataflows.
- Model-driven apps, canvas apps, custom pages, code apps, app navigation, Copilot Studio agents, and AI models.
- Security roles, privilege depths, field-security profiles, plug-in assemblies, plug-in types, SDK message processing steps, reports, dashboards, and web resources.
- Connection references, environment variables, SharePoint references, offline profiles, component dependencies, and Dataverse enrichment indicators.
- Individual solution documents plus a complete **All Selected Solutions** document generated from the same normalized model.
- Mermaid ERDs and architecture diagrams, with companion diagram documents for consolidated or structurally complex output.

### Generation, viewing, and configuration

- Configure document context, section scope, table metadata columns, security-role filters, diagram detail, diagram colour theme, and dependency reports.
- Save reusable configuration presets through ToolBox settings with a local-development fallback.
- View sanitised GitHub Flavored Markdown as rendered content or raw source.
- Import existing Markdown, search within rendered documents, copy Markdown, and follow generated table-of-contents and Back to Top links.
- Keep document controls visible above the independently scrolling viewer and adapt toolbar actions into responsive groups on narrow screens.
- Render Mermaid diagrams lazily, then pre-render the rest in the background (top-down, low priority, paused while scrolling, visible diagrams first), cache completed SVG output, and force outstanding diagrams to finish before PDF generation.
- Yield during large PDF drawing operations so status updates can paint and the interface remains responsive where possible.

### Export capabilities

- Export the active document as Markdown, standalone sanitised HTML, searchable text-based PDF, or a styled Excel workbook.
- Embed rendered Mermaid diagrams in PDF output and fall back to readable diagram source when an image is unavailable.
- Preserve PDF pagination, headings, paragraphs, lists, tables, code blocks, links, and font-safe replacements for unsupported symbols.
- Export all Markdown documents, companion diagrams, and optional dependency reports in a ZIP archive.
- Export documents by category with organized folders for individual and consolidated output.
- Batch export every generated document as HTML, PDF, or Excel in a single ZIP archive.
- Use the PPTB file-system bridge in the host and browser downloads during local development, with visible progress retained through the Save-dialog handoff.

### Security and privacy

- Keep local ZIP processing on the user's device and connected collection within the active ToolBox connection context.
- Never query or render credentials, secure plug-in configuration, or live environment-variable values.
- Report only whether an environment-variable current-value record exists.
- Sanitise rendered Markdown and restrict generated HTML classes before display or HTML export.
- Strip raw HTML tags from PDF table-cell text, including tags with quoted `>` characters in attributes.
- Limit Dataverse Deep Insights and dependency output to meaningful references within the selected solution inventory.

## Power Platform ToolBox Manifest Alignment

This README is aligned to metadata in package.json used by Power Platform ToolBox.

| Manifest Field | Value |
| --- | --- |
| name | @hart365/pp-md-pptb-edition |
| displayName | PP-MD Power Platform Markdown Document Generator |
| version | 1.1.8 |
| description | Generate structured Markdown documentation from Solution ZIP files or a direct Dataverse connection |
| icon | icons/pp-md.svg |
| configurations.repository | https://github.com/Hart365/pp-md-pptb-edition |
| configurations.readmeUrl | https://raw.githubusercontent.com/Hart365/pp-md-pptb-edition/refs/heads/main/README.md |
| configurations.website | https://github.com/Hart365/pp-md-pptb-edition |
| features.connectionRequirement | optional |
| features.minAPI | 1.2.2 |
| license | MIT |

## User Guide

### Local Solutions

1. Choose **Local Solutions**.
2. Drop one or more exported `.zip` solution files or use the file picker.
3. Review the generated documents in the sidebar.
4. Adjust document context, metadata columns, security filters, diagram settings, and section scope before regenerating.

### Dataverse Connected

1. Choose **Dataverse Connected** inside PPTB.
2. Confirm an active Dataverse connection.
3. Search, sort, filter, and select one or more solutions.
4. Choose the collection policy when additional bounded context is needed.
5. Generate and review the solution-scoped documentation.

### Viewer controls

The viewer supports rendered Markdown, raw Markdown, in-document search, copy, internal heading navigation, Mermaid diagrams, companion diagram documents, and responsive export menus. The **All Selected Solutions** entry is a full consolidated document, not just a summary.

The **Create Consolidated Document (2+ solutions)** option is on by default. When two or more solutions are selected, PP-MD creates one consolidated document that collates every selected solution. It appears in its own **Consolidated** section at the top of the sidebar, alongside the individual solution documents. Clear the option to create only the individual documents.

## Export Formats

- **Markdown**: the active document as `.md`.
- **HTML**: sanitized rendered content as a standalone `.html` file.
- **PDF**: a valid generated `.pdf` file with headings, tables represented as readable text, pagination, and safe font-compatible text.
- **Excel**: a styled `.xlsx` workbook with Overview, Tables, Relationships, Processes, Apps, Integration, Security, and Automation sheets, plus one sheet per table (named by the table's display name) listing its columns. Table names on the Tables sheet link to their column sheets, every sheet is sorted alphabetically on its first column, and any document header details you enter appear at the top of the Overview sheet. Each table sheet starts with a `Display Name (schema_name)` title and a **Back to Tables** link, lists Display Name then Schema Name first, and includes lookup targets and option set values. Description columns wrap text.
- **All Markdown**: a ZIP containing generated documents, companion diagrams, and optional dependency reports.
- **By Category**: a ZIP containing category folders for individual solutions and the consolidated document.

## Accessibility

This tool has been designed to meet WCAG 2.2 AA compliance where possbile. This includes:

- Semantic landmarks, headings, lists, tables, labels, grouped controls, and status regions.
- Keyboard-operable native controls for file selection, filtering, toggles, disclosure menus, search, export, and navigation.
- A skip link, logical focus order, visible `:focus-visible` indicators, and controls that remain usable without pointer input.
- Programmatically announced processing, validation, copy, export, PDF preparation, and diagram-rendering status.
- Meaningful visible text alongside colour-coded privilege, permission, warning, success, and error states.
- Accessible Mermaid figure captions, SVG labels, text descriptions, source disclosure, and failure fallbacks.
- Sanitized Markdown with preserved semantic table structure and horizontally scrollable table regions where required.
- Light and dark themes with automated token contrast checks, native-control colour-scheme support, and consistent toolbar font metrics.
- Reduced-motion behavior, stable target sizes, responsive reflow, non-overlapping toolbar groups, and narrow-screen navigation.
- Search and viewer state exposed through native roles, names, values, and pressed or busy states.

The standard validation pipeline checks structure, theme-token contrast, TypeScript, lint, unit behavior, offline package requirements, and the production build. Testing for Screen-reader combinations, forced colours, 400% zoom, and final PPTB iframe behavior requires manual testing, which has been carried out to best-endeavours.

The author does not claim complete WCAG conformance and individual testing should be performed. If accessibility issues are discovered then please log these as issues in GitHub for review and resolution where possible.

## Architecture At A Glance

```text
ZIP files --------------------> solutionParser.ts ----\
													  > ParsedSolution
PPTB Dataverse connection ----> solutionService.ts --/        |
															   v
													 markdownGenerator.ts
															   |
											MarkdownViewer + export adapters
```

The detailed file and responsibility map is maintained in [docs/codebase-guide.md](docs/codebase-guide.md). The research-backed parity analysis and implementation history are maintained in [docs/pp-md-feature-parity-plan.md](docs/pp-md-feature-parity-plan.md). The summary above is the authoritative description of currently shipped features.

## How To Use In Power Platform ToolBox

1. Open PP-MD in Power Platform ToolBox.
2. Choose a launch mode:
	- Local Solutions for ZIP upload
	- Dataverse Connected for direct environment reads
3. Optionally set document header fields (client, contract, project, sprint, release date).
4. Generate documentation.
5. Review in the built-in Markdown viewer.
6. Export single files, all files, and include dependency reports.

## Dataverse Connected Mode Workflow

1. Ensure an active Dataverse connection exists in ToolBox.
2. Select Dataverse Connected mode.
3. Load and filter available solutions.
4. Select one or more solutions.
5. Generate selected documentation.
6. Export Markdown output.

## Local Solutions Mode Workflow

1. Select Local Solutions mode.
2. Drag and drop solution ZIP files, or browse to select files.
3. Generate documentation for each valid solution archive.
4. Review and export individual or combined output.

## Development

Prerequisites:

- Node.js 20+
- npm

Commands:

- Install dependencies: npm.cmd install
- Run dev server: npm.cmd run dev
- Lint: npm.cmd run lint
- Type check: npm.cmd run type-check
- Unit tests: npm.cmd run test:unit
- Build: npm.cmd run build
- Full pipeline: npm.cmd run test
- Contrast audit: npm.cmd run test:contrast
- Official PPTB validation with URL checks: npm.cmd run validate
- Deterministic PPTB validation without URL checks: npm.cmd run validate:offline
- Validate built entry point and icon: npm.cmd run validate:dist
- Complete publishing preflight: npm.cmd run finalize-package

### PPTB publishing preflight

1. Run `npm.cmd ci` and `npm.cmd run finalize-package`.
2. Run `npm.cmd run validate` with network access and resolve every validator error or warning.
3. Load the built tool through Power Platform ToolBox **Debug > Load Local Tool** and test both launch modes and exports.
4. Authenticate with npm using `npm login`, then confirm the account can publish the `@hart365` scope.
5. Publish the scoped package with `npm publish --access public`.
6. Install `@hart365/pp-md-pptb-edition` through PPTB **Debug > Install from npm** and complete a published-package smoke test.
7. Submit the npm package through the Power Platform ToolBox tool-submission form.

All libraries are bundled into `dist` at build time, so the published package declares no runtime `dependencies`; installing it from npm does not download any additional packages.

The package intentionally declares `api.github.com` as an optional CSP connection used only for update checks. Core documentation generation remains available when that endpoint is unavailable.

## Security And Privacy

- Processing is local to the tool runtime.
- Dataverse Connected mode performs read-only metadata access.
- Generated documentation stays under user control.
- Credentials are not written into generated Markdown output.
- Connected environment-variable values are not queried for documentation; only whether a value record exists is reported.
- PDF and Excel exports are generated locally from the normalized solution model.

## Troubleshooting

- **Installation Failed: spawn EINVAL** when installing from npm in PPTB on Windows: this is a Power Platform ToolBox host issue (`npm.cmd` is launched without a shell on Node.js 18.20.2 or later). Until PPTB is updated, install the tool from the PPTB marketplace, or extract the npm tarball and load its `package` folder through **Debug > Load Local Tool**.
- **Tool icon blank in Installed Tools**: PPTB renders SVG icons through a CSS mask that its `pptb-webview` protocol blocks under CORS. PPTB only accepts SVG icons, so this is resolved in the host rather than in the tool.
- **Optional connected artifact warnings**: some Dataverse environments do not expose every modern-artifact endpoint. Those capabilities are treated as unavailable and do not prevent the rest of the solution from being documented.
- **Large documents**: Mermaid diagrams are automatically moved to a companion document when the generated document is large or structurally complex.
- **PPTB downloads**: exports use the ToolBox file-system bridge inside PPTB and browser downloads during local development.

## Support

- Repository: https://github.com/Hart365/pp-md-pptb-edition
- Issues: https://github.com/Hart365/pp-md-pptb-edition/issues
- Website: https://github.com/Hart365/pp-md-pptb-edition

## AI Assistance

Parts of this tool were generated with GitHub Copilot and reviewed, tested, and maintained by the contributors listed in package.json.

## License

MIT
