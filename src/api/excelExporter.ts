import * as XLSX from 'xlsx-js-style';
import type { ParsedSolution } from '../types/solution';

interface SheetDefinition {
  name: string;
  headers: string[];
  rows: Array<Array<string | number>>;
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

function applySheetFormatting(sheet: XLSX.WorkSheet, headers: string[], rows: SheetDefinition['rows']): void {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:A1');
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const headerCell = sheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (headerCell) headerCell.s = headerStyle;
  }
  sheet['!cols'] = headers.map((header, index) => {
    const longest = Math.max(
      header.length,
      ...rows.map((row) => text(row[index]).length),
    );
    return { wch: Math.min(Math.max(longest + 2, 12), 48) };
  });
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
}

function makeSheet(definition: SheetDefinition): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet([definition.headers, ...definition.rows]);
  applySheetFormatting(sheet, definition.headers, definition.rows);
  return sheet;
}

function buildSheets(solution: ParsedSolution): SheetDefinition[] {
  const sheets: SheetDefinition[] = [
    {
      name: 'Overview',
      headers: ['Property', 'Value'],
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
      headers: ['Table', 'Display Name', 'Description', 'Custom', 'Ownership', 'Primary Attribute', 'Columns', 'Relationships'],
      rows: solution.entities.map((entity) => [
        entity.logicalName,
        text(entity.displayName),
        text(entity.description),
        entity.isCustom ? 'Yes' : 'No',
        text(entity.ownershipType),
        text(entity.primaryAttributeName),
        entity.attributes.length,
        entity.relationships.length,
      ]),
    },
    {
      name: 'Columns',
      headers: ['Table', 'Column', 'Display Name', 'Type', 'Required', 'Custom', 'Primary Name', 'Lookup Target', 'Option Set'],
      rows: solution.entities.flatMap((entity) => entity.attributes.map((attribute) => [
        entity.logicalName,
        attribute.name,
        text(attribute.displayName),
        attribute.type,
        attribute.required ? 'Yes' : 'No',
        attribute.isCustom ? 'Yes' : 'No',
        attribute.isPrimaryName ? 'Yes' : 'No',
        text(attribute.lookupTarget),
        text(attribute.optionSetName),
      ])),
    },
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

  return sheets.filter((sheet) => sheet.rows.length > 0 || sheet.name === 'Overview');
}

export function createSolutionWorkbook(solution: ParsedSolution): Blob {
  const workbook = XLSX.utils.book_new();
  buildSheets(solution).forEach((definition) => {
    const sheet = makeSheet(definition);
    XLSX.utils.book_append_sheet(workbook, sheet, definition.name);
  });
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
