# Contributing

Thanks for helping improve PP-MD - PPTB Edition.

## Before making a change

- Check existing issues and discussions to avoid duplicating work.
- Keep changes scoped and avoid including generated solution documents, exports, credentials, or other sensitive data.
- For documentation updates, check statements against the current source and package manifest. Identify host- or tenant-dependent behaviour as something to validate, not as a platform guarantee.

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

## Pull requests

- Explain the user-visible change and any important limitations.
- List the validation commands run and the checks that still require a PPTB host.
- Keep unrelated files and generated build/export artefacts out of the change.
- Update the [README](README.md), [changelog](CHANGELOG.md), or relevant [design documentation](docs/high-level-design.md) when behaviour or user guidance changes.
