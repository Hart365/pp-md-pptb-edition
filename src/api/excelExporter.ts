import * as XLSX from 'xlsx-js-style';
import type { ParsedSolution, EntityDefinition } from '../types/solution';
import type { DocumentContext } from '../generator/markdownGenerator';

type CellValue = string | number;

interface SheetLink {
  /** Zero-based column index within each data row that carries the link. */
  column: number;
  /** Target worksheet name for each data row (same order as rows). */
  targets: string[];
}

interface SheetDefinition {
  name: string;
  headers: string[];
  rows: CellValue[][];
  link?: SheetLink;
  /** Optional key/value block rendered above the main table. */
  preamble?: { title: string; rows: CellValue[][] };
  /** Optional heading row with a "back" link to another worksheet. */
  title?: { text: string; backLinkSheet?: string };
}

const backButtonStyle = {
  fill: { fgColor: { rgb: 'DBEAFE' } },
  font: { bold: true, color: { rgb: '1D4ED8' }, underline: true },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: {
    top: { style: 'thin', color: { rgb: '93C5FD' } },
    bottom: { style: 'thin', color: { rgb: '93C5FD' } },
    left: { style: 'thin', color: { rgb: '93C5FD' } },
    right: { style: 'thin', color: { rgb: '93C5FD' } },
  },
};

const sheetTitleStyle = {
  font: { bold: true, sz: 14, color: { rgb: '1E3A8A' } },
  alignment: { vertical: 'center' },
};

const wrapStyle = { alignment: { wrapText: true, vertical: 'top' } };

const DESCRIPTION_COLUMN_WIDTH = 60;

function isDescriptionHeader(header: string): boolean {
  return header.trim().toLowerCase() === 'description';
}

const linkStyle = {
  font: { color: { rgb: '1D4ED8' }, underline: true },
};

const sectionTitleStyle = {
  font: { bold: true, sz: 12, color: { rgb: '1E3A8A' } },
};

const MAX_SHEET_NAME_LENGTH = 31;

function compareFirstColumn(a: CellValue[], b: CellValue[]): number {
  const left = a[0];
  const right = b[0];
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return text(left).localeCompare(text(right), undefined, { sensitivity: 'base', numeric: true });
}

/** Sorts rows on the first column, keeping any per-row link targets aligned. */
function sortDefinition(definition: SheetDefinition): SheetDefinition {
  const indexed = definition.rows.map((row, index) => ({ row, target: definition.link?.targets[index] }));
  indexed.sort((x, y) => compareFirstColumn(x.row, y.row));
  return {
    ...definition,
    rows: indexed.map((entry) => entry.row),
    link: definition.link
      ? { column: definition.link.column, targets: indexed.map((entry) => entry.target ?? '') }
      : undefined,
  };
}

/** Produces a valid, unique Excel worksheet name (max 31 chars, no []:*?/\ ). */
function uniqueSheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '');
  if (!base || base.toLowerCase() === 'history') base = base ? `${base} Table` : 'Table';
  base = base.slice(0, MAX_SHEET_NAME_LENGTH).trim();

  let candidate = base;
  let counter = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`;
    candidate = `${base.slice(0, MAX_SHEET_NAME_LENGTH - suffix.length).trim()}${suffix}`;
    counter += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function entityDisplayName(entity: EntityDefinition): string {
  return text(entity.displayName).trim() || entity.logicalName;
}

function hasDocumentContext(context: DocumentContext | undefined): context is DocumentContext {
  if (!context) return false;
  return Object.values(context).some((value) => typeof value === 'string' && value.trim().length > 0);
}

function documentContextRows(context: DocumentContext): CellValue[][] {
  return [
    ['Client', context.client],
    ['Contract', context.contract],
    ['Contract ID/SoW', context.sow],
    ['Project', context.project],
    ['Sprint', context.sprint],
    ['Release Date', context.releaseDate],
  ]
    .map(([label, value]) => [label, text(value).trim()])
    .filter(([, value]) => value.length > 0);
}

const headerStyle = {
  fill: { fgColor: { rgb: '1D4ED8' } },
  font: { bold: true, color: { rgb: 'FFFFFF' } },
  alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
  border: { bottom: { style: 'medium', color: { rgb: '93C5FD' } } },
};

function text(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  return String(value);
}

function internalLink(sheetName: string): string {
  return `#'${sheetName.replace(/'/g, "''")}'!A1`;
}

function makeSheet(definition: SheetDefinition): XLSX.WorkSheet {
  const aoa: CellValue[][] = [];
  let titleRows = 0;
  if (definition.title) {
    aoa.push(definition.title.backLinkSheet
      ? [definition.title.text, `← Back to ${definition.title.backLinkSheet}`]
      : [definition.title.text]);
    aoa.push([]);
    titleRows = aoa.length;
  }
  const hasPreamble = Boolean(definition.preamble && definition.preamble.rows.length > 0);
  if (definition.preamble && hasPreamble) {
    aoa.push([definition.preamble.title]);
    aoa.push(...definition.preamble.rows);
    aoa.push([]);
  }
  const headerRow = aoa.length;
  aoa.push(definition.headers, ...definition.rows);

  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  if (definition.title) {
    const titleCell = sheet[XLSX.utils.encode_cell({ r: 0, c: 0 })];
    if (titleCell) titleCell.s = sheetTitleStyle;
    if (definition.title.backLinkSheet) {
      const backCell = sheet[XLSX.utils.encode_cell({ r: 0, c: 1 })];
      if (backCell) {
        backCell.l = { Target: internalLink(definition.title.backLinkSheet), Tooltip: `Return to the ${definition.title.backLinkSheet} worksheet` };
        backCell.s = backButtonStyle;
      }
    }
    sheet['!rows'] = [{ hpt: 24 }];
  }

  if (hasPreamble) {
    const titleCell = sheet[XLSX.utils.encode_cell({ r: titleRows, c: 0 })];
    if (titleCell) titleCell.s = sectionTitleStyle;
    for (let r = titleRows + 1; r < headerRow - 1; r += 1) {
      const labelCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
      if (labelCell) labelCell.s = { font: { bold: true } };
    }
  }

  definition.headers.forEach((header, column) => {
    if (!isDescriptionHeader(header)) return;
    definition.rows.forEach((_, index) => {
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1 + index, c: column })];
      if (cell) cell.s = { ...(cell.s ?? {}), ...wrapStyle };
    });
  });

  definition.headers.forEach((_, column) => {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: headerRow, c: column })];
    if (headerCell) headerCell.s = headerStyle;
  });

  if (definition.link) {
    const { column, targets } = definition.link;
    targets.forEach((target, index) => {
      if (!target) return;
      const cell = sheet[XLSX.utils.encode_cell({ r: headerRow + 1 + index, c: column })];
      if (!cell) return;
      cell.l = { Target: internalLink(target), Tooltip: `Go to ${target}` };
      cell.s = linkStyle;
    });
  }

  const titleRow: CellValue[] = definition.title
    ? [definition.title.text, definition.title.backLinkSheet ? `← Back to ${definition.title.backLinkSheet}` : '']
    : [];
  const allRows = [titleRow, ...(definition.preamble?.rows ?? []), ...definition.rows];
  sheet['!cols'] = definition.headers.map((header, index) => {
    if (isDescriptionHeader(header)) return { wch: DESCRIPTION_COLUMN_WIDTH };
    const longest = Math.max(header.length, ...allRows.map((row) => text(row[index]).length));
    return { wch: Math.min(Math.max(longest + 2, 12), 48) };
  });

  const tableRange = {
    s: { r: headerRow, c: 0 },
    e: { r: headerRow + definition.rows.length, c: Math.max(definition.headers.length - 1, 0) },
  };
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range(tableRange) };
  sheet['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 };
  return sheet;
}

const COLUMN_HEADERS = ['Display Name', 'Schema Name', 'Type', 'Required', 'Custom', 'Primary Name', 'Lookup Target', 'Option Set', 'Description'];

function optionSetSummary(attribute: EntityDefinition['attributes'][number]): string {
  if (attribute.optionSetName) return attribute.optionSetName;
  if (!attribute.options || attribute.options.length === 0) return '';
  return `Local: ${attribute.options.map((option) => `${option.label} (${option.value})`).join(', ')}`;
}

function buildSheets(solution: ParsedSolution, documentContext?: DocumentContext): SheetDefinition[] {
  const usedNames = new Set(
    ['Overview', 'Tables', 'Relationships', 'Processes', 'Apps', 'Integration', 'Security', 'Automation']
      .map((name) => name.toLowerCase()),
  );

  const tableSheets = [...solution.entities]
    .sort((a, b) => entityDisplayName(a).localeCompare(entityDisplayName(b), undefined, { sensitivity: 'base', numeric: true }))
    .map((entity) => ({ entity, sheetName: uniqueSheetName(entityDisplayName(entity), usedNames) }));
  const sheetNameByEntity = new Map(tableSheets.map(({ entity, sheetName }) => [entity, sheetName]));

  const sheets: SheetDefinition[] = [
    {
      name: 'Overview',
      headers: ['Property', 'Value'],
      preamble: hasDocumentContext(documentContext)
        ? { title: 'Document Information', rows: documentContextRows(documentContext) }
        : undefined,
      rows: [
        ['Solution', solution.metadata.displayName],
        ['Unique Name', solution.metadata.uniqueName],
        ['Version', solution.metadata.version],
        ['Publisher', solution.metadata.publisherName],
        ['Managed', solution.metadata.isManaged ? 'Yes' : 'No'],
        ['Tables', solution.entities.length],
        ['Processes', solution.processes.length],
        ['Apps', solution.apps.length],
        ['Environment Variables', solution.environmentVariables.length],
        ['Connection References', solution.connectionReferences.length],
        ['Warnings', solution.warnings.length],
      ],
    },
    {
      name: 'Tables',
      headers: ['Display Name', 'Table', 'Description', 'Custom', 'Ownership', 'Primary Attribute', 'Columns', 'Relationships'],
      rows: solution.entities.map((entity) => [
        entityDisplayName(entity),
        entity.logicalName,
        text(entity.description),
        entity.isCustom ? 'Yes' : 'No',
        text(entity.ownershipType),
        text(entity.primaryAttributeName),
        entity.attributes.length,
        entity.relationships.length,
      ]),
      link: { column: 0, targets: solution.entities.map((entity) => sheetNameByEntity.get(entity) ?? '') },
    },
  ];

  const supportingSheets: SheetDefinition[] = [
    {
      name: 'Relationships',
      headers: ['Name', 'Type', 'Referenced Table', 'Referencing Table', 'Referencing Column', 'Referenced Column', 'Delete', 'Assign', 'Reparent'],
      rows: solution.entities.flatMap((entity) => entity.relationships.map((relationship) => [
        relationship.name,
        relationship.type,
        relationship.referencedEntity,
        relationship.referencingEntity,
        text(relationship.referencingAttribute),
        text(relationship.referencedAttribute),
        text(relationship.cascadeDelete),
        text(relationship.cascadeAssign),
        text(relationship.cascadeReparent),
      ])),
    },
    {
      name: 'Processes',
      headers: ['Name', 'Display Name', 'Category', 'Primary Table', 'Status', 'Trigger', 'Connectors', 'Environment Variables'],
      rows: solution.processes.map((process) => [
        process.name,
        text(process.displayName),
        process.category,
        text(process.primaryEntity),
        process.isActivated ? 'Activated' : 'Draft/Unknown',
        text(process.flowTrigger || process.triggerType),
        (process.flowConnectors ?? []).join(', '),
        (process.flowEnvironmentVariables ?? []).join(', '),
      ]),
    },
    {
      name: 'Apps',
      headers: ['Name', 'Display Name', 'Type', 'Tables', 'Sitemap Areas', 'Connectors', 'Enabled'],
      rows: solution.apps.map((app) => [
        app.uniqueName || app.name,
        text(app.displayName),
        app.appType,
        (app.entities ?? []).join(', '),
        (app.sitemapAreas ?? []).join(', '),
        (app.connectors ?? []).join(', '),
        app.isEnabled === false ? 'No' : 'Yes',
      ]),
    },
    {
      name: 'Integration',
      headers: ['Kind', 'Name', 'Display Name', 'Type', 'Connector', 'Has Current Value', 'Default Value'],
      rows: [
        ...solution.connectionReferences.map((reference) => ['Connection Reference', reference.name, text(reference.displayName), '', text(reference.connectorDisplayName || reference.connectorId), '', '']),
        ...solution.environmentVariables.map((variable) => ['Environment Variable', variable.schemaName, text(variable.displayName), text(variable.type), '', variable.hasCurrentValue ? 'Yes' : 'No', text(variable.defaultValue)]),
      ],
    },
    {
      name: 'Security',
      headers: ['Role/Profile', 'Kind', 'Privilege or Attribute', 'Depth/Permission'],
      rows: [
        ...solution.securityRoles.flatMap((role) => role.privileges.map((privilege) => [role.name, 'Role', privilege.privilegeName, privilege.depth])),
        ...solution.fieldSecurityProfiles.flatMap((profile) => profile.permissions.map((permission) => [profile.name, 'Field Security Profile', permission.attributeName, `Read:${permission.canRead ? 'Y' : 'N'} Update:${permission.canUpdate ? 'Y' : 'N'} Create:${permission.canCreate ? 'Y' : 'N'}`])),
      ],
    },
    {
      name: 'Automation',
      headers: ['Kind', 'Name', 'Display Name', 'Description', 'Source', 'State/Mode'],
      rows: [
        ...solution.agents.map((item) => ['Agent', item.name, text(item.displayName), text(item.description), item.sourcePath, text(item.agentType)]),
        ...solution.aiModels.map((item) => ['AI Model', item.name, text(item.displayName), text(item.description), item.sourcePath, text(item.provider)]),
        ...solution.desktopFlows.map((item) => ['Desktop Flow', item.name, text(item.displayName), text(item.description), item.sourcePath, item.isEnabled ? 'Enabled' : 'Disabled']),
        ...solution.dataflows.map((item) => ['Dataflow', item.name, text(item.displayName), text(item.description), item.sourcePath, text(item.refreshMode)]),
        ...solution.customApis.map((item) => ['Custom API', item.name, text(item.displayName), text(item.description), item.sourcePath, item.isFunction ? 'Function' : 'Action']),
        ...solution.offlineProfiles.map((item) => ['Offline Profile', item.name, text(item.displayName), text(item.description), item.sourcePath, text(item.profileType)]),
      ],
    },
  ];

  const perTableSheets: SheetDefinition[] = tableSheets.map(({ entity, sheetName }) => ({
    name: sheetName,
    title: { text: `${entityDisplayName(entity)} (${entity.logicalName})`, backLinkSheet: 'Tables' },
    headers: COLUMN_HEADERS,
    rows: entity.attributes.map((attribute) => [
      text(attribute.displayName).trim() || attribute.name,
      attribute.name,
      attribute.type,
      attribute.required ? 'Yes' : 'No',
      attribute.isCustom ? 'Yes' : 'No',
      attribute.isPrimaryName ? 'Yes' : 'No',
      text(attribute.lookupTarget),
      optionSetSummary(attribute),
      text(attribute.description),
    ]),
  }));

  // Per-table tabs go last so the summary sheets stay together at the front of the workbook.
  return [
    ...sheets.filter((sheet) => sheet.rows.length > 0 || sheet.name === 'Overview'),
    ...supportingSheets.filter((sheet) => sheet.rows.length > 0),
    ...perTableSheets,
  ].map(sortDefinition);
}

export function createSolutionWorkbook(solution: ParsedSolution, documentContext?: DocumentContext): Blob {
  const workbook = XLSX.utils.book_new();
  buildSheets(solution, documentContext).forEach((definition) => {
    const sheet = makeSheet(definition);
    XLSX.utils.book_append_sheet(workbook, sheet, definition.name);
  });
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
