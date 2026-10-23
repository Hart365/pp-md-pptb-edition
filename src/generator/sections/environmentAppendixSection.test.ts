import { describe, expect, it } from 'vitest';
import type { EnvironmentAppendix, ParsedSolution } from '../../types/solution';
import { consolidateSolutions, generateMarkdown, splitMarkdownByCategory } from '../markdownGenerator';
import { generateEnvironmentAppendixSection, MAX_BUSINESS_UNITS_LISTED } from './environmentAppendixSection';

const appendix: EnvironmentAppendix = {
  collectedAt: '2025-01-01T00:00:00.000Z',
  identity: [{ name: 'Environment ID', value: 'env-1' }],
  settingGroups: [{ title: 'Auditing', settings: [{ name: 'Auditing Enabled', value: 'Yes' }] }],
  powerPlatformSettings: [],
  powerPlatformStatus: 'Power Platform API access is not enabled for this PPTB connection.',
  languages: [{ lcid: 1033, name: 'English (United States)', isBaseLanguage: true }],
  currencies: [{ isoCode: 'USD', name: 'US Dollar', isBaseCurrency: true, isActive: true }],
  counts: [
    { category: 'People and Security', label: 'Users in environment', value: 42 },
    { category: 'People and Security', label: 'Teams', value: 50000, isLowerBound: true },
    { category: 'Apps and Automation', label: 'Canvas apps', note: 'Unavailable in this environment or for this user.' },
    { category: 'Data Model', label: 'Tables (total)', value: 10, custom: { value: 3, unclassified: 2 } },
  ],
  solutions: [{ uniqueName: 'Default', displayName: 'Default | Solution', version: '1.0', isManaged: false }],
  publishers: [{ uniqueName: 'contoso', displayName: 'Contoso', customizationPrefix: 'con' }],
  businessUnits: [{ name: 'Contoso', isDisabled: false }, { name: 'Sales', parentName: 'Contoso', isDisabled: true }],
  applicationPackages: [],
  warnings: ['Currencies could not be read: denied'],
};

const solution = (uniqueName: string): ParsedSolution => ({
  metadata: { uniqueName, displayName: uniqueName, version: '1.0.0.0', publisherName: 'Test', isManaged: false },
  entities: [], optionSets: [], forms: [], views: [], processes: [], apps: [], webResources: [],
  securityRoles: [], fieldSecurityProfiles: [], connectionReferences: [], environmentVariables: [],
  emailTemplates: [], reports: [], dashboards: [], pluginAssemblies: [], warnings: [],
  agents: [], aiModels: [], desktopFlows: [], dataflows: [], customApis: [], offlineProfiles: [],
  collectionPolicy: 'environmentAppendix',
});

describe('Environment Appendix section', () => {
  it('renders every populated area with escaped values, lower bounds, and unavailable counts', () => {
    const markdown = generateEnvironmentAppendixSection(appendix);
    expect(markdown).toContain('## Environment Appendix');
    for (const title of ['Environment Identity', 'Environment Settings', 'Power Platform Environment Settings', 'Provisioned Languages', 'Currencies',
      'Environment Inventory Counts', 'Installed Solutions', 'Publishers', 'Business Units']) {
      expect(markdown).toContain(`### ${title}`);
    }
    expect(markdown).toContain('#### Auditing');
    expect(markdown).toContain('At least 50,000');
    expect(markdown).toMatch(/\| Canvas apps \| Unavailable \|/);
    expect(markdown).toContain('| Data Model | Tables (total) | 10 | 3 | 2 |');
    expect(markdown).toContain('Custom (confirmed)');
    expect(markdown).toContain('Default \\| Solution');
    expect(markdown).toContain('| Sales | Contoso | Disabled |');
    expect(markdown).not.toContain('not enabled for this PPTB connection');
    expect(markdown).not.toContain('Environment Collection Notes');
    expect(markdown).not.toContain('Currencies could not be read');
    expect(markdown).not.toContain('### Installed Application Packages');
  });

  it('returns nothing without an appendix and caps long business unit lists', () => {
    expect(generateEnvironmentAppendixSection(undefined)).toBe('');
    const many = { ...appendix, businessUnits: Array.from({ length: MAX_BUSINESS_UNITS_LISTED + 5 }, (_, index) => ({ name: `BU ${index}`, isDisabled: false })) };
    expect(generateEnvironmentAppendixSection(many)).toContain(`Showing the first ${MAX_BUSINESS_UNITS_LISTED.toLocaleString()} of`);
  });

  it('sorts labels alphabetically within each grouping and uses UK English display labels', () => {
    const markdown = generateEnvironmentAppendixSection({
      ...appendix,
      identity: [
        { name: 'Tenant ID', value: 'tenant' }, { name: 'Organization Name', value: 'Contoso' },
        { name: 'State', value: 'Enabled' }, { name: 'Connection Name', value: 'Development' },
        { name: 'Schema Type', value: 'CDS' }, { name: 'Organization ID', value: 'org' },
      ],
      settingGroups: [{ title: 'Customization', settings: [{ name: 'Zebra', value: 'z' }, { name: 'Organization Settings', value: 'o' }] }],
    });
    const identity = markdown.split('### Environment Identity')[1].split('### Environment Settings')[0];
    const labels = ['Connection Name', 'Organisation ID', 'Organisation Name', 'Schema Type', 'State', 'Tenant ID'];
    expect(labels.map((label) => identity.indexOf(`| ${label} |`))).toEqual(
      labels.map((label) => identity.indexOf(`| ${label} |`)).sort((left, right) => left - right),
    );
    expect(markdown).toContain('#### Customisation');
    expect(markdown).not.toContain('Organization');
  });

  it('appears only in a document whose solution carries an appendix, with a table-of-contents entry', () => {
    const individual = generateMarkdown(solution('alpha'));
    expect(individual).not.toContain('## Environment Appendix');
    expect(individual).toContain('Environment Appendix of the consolidated All Selected Solutions document');

    const consolidated = generateMarkdown({ ...consolidateSolutions([solution('alpha'), solution('beta')]), environmentAppendix: appendix });
    expect(consolidated).toContain('## Environment Appendix');
    expect(consolidated).toContain('- [Environment Appendix](#environment-appendix) _(1)_');
  });

  it('keeps the shared collection policy when consolidating and exports the appendix as its own category', () => {
    const merged = consolidateSolutions([solution('alpha'), { ...solution('beta'), environmentAppendix: appendix }]);
    expect(merged.collectionPolicy).toBe('environmentAppendix');
    expect(merged.environmentAppendix).toBe(appendix);
    expect(consolidateSolutions([solution('alpha'), { ...solution('beta'), collectionPolicy: 'solutionOnly' }]).collectionPolicy).toBeUndefined();

    const files = splitMarkdownByCategory(generateMarkdown(merged));
    expect(files.find((file) => file.key === 'environment-appendix')?.markdown).toContain('## Environment Appendix');
  });
});
