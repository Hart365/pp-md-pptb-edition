# PPTB Platform Reference

Source: Power Platform ToolBox tool-development documentation. Verified 2026-09-03.

## Architecture [DOC]

Tools run in sandboxed iframes. The host injects `window.toolboxAPI`, `window.dataverseAPI`, and `window.powerplatformAPI`. Do not handle tokens; use the injected clients. External network access requires `cspExceptions`, which PP-MD must not declare because dependencies, including Mermaid, are bundled locally.

## Connections [DOC]

Use `toolboxAPI.connections.getActiveConnection()` and, where multi-connection support is enabled, `getSecondaryConnection()`. Every Dataverse call takes a trailing `connectionTarget` of `primary` or `secondary`; thread it through every collector. A connection must have `enabledForPowerPlatformAPI` before calling `powerplatformAPI`.

## Manifest [DOC]

Require scoped `name`, semver `version`, `displayName`, `description`, `main`, top-level `icon`, `license`, contributors, and `configurations.repository`. Set `features.minAPI` to at least `1.2.0`. The icon is relative to `dist`, and SVG shapes must use `fill="currentColor"` or `stroke="currentColor"`. Run `pptb-validate package.json` before release.

## Settings, Files, Themes [DOC]

Persist preferences through `toolboxAPI.settings` using namespaced keys, never localStorage. Export with `toolboxAPI.fileSystem.saveFile()`. Drive light/dark themes from `toolboxAPI.utils.getCurrentTheme()` and handle `settings:updated` events. Register host event listeners once and multiplex subscribers.

## Error Handling [DOC]

Documentation collection must continue after a component failure and surface failures in the Warnings section. Retry only HTTP 429 with backoff. Map 401 to reconnect guidance, 403 to permissions, and 429 to a retry message. Never display stack traces. Never render secret environment-variable values or secure plug-in configuration.

## Build And Test [DOC]

Run `npm run build`, then use PPTB Debug > Load Local Tool and select the tool root. Reload the tool tab after changes. PDF export has no documented iframe API and needs a separate print/export design.