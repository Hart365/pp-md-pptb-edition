# PP-MD Power Platform Markdown Document Generator

PP-MD generates structured Markdown documentation for Microsoft Power Platform solutions in two modes:

- Local Solutions mode (upload one or more solution ZIP files)
- Dataverse Connected mode (read solution metadata directly from the active Power Platform ToolBox environment)

## Whats New: Dataverse Connected Documentation

PP-MD now supports direct Dataverse documentation generation without exporting solution ZIP files first.

Key connected-mode capabilities:

- Reads solutions from the active ToolBox Dataverse connection
- Search, sort, and filter solutions before generation
- Filter by publisher and managed/unmanaged status
- Multi-select solutions and generate in batch
- Refresh solution list from the environment
- Keeps connected documentation scoped to selected solution components
- Keeps processing read-only and within the active environment context

## Power Platform ToolBox Manifest Alignment

This README is aligned to metadata in package.json used by Power Platform ToolBox.

| Manifest Field | Value |
| --- | --- |
| name | @powerplatform/pp-md-tool |
| displayName | PP-MD Power Platform Markdown Document Generator |
| version | 1.0.1 |
| description | Generate Power Platform documentation from either Solution ZIP files or direct Dataverse connection |
| icon | pp-md.svg |
| configurations.repository | https://github.com/Hart365/pp-md-pptb-edition/ |
| configurations.readmeUrl | https://raw.githubusercontent.com/Hart365/pp-md-pptb-edition/main/README.md |
| configurations.website | https://github.com/Hart365/pp-md-pptb-edition/ |
| license | MIT |

## Documentation Coverage

PP-MD generates Markdown documentation including:

- Dataverse tables, attributes, and relationships
- Mermaid ERD output
- Forms and views
- Power Automate flows, workflows, and related process artifacts
- Model-driven and canvas apps
- Security roles and field security profiles
- Plugin assemblies and SDK message processing steps
- Connection references and environment variables
- Reports, dashboards, and web resources
- Consolidated summary across multiple solutions

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
- PPTB validate (offline URL checks): npm.cmd run validate:offline

## Security And Privacy

- Processing is local to the tool runtime.
- Dataverse Connected mode performs read-only metadata access.
- Generated documentation stays under user control.
- Credentials are not written into generated Markdown output.

## Support

- Repository: https://github.com/Hart365/pp-md-pptb-edition
- Issues: https://github.com/Hart365/pp-md-pptb-edition/issues
- Website: https://github.com/Hart365/pp-md-pptb-edition

## License

MIT
