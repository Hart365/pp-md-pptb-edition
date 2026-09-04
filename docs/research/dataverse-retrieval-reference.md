# Dataverse Retrieval Reference

Source: Microsoft Learn Dataverse Web API and Power Platform REST API references. Verified 2026-09-03.

## Core Rules [DOC]

- Use `dataverseAPI`; never construct authenticated requests or handle tokens.
- Every call receives the selected `connectionTarget`.
- Always use `$select`; metadata queries do not page.
- Add `LabelLanguages=1033` to metadata queries unless multilingual output is requested.
- Follow OData next links, use deterministic ordering, and retry only HTTP 429.
- Collect per-section failures as warnings rather than aborting the documentation run.

## Solution Scope [DOC]

List solutions with `solutionid,uniquename,friendlyname,version,ismanaged,description,installedon,isvisible` and publisher fields. Enumerate selected-solution components using:

```text
solutioncomponents?$filter=_solutionid_value eq {solutionId}
&$select=solutioncomponentid,objectid,componenttype,rootcomponentbehavior,ismetadata
```

Route `objectid` by `componenttype`; it is the primary key of the component record. Do not append environment-wide tables merely because they are referenced by a solution table.

## Metadata [DOC]

Use `getAllEntitiesMetadata` only to resolve solution entity `MetadataId` values, then call `getEntityMetadata` and `getEntityRelatedMetadata` for each selected table. Collect attributes, keys, and all relationship kinds. Type-specific attribute properties require concrete metadata casts; do not assume base `Attributes` exposes them.

## Records [DOC]

Read workflows, app modules, canvas apps, system forms, saved queries, web resources, roles, field security profiles, plug-in assemblies/types/steps, reports, connection references, environment-variable definitions, and dependencies only for component IDs or the selected solution ID. Use `workflow.clientdata` for modern-flow definitions. Read `roleprivileges`, `privilege`, and `fieldpermissions` for security detail. Never select `sdkmessageprocessingstepsecureconfig`; secret variable values are never rendered.

## Environment [DOC]

Environment settings and capacity require `connection.enabledForPowerPlatformAPI` and `powerplatformAPI.EnvironmentManagement`. Degrade to an availability note if the connection is not enabled.

## Open Verification Items

- `[VERIFY]` Attribute `SourceType` integer mapping.
- `[VERIFY]` Role privilege depth bitmask decoding.
- `[VERIFY]` custom `Prefer` header forwarding by `queryData`.
- `[UNDOC]` `msdyn_solutioncomponentsummary`; feature-detect through CSDL before use.