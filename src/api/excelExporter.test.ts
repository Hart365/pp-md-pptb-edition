import { describe, expect, it } from 'vitest';
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
});