# Contributing

Thanks for helping improve PP-MD - PPTB Edition.

You don't need to know the whole codebase to make a useful contribution. A clear bug report, an Accessibility barrier you've experienced, or a better explanation in the docs all help. Please read the [Code of Conduct](CODE_OF_CONDUCT.md); there's room here for different experiences and levels of knowledge.

## Before making a change

- Check existing issues and discussions to avoid duplicating work.
- Keep changes scoped and avoid including generated solution documents, exports, credentials, or other sensitive data.
- For documentation updates, check statements against the current source and package manifest. Identify host- or tenant-dependent behaviour as something to validate, not as a platform guarantee.

## Raising an Issue

Use the [Issue chooser](https://github.com/Hart365/pp-md-pptb-edition/issues/new/choose) for a bug report, a feature or improvement idea, or an Accessibility barrier. Tell me what you were trying to do and what would make it work better. You don't need to arrive with a fix.

For access barriers, see the [Accessibility statement](ACCESSIBILITY.MD) for reporting guidance, known limitations, and an alternative contact route. Don't post suspected security vulnerabilities publicly; follow the [Security policy](SECURITY.md).

## Development setup

Requirements: Node.js 20 or later and npm.

```powershell
npm.cmd ci
npm.cmd run dev
```

For connected-mode or host integration work, use a suitable Power Platform ToolBox test environment. Local browser development does not provide the PPTB connection or host file-system APIs.

## Validation

Run the repository's standard checks before submitting a change:

```powershell
npm.cmd test
```

Useful focused checks include `npm.cmd run lint`, `npm.cmd run type-check`, `npm.cmd run test:unit`, `npm.cmd run test:contrast`, `npm.cmd run validate:offline`, and `npm.cmd run validate:dist`. Run `npm.cmd run validate` when network access is available and official URL checks are needed.

Changes to connected collection, document rendering, or exports should include focused regression tests where practical. Host-dependent behaviour should be identified and validated in PPTB; do not describe a host-only test as covered by the repository test suite.

### Accessibility checks

For interface changes, check the affected task with a keyboard: logical focus order, visible focus, no traps, and focus returning sensibly when menus or dialogs close. Check accessible names and whether a screen reader announces relevant state, progress, and errors without unexpectedly moving focus.

Check light and dark themes, Windows forced colours, text resizing and zoom/reflow (including 200% text and 400% zoom / a 320 CSS-pixel viewport), and reduced-motion settings where relevant. Genuine data tables and diagrams may need two-dimensional scrolling, but surrounding controls and content should remain usable.

For generated documents and exports, consider headings, table structure, reading order, meaningful links, and text alternatives to diagrams. Don't assume a visually tidy PDF is an accessible one.

Run `npm.cmd run test:contrast` when changing colours or theme tokens, alongside the relevant code checks. It covers selected token pairs, not every rendered state or exported document. Record the browser or PPTB version, assistive technology, checks performed, and any gaps in your PR. If you couldn't test a combination, say so; that's more useful than a pass that hasn't been verified.

## Pull requests

- Explain the user-visible change and any important limitations.
- List the validation commands run and the checks that still require a PPTB host.
- Keep unrelated files and generated build/export artefacts out of the change.
- Update the [README](README.md), [changelog](CHANGELOG.md), or relevant [design documentation](docs/high-level-design.md) when behaviour or user guidance changes.
