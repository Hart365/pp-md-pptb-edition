import { describe, expect, it } from 'vitest';
import type { ParsedSolution } from '../types/solution';
import { generateDiagnosticsMarkdown } from './diagnosticsGenerator';
import { generateConsolidatedMarkdown, generateMarkdown, splitMarkdownByCategory } from './markdownGenerator';

const solution: ParsedSolution = {
  metadata: { uniqueName: 'sample', displayName: 'Sample', version: '1', publisherName: 'Test', isManaged: false },
  entities: [], optionSets: [], forms: [], views: [], processes: [], apps: [], webResources: [],
  securityRoles: [], fieldSecurityProfiles: [], connectionReferences: [], environmentVariables: [],
  emailTemplates: [], reports: [], dashboards: [], pluginAssemblies: [], warnings: [],
  agents: [], aiModels: [], desktopFlows: [], dataflows: [], customApis: [], offlineProfiles: [],
};

describe('standalone diagnostics', () => {
  it('omits an empty diagnostics document', () => {
    expect(generateDiagnosticsMarkdown(solution)).toBe('');
  });

  it('retains every diagnostic outside solution, diagram, and category documentation', () => {
    const source: ParsedSolution = {
      ...solution,
      warnings: ['Parse | failure\nDetails', 'Parse | failure\nDetails'],
      unmappedComponents: [{ componentType: 62, componentTypeName: 'Site Map', objectId: 'map-id', error: 'Map access denied' }],
      missingDependenciesError: 'Dependency access denied',
      environmentVariables: [{ name: 'API', schemaName: 'new_api', type: 'String', currentValueError: 'Presence access denied', currentValue: 'DO_NOT_EXPORT' }],
      environmentAppendix: {
        collectedAt: '2025-01-01T00:00:00Z', identity: [], settingGroups: [], powerPlatformSettings: [],
        powerPlatformStatus: 'Platform access denied', languages: [], currencies: [],
        counts: [{ category: 'Apps', label: 'Canvas', note: 'Count access denied', custom: { note: 'Classification access denied' } }],
        solutions: [], publishers: [], businessUnits: [], applicationPackages: [],
        warnings: ['Environment access denied'],
      },
    };
    const report = generateDiagnosticsMarkdown(source);
    const markdown = generateMarkdown(source, { documentationSettings: { generateMissingDependencies: true } });
    const consolidated = generateConsolidatedMarkdown([source, { ...source, metadata: { ...source.metadata, uniqueName: 'second' } }]);
    const messages = ['Map access denied', 'Dependency access denied', 'Presence access denied',
      'Platform access denied', 'Count access denied', 'Classification access denied', 'Environment access denied'];
    for (const message of messages) {
      expect(report).toContain(message);
      expect(markdown).not.toContain(message);
      expect(consolidated).not.toContain(message);
      for (const file of splitMarkdownByCategory(markdown)) expect(file.markdown).not.toContain(message);
    }
    expect(report.match(/Parse \\\| failure<br>Details/g)).toHaveLength(1);
    expect(markdown).not.toContain('Parse Warnings');
    expect(report).toContain('Site Map (62), map-id');
    expect(report).not.toContain('DO_NOT_EXPORT');
    expect(markdown).not.toContain('DO_NOT_EXPORT');
    expect(source.warnings).toHaveLength(2);
  });
});
