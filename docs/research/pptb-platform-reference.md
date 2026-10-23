# Power Platform ToolBox Platform Reference

This reference separates repository-verified behaviour from host behaviour that must be checked against the installed Power Platform ToolBox (PPTB) version. Repository observations were checked against the 1.2.0 source on 2026-10-23. They are not a substitute for the host's current API documentation or a host-level test.

## Repository-Verified Integration

### Runtime and manifest

- `package.json` declares the PPTB package entry point as `index.html`, an optional connection requirement, and a minimum API version of `1.2.2`.
- `src/api/toolboxAPI.ts` detects the PPTB runtime and wraps injected `toolboxAPI` and `dataverseAPI` services.
- The application is built by Vite for the PPTB web-tool package. The current project does not ship an Electron main process.
- The manifest's `multiConnection` setting is `none`; the current tool is not configured for selecting primary and secondary connections.

See [`package.json`](../../package.json), [`src/api/toolboxAPI.ts`](../../src/api/toolboxAPI.ts), and the [high-level design](../high-level-design.md).

### Connections and Dataverse

- The application obtains the active connection through `toolboxAPI.connections.getActiveConnection()`.
- Connected collection uses Dataverse services through the host adapter in `src/api/toolboxAPI.ts` and the collector in `src/dataverse/solutionService.ts`.
- The default collection policy is `solutionOnly`; bounded direct-reference enrichment and the `environmentAppendix` policy are also available. The Environment Appendix is rendered only in the consolidated All Selected Solutions document. Availability and completeness depend on the connection, permissions, and accessible Dataverse metadata.
- The current collector uses `getAllEntitiesMetadata` to resolve selected entity metadata IDs. It does not append the full metadata catalogue to the generated solution inventory.
- Connected results can be incomplete when an artefact type or endpoint is unavailable. Such conditions should be presented as a warning or capability limitation, not as proof that the artefact does not exist.
- Global option-set definitions are retrieved by the selected solution's metadata IDs. Email-template metadata (excluding body content), site maps, and image configurations have explicit collectors; extended record components are resolved through the environment's table metadata and read only for their selected IDs.

For supported component routing and query guidance, see the [Dataverse retrieval reference](dataverse-retrieval-reference.md) and [solution component type map](solution-component-types.json).

### Settings, theme, and file saving

- In PPTB, the app uses namespaced `toolboxAPI.settings` values for saved configuration and collection preferences.
- Browser development falls back to localStorage for supported preferences; this fallback is not the persistence mechanism used in PPTB.
- The active host theme is read through the host utility. Browser development follows the OS preference; the in-app theme toggle is disabled inside PPTB.
- Exports use the host file-system save API when running in PPTB and browser download fallbacks in local development.

Host API availability, save-dialog behaviour, and large-file handling must be validated in the target PPTB release. The repository's unit tests do not emulate the host.

## Security and Privacy Boundaries

- The tool does not handle Dataverse authentication tokens directly.
- Local ZIP parsing and document generation run in the client application. Dataverse Connected mode necessarily sends read requests through the active host connection.
- The collector does not retrieve, retain, or render live environment-variable values. A server-side non-null filter establishes current-value presence; lookup IDs are normalised across Web API and SDK response formats. Failed checks are reported as unknown. Secure plug-in configuration is excluded from documentation.
- The package manifest and `index.html` contain network/CSP configuration for the optional GitHub release update check. Core generation does not depend on GitHub availability.

These are implementation statements, not a certification of the host's isolation, permission enforcement, or the security of every exported document.

## Build and Validation

The repository-defined build and checks are:

```powershell
npm.cmd run build
npm.cmd run validate:offline
npm.cmd run validate:dist
npm.cmd test
```

`npm run validate` also invokes the PPTB package validator with its network checks. `npm test` runs the offline package validation, lint, TypeScript, unit tests, contrast audit, build, and distribution validation. Check [`package.json`](../../package.json) for the authoritative current scripts. After building, loading the package through PPTB's local-tool workflow and exercising both input modes and export paths remains a host-validation step.

## Host Validation and Known Limitations

- Verify active-connection behaviour, permissions, settings persistence, theme synchronisation, and exports in the PPTB version used for release.
- Verify host-side screen-reader behaviour, forced-colours mode, zoom/reflow, and keyboard interactions; these are not covered by the repository's test runner.
- A blank tool icon has been reported for some PPTB installations. Its cause and applicability to a given host build are not confirmed by this repository; check the current host and avoid assuming a tool-side workaround.
- The `powerplatformAPI` environment-management service is used only by the Environment Appendix collector and only when `connection.enabledForPowerPlatformAPI` is true. Without it, the appendix records a note and uses Dataverse data only. Response shapes should be confirmed against the target PPTB version.

Where host behaviour differs by version or tenant, report it as a host-validation result or known limitation with the tested version; do not infer general platform support from one environment.
