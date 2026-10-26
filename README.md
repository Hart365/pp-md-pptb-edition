# PP-MD Power Platform Markdown Document Generator

PP-MD generates structured Markdown documentation for Microsoft Power Platform solutions in two modes:

- Local Solutions mode (upload one or more solution ZIP files)
- Dataverse Connected mode (read solution metadata directly from the active Power Platform ToolBox environment)

## Tool Features And Capabilities

### Input and solution scope

- Process exported Power Platform solution ZIP files entirely in the local tool runtime; ZIP data is not uploaded by this tool. Dataverse Connected mode reads selected solution metadata through the active ToolBox connection.
- The app header shows the running version (`PP-MD - PPTB Edition v#.#.#`), and the **Generate Selected** button stays pinned to the bottom-right of the solution selection page.
- Browse, search, sort, filter, refresh, and multi-select solutions from the active Power Platform ToolBox Dataverse connection.
- Filter connected solutions by publisher and managed or unmanaged status.
- Keep connected collection read-only and scoped to the selected solution components through `solutioncomponent` records.
- Choose solution-only collection, bounded direct-reference enrichment, or **Solution only + environment appendix**. The appendix policy keeps every solution section solution-scoped and always creates the **All Selected Solutions** document (even for one solution), which alone contains the Environment Appendix.
- The Environment Appendix documents environment identity, organisation settings, Power Platform environment settings (when the connection has the Power Platform API enabled), provisioned languages, currencies, inventory counts, installed solutions, application packages, publishers, and business units. User and team data is reported as counts only; no names, environment-variable values, or secrets are collected. The Excel export adds a matching **Environment** worksheet.
- Cancel an in-progress ZIP parse or Dataverse collection; outstanding requests stop at the next checkpoint without producing partial documents.
- Page FetchXML in 5,000-record batches (up to 100,000 rows), cap OData at 5,000 rows, and batch selected-table metadata lookups with explicit safety limits.
- Treat unavailable optional modern-artefact endpoints as capability gaps without failing the rest of the document.
- Dataverse Connected mode retrieves solution-scoped global option sets, including option labels, numeric values, descriptions, and colours, and selected email-template metadata without retrieving template bodies.

### Documentation coverage

- Tables, columns, requiredness, data types, keys, ownership, choices, relationships, cascade rules, Advanced Find, and field-security metadata.
- Forms, views, workflows, cloud flows, business process flows, business rules, actions, custom APIs, desktop flows, and dataflows.
- Model-driven apps, canvas apps, custom pages, code apps, app navigation, Copilot Studio agents, and AI models.
- Security roles, privilege depths, field-security profiles, plug-in assemblies, plug-in types, SDK message processing steps, reports, dashboards, and web resources.
- Connection references, environment variables, SharePoint references, offline profiles, component dependencies, and Dataverse enrichment indicators.
- Site maps with text navigation and top-down hierarchical Mermaid diagrams, image-column and table-image configurations, and metadata-backed extended solution-component records.
- Individual solution documents plus a complete **All Selected Solutions** document generated from the same normalised model.
- Mermaid ERDs and architecture diagrams, with companion diagram documents for consolidated or structurally complex output.

### Generation, viewing, and configuration

- Configure document context, section scope, table metadata columns, security-role filters, diagram detail, diagram colour theme, and dependency reports.
- Save reusable configuration presets through ToolBox settings with a local-development fallback.
- View sanitised GitHub Flavored Markdown as rendered content or raw source.
- Import existing Markdown, search within rendered documents, copy Markdown, and follow generated table-of-contents and Back to Top links.
- Keep the logo and name left-aligned and actions right-aligned across the full window width. Wrap header controls below the app title when space is limited, and keep viewer controls visible above the independently scrolling document.
- Keep parse warnings, collection errors, and issues in a separate **Diagnostics** document, available from the header when diagnostics exist. Solution documentation and Excel workbooks retain inventory and unknown/unavailable states without embedding diagnostic messages.
- Render Mermaid diagrams lazily, then pre-render the rest in the background (top-down, low priority, paused while scrolling, visible diagrams first), cache completed SVG output in a bounded least-recently-used cache (100 diagrams), and force outstanding diagrams to finish before PDF generation.
- Yield during large PDF drawing operations so status updates can paint and the interface remains responsive where possible.

### Export capabilities

- Export the active document as Markdown, standalone sanitised HTML, searchable text-based PDF, or a styled Excel workbook.
- Embed rendered Mermaid diagrams in PDF output and fall back to readable diagram source when an image is unavailable.
- Preserve PDF pagination, headings, paragraphs, lists, tables, code blocks, links, and font-safe replacements for unsupported symbols.
- Export all Markdown documents, companion diagrams, diagnostics, and optional dependency reports in a ZIP archive.
- Export documents by category with organised folders for individual and consolidated output.
- Batch export every generated document as HTML, PDF, or Excel in a single ZIP archive.
- Diagnostics are separate HTML/PDF documents in rendered batch exports and separate Markdown files alongside Excel workbooks. They can also be viewed and exported individually using **Diagnostics**.
- Use the PPTB file-system bridge in the host and browser downloads during local development, with visible progress retained through the Save-dialog handoff.

### Security and privacy

- Keep local ZIP processing on the user's device and connected collection within the active ToolBox connection context.
- Never query or render credentials, secure plug-in configuration, or live environment-variable values.
- Check for non-null environment-variable current-value records without retrieving their values. Report **Unknown**, not **No**, if presence cannot be checked.
- Sanitise rendered Markdown and restrict generated HTML classes before display or HTML export.
- Strip raw HTML tags from PDF table-cell text, including tags with quoted `>` characters in attributes.
- Limit Dataverse Deep Insights and dependency output to meaningful references within the selected solution inventory.

## Power Platform ToolBox Manifest Alignment

This README is aligned to metadata in package.json used by Power Platform ToolBox.

| Manifest Field | Value |
| --- | --- |
| name | @hart365/pp-md-pptb-edition |
| displayName | PP-MD Power Platform Markdown Document Generator |
| version | 1.2.1 |
| description | Generate Power Platform documentation from either Solution ZIP files or direct Dataverse connection |
| icon | icons/pp-md.svg |
| configurations.repository | https://github.com/Hart365/pp-md-pptb-edition |
| configurations.readmeUrl | https://raw.githubusercontent.com/Hart365/pp-md-pptb-edition/refs/heads/main/README.md |
| configurations.website | https://github.com/Hart365/pp-md-pptb-edition |
| features.connectionRequirement | optional |
| features.minAPI | 1.2.2 |
| `license` | MIT |

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

For either mode, optionally set document header fields such as client, contract, project, sprint, and release date. Review any **Diagnostics** document separately from solution content, then export the active document or use the batch and category export options.

#### Connected component details

| Component type | Documentation |
| --- | --- |
| 9 - Global Option Set | Schema/display names, metadata ID, descriptions, and individual option labels, values, colours, and descriptions. |
| 2 - Column | Selected column metadata and its parent table, including explicitly selected columns on standard tables or when the parent table is not itself packaged. |
| 62 - Site Map | Name and area/group/subarea navigation, including referenced tables, plus a hierarchical Mermaid diagram when diagrams are enabled. The text remains in the main documentation when diagrams are separated into a companion document. Matches both the primary ID and the `sitemapidunique` solution-layer ID. Site maps that are saved but not yet published (for example, an app that was never published) are read through `RetrieveUnpublishedMultiple` and marked **Publication State: Unpublished**. |
| 431 - Attribute Image Configuration | Parent table, image column, and whether full-size images can be stored. |
| 432 - Entity Image Configuration | Parent table and primary image column. |
| 36 - Email Template | Selected template name, subject, table type, and language code; template body content is not retrieved. |
| Extended types, including 10084, 10087, 10164, and 10350 | Type/table names are resolved from the active environment's `EntityDefinitions.ObjectTypeCode` metadata. Selected component IDs are matched against the primary ID and, when the table has one, the readable `<primary id>unique` solution-layer ID (the same convention as `appmoduleidunique` and `sitemapidunique`). Other GUID columns are not used as keys, so an unrelated record is never matched. Output includes names and selected configuration properties, not arbitrary record payloads. Missing or ambiguous matches remain explicit warnings and unresolved inventory entries; the warning lists every lookup tried. Dataverse does not support unpublished-record retrieval for these tables, so unpublished or deleted records cannot be distinguished from inaccessible ones. |

Additional configuration records appear under **Additional Solution Components** and in the Excel **Solution Components** worksheet. Global choices have their own Markdown section and Excel **Global Option Sets** worksheet. Email templates appear in the **Email Templates** section and are included in consolidated and category exports. These details are preserved in consolidated and category exports. Missing permissions, unavailable metadata, and inaccessible records retain an explicit collection issue in the separate **Diagnostics** document rather than being reported as successfully documented.

**Has Current Value** means that a non-null current-value record exists, not that a default value is present. Both Web API and SDK lookup formats are supported. Values such as `false` and `0` still count as set. Current values are never retrieved or included in exports; an unsuccessful presence check is shown as **Unknown**.

#### Environment Appendix counts and labels

Appendix items are alphabetised by their displayed labels within each grouping, including environment identity, settings, languages, currencies, inventory categories and lists. The Markdown and Excel exports use the same ordering. Tool-authored documentation and parameter labels use UK English (for example, **Organisation** and **Customisation**). Actual API operations, schema identifiers, filenames and source-supplied object names/values retain their original spelling.

- **Users in environment:** distinct enabled human users with a direct security role or membership of a non-default team. Automatic business-unit default teams, disabled accounts, internal system accounts and application users are excluded. Security roles do not have an active/inactive state; the user account must be enabled and the assigned role must exist.
- **Application users in environment:** reported separately, using the same role/non-default-team qualification. Membership inferred only from a Microsoft Entra group is not counted until represented in Dataverse membership records.
- **Users in tenant:** shown as **Unavailable**. The existing PPTB connection does not expose Microsoft Entra directory totals; the Dataverse `systemuser` table is not a tenant-wide user directory.
- **Total inventory:** distinct component primary keys, not joined rows or repeated solution memberships. Workflow counts include definitions only, not activation copies/templates; inherited business-unit security-role copies are excluded. Totals include system/Microsoft items and inactive definitions where applicable, and can therefore exceed maker-facing custom-only lists.
- **Custom (confirmed):** counts matched to retrieved non-Microsoft, non-default publisher namespaces. Plug-in assemblies, plug-in steps, Custom APIs and web resources also use the publisher of their associated managed solution when the namespace cannot be resolved. This is the component record's associated solution, not any solution that happens to include it. Managed third-party items can count as custom; managed/unmanaged and customisable flags alone are not used to identify Microsoft components. Standard table metadata and recognised Microsoft/default namespaces are excluded, including Microsoft Dynamics namespaces when the matching publisher is absent from the publisher inventory.
- **Unclassified:** items with missing, unmatched or ambiguous publisher provenance. These are not silently treated as Microsoft or custom. Names without a publisher namespace (for example, some plug-in or role names) may remain unclassified; an unmanaged component's Active/Default solution does not establish its author. A confirmed custom count of zero with unclassified items is not a claim that no custom items exist.
- **Paging:** large inventories are read across all FetchXML pages. Web API paging-cookie envelopes are unpacked and URL-decoded before reuse; SDK-style raw cookies are also supported. A failed or incomplete classification is reported explicitly, with a separately available aggregate total retained rather than a partial custom count.
- **Unavailable versus zero:** failed, malformed, truncated or aggregate-limited queries do not become zero, and an aggregate input-limit error is not treated as proof of a numerical lower bound. A valid empty inventory is reported as zero. Counts reflect the connection's permissions and are collected sequentially, not as an atomic environment snapshot.

When **Metadata Source** is enabled, each table identifies its origin as **Dataverse Connected** or **ZIP Export**, with actual peer gap fills or Dataverse enrichment listed separately. Tables without a recorded source are labelled **Unknown**.

### Viewer controls

The viewer supports rendered Markdown, raw Markdown, in-document search, copy, internal heading navigation, Mermaid diagrams, companion diagram documents, and responsive export menus. The **All Selected Solutions** entry is a full consolidated document, not just a summary.

During generation and batch exports, a red **Cancel** button aligns with the header action groups and remains available when the narrow-screen toolbar menu is closed. Its text, border, and focus colours are contrast-checked in both themes.

The **Create Consolidated Document (2+ solutions)** option is on by default. When two or more solutions are selected, PP-MD creates one consolidated document that collates every selected solution. It appears in its own **Consolidated** section at the top of the sidebar, alongside the individual solution documents. Clear the option to create only the individual documents.

### Missing dependencies

Enable **Generate Missing Dependencies** under **Documentation Options** to append a **Missing Dependencies** section to the document. The option is off by default and lists only installation/import prerequisites required by components packaged in that individual solution.

- Local runs use only the ZIP's `SolutionManifest/MissingDependencies` records. Connected runs call Dataverse `RetrieveMissingDependencies` with that solution's unique name.
- Runtime references, environment-wide table columns and relationships, peer gap-fill metadata, and dependencies belonging to other solutions are not used to infer import prerequisites.
- Lists the dependent item, its type, the required component and type, associated tables, and source solution. Component IDs are retained when a friendly name cannot be resolved.
- A successful empty result is reported explicitly. Collection failures or uncollected dependencies are marked as incomplete, not silently replaced with inferred references or a "no dependencies" message.
- Excel exports include a separate **Missing Dependencies** table below the columns on each individual table worksheet, separated by a blank row. Only references associated with that table appear there; dependencies without a table association remain in the document-wide section. The option applies to individual and batch Excel exports.
- Consolidated documents retain each individual solution's installation requirements and identify the source solution. Selecting another solution does not remove an individual solution's prerequisites.

These prerequisites may already be installed in the target environment. The report describes what each solution needs to install/import, not whether a particular target environment can currently satisfy those requirements. Regenerate the documentation from the ZIP or connection to refresh the authoritative dependency results.

## Export Formats

- **Markdown**: the active document as `.md`.
- **HTML**: sanitised rendered content as a standalone `.html` file.
- **PDF**: a valid generated `.pdf` file with headings, tables represented as readable text, pagination, and safe font-compatible text.
- **Excel**: a styled `.xlsx` workbook with Overview, Tables, Relationships, Processes, Apps, Integration, Security, Automation, Global Option Sets, and Solution Components sheets, plus one sheet per table (named by the table's display name) listing its columns. Table names on the Tables sheet link to their column sheets, every sheet is sorted alphabetically on its first column, and any document header details you enter appear at the top of the Overview sheet. Each table sheet starts with a `Display Name (schema_name)` title and a **Back to Tables** link, lists Display Name then Schema Name first, and includes lookup targets and option set values. Description columns wrap text.
- **All Markdown**: a ZIP containing generated documents, companion diagrams, and optional dependency reports.
- **By Category**: a ZIP containing category folders for individual solutions and the consolidated document.

Excel table worksheets show General, Data and tracking, Make this table an option when, and Rows in this table metadata side by side above the column list. Headers use a charcoal-and-grey palette, with bold grey label cells, white value cells, and thin grey borders. Label/value pairs wrap within each section; unavailable values retain amber highlighting and include the reason they could not be retrieved.

## Accessibility

The interface is designed using accessibility practices associated with WCAG 2.2 AA. This is not a claim of conformance. Implemented practices include:

- Semantic landmarks, headings, lists, tables, labels, grouped controls, and status regions.
- Keyboard-operable native controls for file selection, filtering, toggles, disclosure menus, search, export, and navigation.
- A skip link, logical focus order, visible `:focus-visible` indicators, and controls that remain usable without pointer input.
- Programmatically announced processing, validation, copy, export, PDF preparation, and diagram-rendering status.
- Meaningful visible text alongside colour-coded privilege, permission, warning, success, and error states.
- Accessible Mermaid figure captions, SVG labels, text descriptions, source disclosure, and failure fallbacks.
- Sanitised Markdown with preserved semantic table structure and horizontally scrollable table regions where required.
- Light and dark themes with automated token contrast checks, native-control colour-scheme support, and consistent toolbar font metrics.
- Reduced-motion behaviour, stable target sizes, responsive reflow, non-overlapping toolbar groups, and narrow-screen navigation.
- Search and viewer state exposed through native roles, names, values, and pressed or busy states.

The standard validation pipeline checks TypeScript, lint, unit behaviour, offline package requirements, theme-token contrast, the production build, and distribution output. Screen-reader combinations, forced colours, zoom/reflow, and final PPTB iframe behaviour require host-level validation and are not established by these automated checks.

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

For implementation details, see the [codebase guide](docs/codebase-guide.md) and [high-level design](docs/high-level-design.md). This README is the user-facing guide to the current released feature set.

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

- ZIP parsing, generation, rendering, and export run in the client tool runtime. Dataverse Connected mode reads metadata through the active ToolBox connection.
- Dataverse Connected mode uses read-only metadata access.
- Generated documentation stays under user control.
- Credentials are not written into generated Markdown output.
- Connected environment-variable values are not queried for documentation; only whether a value record exists is reported.
- PDF and Excel exports are generated locally from the normalised solution model.

## Troubleshooting

- **Installation Failed: spawn EINVAL** when installing from npm in PPTB on Windows: this has been reported for some PPTB/Node.js combinations and may depend on the host version. Verify against the current host release; if it persists, try the marketplace package or load the unpacked package through **Debug > Load Local Tool**.
- **Tool icon blank in Installed Tools**: a blank SVG icon has been reported in some PPTB installations. The cause and applicability to a particular host version are not confirmed by this repository; verify in the target host before treating it as a tool-side issue.
- **Optional connected artefact warnings**: some Dataverse environments do not expose every modern-artefact endpoint. Those capabilities are treated as unavailable and do not prevent the rest of the solution from being documented.
- **Large documents**: Mermaid diagrams are automatically moved to a companion document when the generated document is large or structurally complex.
- **PPTB downloads**: exports use the ToolBox file-system bridge inside PPTB and browser downloads during local development.

## Project Documentation

- [High-level design](docs/high-level-design.md)
- [Low-level design](docs/low-level-design.md)
- [Codebase guide](docs/codebase-guide.md)
- [File catalogue](docs/codebase-file-catalog.md)
- [PPTB platform reference](docs/research/pptb-platform-reference.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)

## Support

- Repository: https://github.com/Hart365/pp-md-pptb-edition
- Issues: https://github.com/Hart365/pp-md-pptb-edition/issues
- Website: https://github.com/Hart365/pp-md-pptb-edition

## AI Assistance

Parts of this tool were generated with GitHub Copilot and reviewed, tested, and maintained by the contributors listed in package.json.

## Licence

MIT
