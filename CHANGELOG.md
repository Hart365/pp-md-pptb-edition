# Changelog

This file records release highlights. For complete details, use the repository history and release information.

## 1.2.1 - 2026-10-26

- Replace regex-based build HTML rewriting with quote-aware, comment-aware tag and attribute parsing to address two High Code Scanning alerts.
- Handle whitespace in script closing tags while preserving PPTB's classic-script loading and local-resource attribute requirements.
- Add regression tests for script relocation, comments, and attribute handling.

## 1.2.0 - 2026-10-23

- Standardise documentation and displayed Dataverse/environment parameter labels on UK English, preserving technical identifiers and source values.
- Alphabetise every Environment Appendix grouping consistently in Markdown and Excel.
- Count enabled environment users through direct security roles or non-default teams, report application users separately, and distinguish unavailable tenant-directory totals.
- Validate distinct inventory totals, avoid false zero/lower-bound results, and add confirmed custom and unclassified counts using publisher namespaces.

- Collect solution-scoped global option-set definitions, including Boolean choices, descriptions, colours, and numeric option values.
- Document site maps, selected columns, image configurations, and metadata-resolved extended solution component records.
- Collect selected email-template metadata without retrieving template body content.
- Correct shared component-type labels and retain explicit details for collection failures.
- Preserve component details and global choices in consolidated, category, and Excel exports.
- Correct environment-variable current-value detection for Web API and SDK lookups; show unknown on failed checks without retrieving live values.
- Add the **Solution only + environment appendix** collection policy. The Environment Appendix (identity, settings, Power Platform settings, languages, currencies, inventory counts, installed solutions and packages, publishers, business units) appears only in the All Selected Solutions document and a matching Excel **Environment** worksheet. People data is counts only.
- Add cancellation for ZIP parsing and Dataverse collection.
- Batch plug-in step and image retrieval to remove per-assembly queries.
- Bound the Mermaid SVG cache with a least-recently-used limit.
- Split the Dataverse collector and Markdown generator into focused modules with stable re-exports.
- Record the single-bundle size as accepted for PPTB compatibility (bundle splitting not required).

## 1.1.9

- Corrected per-table metadata source labels.
- Expanded table-property collection and ZIP parsing.
- Added optional per-solution missing import-dependency reporting using ZIP manifest data or Dataverse `RetrieveMissingDependencies`.
- Added dependency detail to Excel output and compact table-property sections to table worksheets.

## 1.1.8

- Bundled libraries into the distribution and moved them to development dependencies; the npm package does not declare runtime dependencies.
- Recorded PPTB installation and icon-rendering reports as host-version-dependent issues.

## 1.1.7

- Added the consolidated multi-solution document and companion diagrams.
- Added a PPTB-compatible classic bundle, GitHub-flavoured Markdown, and per-table Excel worksheets with navigation.
- Added batch HTML, PDF, and Excel exports and background Mermaid rendering.

## Earlier releases

Earlier release details are available in the repository history.
