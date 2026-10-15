# PPTB Platform Reference

Source: Power Platform ToolBox tool-development documentation. Verified 2026-09-03.

## Architecture [DOC]

Tools run in sandboxed iframes. The host injects `window.toolboxAPI`, `window.dataverseAPI`, and `window.powerplatformAPI`. Do not handle tokens; use the injected clients. Declare only CSP exceptions required by runtime network features; PP-MD uses one optional `api.github.com` exception for its user-initiated update check. Dependencies, including Mermaid, are bundled locally and need no external network access.

## Connections [DOC]

Use `toolboxAPI.connections.getActiveConnection()` and, where multi-connection support is enabled, `getSecondaryConnection()`. Every Dataverse call takes a trailing `connectionTarget` of `primary` or `secondary`; thread it through every collector. A connection must have `enabledForPowerPlatformAPI` before calling `powerplatformAPI`.

## Manifest [DOC]

Require scoped `name`, semver `version`, `displayName`, `description`, `main`, top-level `icon`, `license`, contributors, `configurations.repository`, and `configurations.readmeUrl`. Set `features.connectionRequirement` to `optional` for tools that also run without Dataverse, and set `features.minAPI` to the lowest host API version required. The icon is relative to `dist` and must be a valid SVG with a `viewBox`. PP-MD ships its full-colour icon at `icons/pp-md.svg`; a monochrome `currentColor` icon was tried in 1.1.6 and did not render visibly in PPTB, so it was reverted. PPTB serves the icon as `pptb-webview://<toolId>/<icon>` from `<tool path>/dist/` and renders it as a CSS mask, so only its shape is shown. Known host bug (PPTB `main` and `dev`, checked 2026-10): the host UI runs from `file://`, CSS `mask-image` loads in CORS mode, and `pptb-webview` is registered with `corsEnabled: false`, so Chromium blocks every relative SVG tool icon (console: "Access to image at 'pptb-webview://…' from origin 'file://' has been blocked by CORS policy"). The `new Image()` fallback probe is not CORS-mode, so it succeeds and the icon area stays blank instead of falling back. This affects all tools with relative SVG icons and cannot be fixed tool-side: PPTB validation rejects HTTP(S) icon URLs and the resolver ignores `data:` URIs. Keep the manifest compliant and track the host fix (CORS-enable the scheme and add `Access-Control-Allow-Origin`, or render with `<img>`, or probe with `crossOrigin = "anonymous"`). Run `npm run validate` before release and use `npm run validate:offline` in CI to avoid transient URL-check failures.

## Settings, Files, Themes [DOC]

Persist preferences through `toolboxAPI.settings` using namespaced keys, never localStorage. Export with `toolboxAPI.fileSystem.saveFile()`. Drive light/dark themes from `toolboxAPI.utils.getCurrentTheme()` and handle `settings:updated` events. Register host event listeners once and multiplex subscribers.

## Error Handling [DOC]

Documentation collection must continue after a component failure and surface failures in the Warnings section. Retry only HTTP 429 with backoff. Map 401 to reconnect guidance, 403 to permissions, and 429 to a retry message. Never display stack traces. Never render secret environment-variable values or secure plug-in configuration.

## Build And Test [DOC]

Run `npm run build`, then use PPTB Debug > Load Local Tool and select the tool root. Vite tools must emit relative asset URLs and a single classic IIFE bundle; PPTB's sandboxed iframe does not reliably load Vite's default ES-module output. With Vite 8 (Rolldown), output options must live under `build.rolldownOptions.output` (`format: 'iife'`, `codeSplitting: false`); settings under `build.rollupOptions.output` are overridden and silently produce an ES-module bundle. Any `import.meta` left in a classic script is a SyntaxError that leaves a blank white screen, so `vite.config.ts` polyfills `import.meta.url`/`import.meta.resolve` from `document.currentScript.src`, and `npm run validate:dist` fails if the bundle contains `import.meta` or does not parse as a classic script. Reload the tool tab after changes. PDF export has no documented iframe API and needs a separate print/export design.