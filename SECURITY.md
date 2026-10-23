# Security Policy

## Reporting a vulnerability

Please do not report suspected vulnerabilities in a public issue or discussion. Use GitHub's private vulnerability reporting for this repository if it is enabled. If private reporting is unavailable, contact the maintainers through a private channel linked from the repository or maintainer profile.

Include the affected version, a concise description, and safe steps to reproduce. Do not include real customer solution files, personal data, credentials, access tokens, or live environment-variable values. Coordinate public disclosure with the maintainers after a fix or mitigation is available.

## Security and privacy notes

- Local Solutions mode parses user-selected solution ZIP files in the client application; this repository does not implement a server upload path.
- Dataverse Connected mode performs read-only collection through the active Power Platform ToolBox connection. Requests use the current user's host-provided connection and permissions.
- The application is designed not to query or render credentials, secure plug-in configuration, or live environment-variable values. Connected reporting uses a non-null filter without selecting current values; failed presence checks are shown as unknown. Extended component collection selects configuration metadata rather than arbitrary payloads and excludes secured fields.
- Generated documents may contain solution metadata and should be handled according to the user's organisational data-protection requirements.
- The optional Environment Appendix policy reads environment-level metadata (organisation settings, languages, currencies, installed solutions and packages, publishers, business-unit names, and inventory counts). Users and teams are reported only as aggregate counts. Power Platform API environment settings are read only when the connection enables that API, and only primitive setting values are retained. The appendix appears only in the consolidated All Selected Solutions document and its exports.
- Environment-user aggregates qualify enabled accounts by role/non-default-team membership without returning user identifiers, names or email addresses. No Microsoft Entra directory user list is requested. Non-person inventory counting reads only component primary keys and namespace fields for de-duplication and publisher classification; arbitrary business-record contents are not collected.

These notes describe intended and repository-visible behaviour; they are not a security certification of Power Platform ToolBox, Dataverse, or exported documents.
