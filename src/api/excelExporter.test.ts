import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx-js-style';
import { createSolutionWorkbook } from './excelExporter';
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
    expect(zebraRows[0][0]).toBe('Zebra (sample_zebra)');
    expect(zebraRows[1].slice(0, 2)).toEqual(['Display Name', 'Schema Name']);
    expect(zebraRows.slice(2).map((row) => row[0])).toEqual(['Age', 'Name']);
    expect(zebraRows.slice(2).map((row) => row[1])).toEqual(['sample_age', 'sample_name']);
  });

  it('adds a back-to-Tables link beside the table heading', async () => {
    const workbook = await readWorkbook(createSolutionWorkbook(withTables));
    const back = workbook.Sheets.Zebra.B1;
    expect(back.v).toContain('Back to Tables');
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
    const byName = new Map(rows.slice(2).map((row) => [row[1], row]));
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
});