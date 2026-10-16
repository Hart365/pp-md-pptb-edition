import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { AttributeType } from '../types/solution';
import { buildTableMetadataBlocks, createSolutionWorkbook, NOT_AVAILABLE_PREFIX } from './excelExporter';
import type { ParsedSolution } from '../types/solution';

const solution: ParsedSolution = {
  metadata: { uniqueName: 'sample', displayName: 'Sample', version: '1.0.0.0', publisherName: 'Test', isManaged: false },
  entities: [], optionSets: [], forms: [], views: [], processes: [], apps: [], webResources: [],
  securityRoles: [], fieldSecurityProfiles: [], connectionReferences: [],
  environmentVariables: [{ name: 'Api Url', schemaName: 'sample_ApiUrl', type: 'String', hasCurrentValue: true, defaultValue: 'https://example.test' }],
  emailTemplates: [], reports: [], dashboards: [], pluginAssemblies: [], warnings: [],
  agents: [], aiModels: [], desktopFlows: [], dataflows: [], customApis: [], offlineProfiles: [],
};

describe('Excel solution export', () => {
  it('creates a non-empty styled workbook blob with an integration sheet', () => {
    const workbook = createSolutionWorkbook(solution);
    expect(workbook.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(workbook.size).toBeGreaterThan(100);
  });

  const withTables: ParsedSolution = {
    ...solution,
    entities: [
      {
        name: 'sample_zebra', logicalName: 'sample_zebra', displayName: 'Zebra', isCustom: true, relationships: [],
        attributes: [
          { name: 'sample_name', displayName: 'Name', type: 'String', required: true, isCustom: true, isPrimaryName: true },
          { name: 'sample_age', displayName: 'Age', type: 'Integer', required: false, isCustom: true },
        ],
      },
      {
        name: 'sample_aardvark', logicalName: 'sample_aardvark', displayName: 'Aardvark', isCustom: true, relationships: [],
        attributes: [{ name: 'sample_title', displayName: 'Title', type: 'String', required: false, isCustom: true }],
      },
    ],
  } as ParsedSolution;

  function columnHeaderIndex(rows: string[][]): number {
    return rows.findIndex((row) => row[0] === 'Display Name' && row[1] === 'Schema Name');
  }

  async function readWorkbook(blob: Blob): Promise<XLSX.WorkBook> {
    return XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
  }

  it('creates one worksheet per table instead of a consolidated Columns sheet', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables));
    expect(workbook.SheetNames).toContain('Tables');
    expect(workbook.SheetNames).not.toContain('Columns');
    expect(workbook.SheetNames).toContain('Aardvark');
    expect(workbook.SheetNames).toContain('Zebra');

    const zebraRows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Zebra, { header: 1 }).filter((row) => row.length > 0);
    expect(zebraRows[0][0]).toBe('Table Name(s)');
    expect(zebraRows[0][1]).toBe('Zebra (sample_zebra)');
    const header = columnHeaderIndex(zebraRows);
    expect(header).toBeGreaterThan(0);
    expect(zebraRows.slice(header + 1).map((row) => row[0])).toEqual(['Age', 'Name']);
    expect(zebraRows.slice(header + 1).map((row) => row[1])).toEqual(['sample_age', 'sample_name']);
  });

  it('adds a back-to-Tables link beside the table heading', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables));
    const back = workbook.Sheets.Zebra.E1;
    expect(back.v).toContain('Back to Tables');
    expect(String(workbook.Sheets.Zebra.B1?.v ?? '')).not.toContain('Back to Tables');
    expect(back.l?.Target).toBe("#'Tables'!A1");
  });

  it('populates lookup targets and option sets and word-wraps Description columns', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook({
      ...withTables,
      entities: [{
        name: 'sample_case', logicalName: 'sample_case', displayName: 'Case', isCustom: true, relationships: [],
        description: 'A long description',
        attributes: [
          { name: 'sample_contactid', displayName: 'Contact', type: 'Lookup', required: false, isCustom: true, lookupTarget: 'contact' },
          { name: 'sample_status', displayName: 'Status', type: 'Picklist', required: false, isCustom: true, optionSetName: 'sample_status' },
          { name: 'sample_local', displayName: 'Local', type: 'Picklist', required: false, isCustom: true, options: [{ value: 1, label: 'One' }], description: 'Wrapped text' },
        ],
      }],
    } as ParsedSolution));
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Case, { header: 1 }).filter((row) => row.length > 0);
    const byName = new Map(rows.slice(columnHeaderIndex(rows) + 1).map((row) => [row[1], row]));
    expect(byName.get('sample_contactid')?.[6]).toBe('contact');
    expect(byName.get('sample_status')?.[7]).toBe('sample_status');
    expect(byName.get('sample_local')?.[7]).toBe('Local: One (1)');

    const raw = createSolutionWorkbook({ ...withTables } as ParsedSolution);
    const styled = XLSX.read(new Uint8Array(await raw.arrayBuffer()), { type: 'array', cellStyles: true });
    expect(styled.Sheets.Tables['!cols']?.[2]?.wch ?? styled.Sheets.Tables['!cols']?.[2]?.width).toBeGreaterThan(40);
  });

  it('sorts the Tables sheet and links display names to the table worksheets', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables));
    const tables = workbook.Sheets.Tables;
    expect(tables.A2.v).toBe('Aardvark');
    expect(tables.A3.v).toBe('Zebra');
    expect(tables.A2.l?.Target).toContain('Aardvark');
    expect(tables.A3.l?.Target).toContain('Zebra');
  });

  it('adds document header information above the Overview summary when provided', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables, {
      client: 'Contoso', project: 'Apollo', contract: '', sow: '', sprint: '', releaseDate: '',
    }));
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Overview, { header: 1, blankrows: true });
    expect(rows[0][0]).toBe('Document Information');
    expect(rows.some((row) => row[0] === 'Client' && row[1] === 'Contoso')).toBe(true);
    expect(rows.some((row) => row[0] === 'Property' && row[1] === 'Value')).toBe(true);
  });

  it('omits the document information block when no header information is set', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables));
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Overview, { header: 1 });
    expect(rows[0]).toEqual(['Property', 'Value']);
  });

  it('renders all table metadata in horizontal sections above the columns', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables));
    const sheet = workbook.Sheets.Zebra;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: true });
    const header = columnHeaderIndex(rows);
    expect(header).toBe(10);
    expect([sheet.A3.v, sheet.E3.v, sheet.G3.v, sheet.I3.v]).toEqual([
      'General', 'Data and tracking', 'Make this table an option when', 'Rows in this table',
    ]);
    expect(sheet.A5.v).toBe('Schema name');
    expect(sheet.B5.v).toBe('sample_zebra');
    expect(sheet.C4.v).toBe('Total columns');
    expect(sheet.D4.v).toBe('2');
    expect(sheet.K7.v).toBe("When rows are created or assigned, move them to the owner's default queue");
    expect(sheet.L7.v).toContain(NOT_AVAILABLE_PREFIX);
    const metadata = buildTableMetadataBlocks(withTables.entities[0]);
    const actualPairs = rows.slice(3, header - 1).flatMap((row) =>
      Array.from({ length: 6 }, (_, pair) => row.slice(pair * 2, pair * 2 + 2)).filter(([label]) => label));
    expect(actualPairs).toHaveLength(metadata.flatMap((block) => block.items).length);
    expect(actualPairs).toEqual(expect.arrayContaining(metadata.flatMap((block) => block.items)));
    expect(sheet['!merges']?.map((range) => XLSX.utils.encode_range(range))).toEqual(['B1:D1', 'A3:D3', 'E3:F3', 'G3:H3', 'I3:L3']);
    expect(sheet['!autofilter']?.ref).toBe('A11:I13');
    expect(rows.slice(header + 1).map((row) => row[0])).toEqual(['Age', 'Name']);
  });

  it('matches the screenshot header colours, fonts and thin grey cell borders in the saved workbook', async () => {
    const blob = createSolutionWorkbook(withTables);
    const data = new Uint8Array(await blob.arrayBuffer());
    const workbook = XLSX.read(data, { type: 'array', cellStyles: true });
    const sheet = workbook.Sheets.Zebra;
    expect(sheet.A1.s.fgColor.rgb).toBe('252835');
    expect(sheet.B1.s.fgColor.rgb).toBe('FFFFFF');
    expect(sheet.A3.s.fgColor.rgb).toBe('D6DCE4');
    expect(sheet.E3.s.fgColor.rgb).toBe('D6DCE4');
    expect(sheet.G3.s.fgColor.rgb).toBe('252835');
    expect(sheet.I3.s.fgColor.rgb).toBe('252835');
    expect(sheet.A4.s.fgColor.rgb).toBe('D6DCE4');
    expect(sheet.B4.s.fgColor.rgb).toBe('FFFFFF');
    expect(sheet.D6.s.fgColor.rgb).toBe('FEF3C7');
    expect(sheet.E1.l?.Target).toBe("#'Tables'!A1");

    const archive = await JSZip.loadAsync(data);
    const parser = new XMLParser({ ignoreAttributes: false });
    const stylesFile = archive.file('xl/styles.xml');
    const sheetFile = archive.file(`xl/worksheets/sheet${workbook.SheetNames.indexOf('Zebra') + 1}.xml`);
    expect(stylesFile).not.toBeNull();
    expect(sheetFile).not.toBeNull();
    const styles = parser.parse(await stylesFile!.async('string')).styleSheet;
    const savedSheet = parser.parse(await sheetFile!.async('string')).worksheet;
    const cells = savedSheet.sheetData.row.flatMap((row: { c: { '@_r': string; '@_s': string }[] }) => row.c);
    for (const address of ['A1', 'B1', 'C1', 'D1', 'A3', 'B3', 'D3', 'E3', 'G3', 'H3', 'I3', 'L3', 'A4', 'B4', 'D6']) {
      const cell = cells.find((item: { '@_r': string }) => item['@_r'] === address);
      expect(cell, address).toBeDefined();
      const style = styles.cellXfs.xf[Number(cell['@_s'])];
      const border = styles.borders.border[Number(style['@_borderId'])];
      for (const side of ['top', 'bottom', 'left', 'right']) {
        expect(border[side], `${address} ${side}`).toEqual({
          '@_style': 'thin', color: { '@_rgb': '808080' },
        });
      }
      const font = styles.fonts.font[Number(style['@_fontId'])];
      expect(font.name['@_val']).toBe('Calibri');
      expect(font.color['@_rgb']).toBe(['A1', 'G3', 'H3', 'I3', 'L3'].includes(address)
        ? 'FFFFFF' : address === 'D6' ? '92400E' : '000000');
      expect(style.alignment['@_wrapText']).toBe('true');
    }
  });

  it('keeps long descriptions and unavailable explanations wrapped and highlighted', async () => {
    const description = 'First line\n' + 'A detailed table description. '.repeat(16).trim();
    const blob = createSolutionWorkbook({
      ...withTables,
      entities: [{ ...withTables.entities[0], metadataSource: 'local', description }],
    });
    const workbook = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array', cellStyles: true });
    const sheet = workbook.Sheets.Zebra;
    expect(sheet.B8.v).toBe(description);
    expect(sheet.D6.v).toContain('analyse the solution in Dataverse Connected mode');
    expect(sheet.D6.s.fgColor.rgb).toBe('FEF3C7');
    expect(sheet['!cols']).toHaveLength(12);
    expect(sheet['!rows']?.[7]?.hpt).toBeGreaterThan(300);
    expect(sheet['!rows']?.[5]?.hpt).toBeGreaterThan(45);
  });

  it('adds table-specific dependency tables after exactly one blank row without changing column sorting or filters', async () => {
    const source: ParsedSolution = {
      ...withTables,
      entities: withTables.entities.map((entity) => entity.logicalName === 'sample_zebra' ? {
        ...entity,
        attributes: [...entity.attributes, {
          name: 'sample_customer', displayName: 'Customer', type: AttributeType.Lookup,
          isCustom: true, required: false, lookupTarget: 'account',
        }],
      } : entity),
      missingDependencies: [{
        dependentName: 'Aardvark form', dependentType: 'Form', requiredName: 'other_script',
        requiredType: 'Web Resource', tableLogicalNames: ['sample_aardvark'],
      }, {
        dependentName: 'sample_zebra.sample_customer', dependentType: 'Column', requiredName: 'account',
        requiredType: 'Table', tableLogicalNames: ['sample_zebra'],
      }, {
        dependentName: 'Other solution field', dependentType: 'Column', requiredName: 'unrelated_requirement',
        requiredType: 'Table', tableLogicalNames: ['sample_zebra'], solutionUniqueName: 'other_solution',
      }],
    };
    const workbook = await readWorkbook(createSolutionWorkbook(source, undefined, { generateMissingDependencies: true }));
    const zebra = workbook.Sheets.Zebra;
    const rows = XLSX.utils.sheet_to_json<string[]>(zebra, { header: 1, blankrows: true });
    const header = columnHeaderIndex(rows);
    const dependencyTitle = rows.findIndex((row) => row[0] === 'Missing Dependencies');
    expect(dependencyTitle).toBe(header + source.entities[0].attributes.length + 2);
    expect(rows[dependencyTitle - 1] ?? []).toEqual([]);
    expect(rows.slice(header + 1, dependencyTitle - 1).map((row) => row[0])).toEqual(['Age', 'Customer', 'Name']);
    expect(rows[dependencyTitle + 2]).toEqual(['Dependent Item', 'Item Type', 'Required Component', 'Required Type', 'Solution']);
    expect(rows[dependencyTitle + 3]).toEqual(['sample_zebra.sample_customer', 'Column', 'account', 'Table', 'sample']);
    expect(rows.flat().join(' ')).not.toContain('other_script');
    expect(rows.flat().join(' ')).not.toContain('unrelated_requirement');
    expect(zebra['!autofilter']?.ref).toBe('A11:I14');
    expect(zebra.E1.l?.Target).toBe("#'Tables'!A1");
    const aardvarkRows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Aardvark, { header: 1 });
    expect(aardvarkRows).toContainEqual(['Aardvark form', 'Form', 'other_script', 'Web Resource', 'sample']);
    expect(aardvarkRows.flat()).not.toContain('account');
    expect(XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Tables, { header: 1 }).flat()).not.toContain('Missing Dependencies');
  });

  it('omits dependency tables by default and provides an explicit empty result when enabled for a table with no columns', async () => {
    const source: ParsedSolution = {
      ...withTables, entities: [{ ...withTables.entities[0], attributes: [] }], missingDependencies: [],
    };
    const disabled = await readWorkbook(createSolutionWorkbook(source));
    expect(XLSX.utils.sheet_to_json<string[]>(disabled.Sheets.Zebra, { header: 1 }).flat()).not.toContain('Missing Dependencies');
    const enabled = await readWorkbook(createSolutionWorkbook(source, undefined, { generateMissingDependencies: true }));
    const rows = XLSX.utils.sheet_to_json<string[]>(enabled.Sheets.Zebra, { header: 1, blankrows: true });
    const header = columnHeaderIndex(rows);
    expect(rows[header + 1] ?? []).toEqual([]);
    expect(rows[header + 2][0]).toBe('Missing Dependencies');
    expect(rows[header + 5][0]).toContain('No missing installation/import prerequisites were declared for this table');
    expect(enabled.Sheets.Zebra['!autofilter']).toBeUndefined();
  });

  it('shows collection failures instead of claiming an empty import dependency result', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook({
      ...withTables, missingDependenciesError: 'Solution dependency request was denied.',
    }, undefined, { generateMissingDependencies: true }));
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets.Zebra, { header: 1 });
    expect(rows.flat().join(' ')).toContain('Solution dependency request was denied.');
    expect(rows.flat().join(' ')).toContain('Dependency report incomplete');
    expect(rows.flat().join(' ')).not.toContain('No missing installation/import prerequisites');
  });
});

describe('buildTableMetadataBlocks', () => {
  const base = { name: 'x_t', logicalName: 'x_t', displayName: 'T', isCustom: true, relationships: [], attributes: [] };
  const value = (blocks: ReturnType<typeof buildTableMetadataBlocks>, label: string) =>
    blocks.flatMap((block) => block.items).find(([key]) => key === label)?.[1];

  it('explains Dataverse-only fields for local metadata', () => {
    const blocks = buildTableMetadataBlocks({ ...base, metadataSource: 'local', ownershipType: 'User', isAuditEnabled: true } as never);
    expect(value(blocks, 'Record ownership')).toBe('User or team');
    expect(value(blocks, 'Audit changes to its data')).toBe('Yes');
    const notes = value(blocks, 'Enable attachments (including notes and files)');
    expect(notes?.startsWith(NOT_AVAILABLE_PREFIX)).toBe(true);
    expect(notes).toContain('Dataverse Connected');
  });

  it('uses a Dataverse reason when a connected field is missing', () => {
    const blocks = buildTableMetadataBlocks({ ...base, metadataSource: 'dataverse', hasNotes: false } as never);
    expect(value(blocks, 'Enable attachments (including notes and files)')).toBe('No');
    expect(value(blocks, 'Audit changes to its data')).toContain('not returned by Dataverse');
  });
});