import { describe, expect, it } from 'vitest';
import { consolidateSolutions, DEFAULT_DOCUMENTATION_SETTINGS, didPeerGapFillAddData, extractDiagramsDocument, fillSolutionGapsFromPeerSolutions, generateConsolidatedMarkdown, generateMarkdown, splitDiagramsDocument, splitMarkdownByCategory } from './markdownGenerator';
import { AppType, type EntityDefinition, type ParsedSolution } from '../types/solution';

const emptySolution: ParsedSolution = {
  metadata: { uniqueName: 'sample', displayName: 'Sample', version: '1.0.0.0', publisherName: 'Test', isManaged: false },
  entities: [], optionSets: [], forms: [], views: [], processes: [], apps: [], webResources: [],
  securityRoles: [], fieldSecurityProfiles: [], connectionReferences: [], environmentVariables: [],
  emailTemplates: [], reports: [], dashboards: [], pluginAssemblies: [], warnings: [],
  agents: [], aiModels: [], desktopFlows: [], dataflows: [], customApis: [], offlineProfiles: [],
};

describe('modern artifact Markdown output', () => {
  it('keeps multi-line column descriptions inside a single table row', () => {
    const markdown = generateMarkdown({
      ...emptySolution,
      entities: [{
        name: 'new_widget', logicalName: 'new_widget', isCustom: true, relationships: [],
        attributes: [{ name: 'new_notes', type: 'String', required: false, isCustom: true, description: 'Line one\r\nLine | two\n\nLine three' } as never],
      }],
    });

    const row = markdown.split('\n').find((line) => line.includes('new_notes') && line.includes('Line one'));
    expect(row).toBeDefined();
    expect(row).toContain('Line one<br>Line \\| two<br>Line three');
  });

  it('documents unmapped solution components in the output inventory', () => {
    const markdown = generateMarkdown({
      ...emptySolution,
      unmappedComponents: [{ componentType: 999, objectId: 'component-id' }],
      warnings: ['Some components are listed by type and ID only.'],
    });

    expect(markdown).toContain('## Other Solution Components');
    expect(markdown).toContain('| 999 | Unknown | component-id |');
    expect(markdown).not.toContain('Some components are listed by type and ID only.');
    expect(markdown).not.toContain('Collection Issue');
  });

  it('documents every modern artifact family with textual state labels', () => {
    const markdown = generateMarkdown({
      ...emptySolution,
      agents: [{ name: 'agent', sourcePath: 'Agents/agent.json', agentType: 'Copilot' }],
      aiModels: [{ name: 'model', sourcePath: 'AIModels/model.json', provider: 'Contoso' }],
      desktopFlows: [{ name: 'desktop', sourcePath: 'DesktopFlows/desktop.json', isEnabled: true, stepCount: 3 }],
      dataflows: [{ name: 'dataflow', sourcePath: 'Dataflows/dataflow.json', refreshMode: 'Scheduled' }],
      customApis: [{ name: 'api', sourcePath: 'CustomApis/api.xml', isFunction: false }],
      offlineProfiles: [{ name: 'offline', sourcePath: 'OfflineProfiles/offline.xml', entities: ['account'] }],
    });

    expect(markdown).toContain('## Copilot Studio Agents');
    expect(markdown).toContain('## AI Models');
    expect(markdown).toContain('## Desktop Flows');
    expect(markdown).toContain('| desktop | – | Enabled | 3 |');
    expect(markdown).toContain('## Dataflows');
    expect(markdown).toContain('## Custom APIs');
    expect(markdown).toContain('## Offline Profiles');
  });

  it('documents available table metadata and omits values that are not available', () => {
    const markdown = generateMarkdown({
      ...emptySolution,
      entities: [{
        name: 'new_widget', logicalName: 'new_widget', displayName: 'Widget', isCustom: true, relationships: [],
        metadataSource: 'local', ownershipType: 'User', isAuditEnabled: true, changeTracking: false,
        attributes: [{ name: 'new_name', displayName: 'Name', type: 'String', required: true, isCustom: true, isPrimaryName: true } as never],
      } as never],
    });

    expect(markdown).toContain('| **Record ownership** | User or team |');
    expect(markdown).toContain('| **Primary column** | Name (new_name) |');
    expect(markdown).toContain('**Data and tracking**');
    expect(markdown).toContain('| Audit changes to its data | Yes |');
    expect(markdown).toContain('| Track changes | No |');
    expect(markdown).not.toContain('Not available');
    expect(markdown).not.toContain('(No description provided)');
    expect(markdown).not.toContain('Apply duplicate detection rules');
    expect(markdown).not.toContain('**Make this table an option when**');
    expect(markdown).not.toContain('**Rows in this table**');
  });

  it('emits sanitizer-safe privilege classes for every access depth', () => {
    const markdown = generateMarkdown({
      ...emptySolution,
      securityRoles: [{
        name: 'reader',
        privileges: [
          { privilegeName: 'prvCreateAccount', depth: 0 },
          { privilegeName: 'prvReadAccount', depth: 1 },
          { privilegeName: 'prvWriteAccount', depth: 2 },
          { privilegeName: 'prvDeleteAccount', depth: 3 },
          { privilegeName: 'prvAppendAccount', depth: 4 },
        ],
      }],
    });

    ['None', 'User', 'Business Unit', 'Parent Child Business Unit', 'Org'].forEach((label) => {
      expect(markdown).toContain(label);
    });
    expect(markdown).not.toMatch(/<span|<table|<strong>/i);
  });
});

describe('peer solution gap filling', () => {
  it('reports enrichment only when peer data adds information', () => {
    const target: ParsedSolution = {
      ...emptySolution,
      apps: [{ name: 'Sales', uniqueName: 'sales', appType: AppType.ModelDriven, entities: [] }],
    };
    const peer: ParsedSolution = {
      ...emptySolution,
      apps: [{ name: 'Sales', uniqueName: 'sales', appType: AppType.ModelDriven, entities: ['account'] }],
    };
    const unchangedPeer: ParsedSolution = { ...emptySolution };
    const enriched = fillSolutionGapsFromPeerSolutions(target, [peer]);
    const unchanged = fillSolutionGapsFromPeerSolutions(target, [unchangedPeer]);

    expect(didPeerGapFillAddData(target, enriched)).toBe(true);
    expect(didPeerGapFillAddData(target, unchanged)).toBe(false);
  });
});

describe('connected component documentation', () => {
  const source: ParsedSolution = {
    ...emptySolution,
    optionSets: [{
      name: 'new_status', displayName: 'Status', metadataId: 'choice-id', isGlobal: true,
      options: [{ value: 0, label: 'Inactive', color: '#123456', description: 'Not active' }],
    }],
    solutionComponents: [{
      componentType: 62, componentTypeName: 'Site Map', objectId: 'map-id',
      name: 'Sales', entityLogicalName: 'sitemap',
      properties: [{ name: 'Navigation', value: 'Sales\nSales / Accounts (account)' }],
    }],
    environmentVariables: [{
      name: 'API', schemaName: 'new_API', type: 'String', hasCurrentValue: undefined,
      currentValueError: 'Access denied', currentValue: 'DO_NOT_RENDER_CURRENT_VALUE',
    }],
  };

  it('renders complete choice options and component properties with matching TOC and category exports', () => {
    const markdown = generateMarkdown(source);
    expect(markdown).toContain('**Component Type:** 9 (Global Option Set)');
    expect(markdown).toContain('**Metadata ID:** choice-id');
    expect(markdown).toContain('| Inactive | 0 | #123456 | Not active |');
    expect(markdown).toContain('[Additional Solution Components](#additional-solution-components)');
    expect(markdown).toContain('| Component Type | 62 (Site Map) |');
    expect(markdown).toContain('| Navigation | Sales<br>Sales / Accounts (account) |');
    expect(markdown).toContain('| String | Unknown |');
    expect(markdown).not.toContain('DO_NOT_RENDER_CURRENT_VALUE');
    expect(splitMarkdownByCategory(markdown).find((category) => category.key === 'reports-and-insights')?.markdown).toContain('Site Map: Sales');
    expect(splitMarkdownByCategory(markdown).find((category) => category.key === 'tables-and-relationships')?.markdown).toContain('new_status');
  });

  it('adds a top-down Site Map hierarchy while retaining text in main and category documents', () => {
    const markdown = generateMarkdown(source);
    expect(markdown).toContain('flowchart TD');
    expect(markdown).toContain('root["Sales"]');
    expect(markdown).toContain('nav0["Sales"]');
    expect(markdown).toContain('nav1["Accounts account"]');
    expect(markdown).toContain('root --> nav0');
    expect(markdown).toContain('nav0 --> nav1');
    expect(markdown).toContain('accTitle: Site Map navigation hierarchy');
    const split = splitDiagramsDocument(markdown);
    expect(split.mainMarkdown).toContain('| Navigation | Sales<br>Sales / Accounts (account) |');
    expect(split.mainMarkdown).toContain('[Additional Solution Components]');
    expect(split.mainMarkdown).not.toContain('```mermaid');
    expect(split.mainMarkdown).not.toContain('#### Navigation Hierarchy');
    expect(split.diagramsMarkdown).toContain('flowchart TD');
    expect(splitMarkdownByCategory(markdown).find((file) => file.key === 'reports-and-insights')?.markdown).toContain('flowchart TD');
    expect(generateMarkdown(source, { includeDiagrams: false })).not.toContain('flowchart TD');
    expect(generateMarkdown(source, { includeDiagrams: false })).toContain('| Navigation |');
    expect(generateConsolidatedMarkdown([source, source])).toContain('flowchart TD');
  });

  it('keeps separate branches with repeated labels and deduplicates shared ancestors', () => {
    const markdown = generateMarkdown({
      ...source,
      solutionComponents: [{
        ...source.solutionComponents![0],
        properties: [{ name: 'Navigation', value: 'Sales\nSales / Work\nSales / Work / Accounts (account)\nService\nService / Work\nService / Work / Accounts (account)' }],
      }],
    });
    expect(markdown.match(/nav\d+\["Work"\]/g)).toHaveLength(2);
    expect(markdown.match(/nav\d+\["Accounts account"\]/g)).toHaveLength(2);
    expect(markdown.match(/nav\d+\["Sales"\]/g)).toHaveLength(1);
    expect(markdown.match(/nav\d+\["Service"\]/g)).toHaveLength(1);
  });

  it('retains and deduplicates detailed components and choices in both consolidated output paths', () => {
    const combined = consolidateSolutions([source, source]);
    expect(combined.solutionComponents).toHaveLength(1);
    expect(combined.optionSets).toHaveLength(1);
    expect(generateMarkdown(combined)).toContain('Site Map: Sales');
    expect(generateConsolidatedMarkdown([source, source])).toContain('Site Map: Sales');
    expect(generateConsolidatedMarkdown([source, source])).toContain('**Metadata ID:** choice-id');
  });
});

describe('table metadata source labels', () => {
  const entity: EntityDefinition = {
    name: 'new_widget', logicalName: 'new_widget', displayName: 'Widget',
    isCustom: true, relationships: [], attributes: [],
  };
  const documentationSettings = {
    metadata: { ...DEFAULT_DOCUMENTATION_SETTINGS.metadata, includeMetadataSource: true },
  };

  it.each([
    { source: 'dataverse', peer: false, enriched: false, expected: 'Dataverse Connected' },
    { source: 'dataverse', peer: true, enriched: false, expected: 'Dataverse Connected + Peer Gap Fill' },
    { source: 'dataverse', peer: true, enriched: true, expected: 'Dataverse Connected + Peer Gap Fill + Dataverse Enrichment' },
    { source: 'local', peer: false, enriched: false, expected: 'ZIP Export' },
    { source: 'local', peer: true, enriched: false, expected: 'ZIP Export + Peer Gap Fill' },
    { source: 'local', peer: false, enriched: true, expected: 'ZIP Export + Dataverse Enrichment' },
    { source: undefined, peer: false, enriched: false, expected: 'Unknown' },
  ] as const)('labels $source metadata with peer=$peer and enriched=$enriched', ({ source, peer, enriched, expected }) => {
    const markdown = generateMarkdown({
      ...emptySolution, entities: [{ ...entity, metadataSource: source }],
    }, {
      documentationSettings,
      enrichmentIndicators: { peerGapFillApplied: peer, dataverseMetadataEnriched: enriched },
    });
    expect(markdown).toContain(`| **Metadata Source** | ${expected} |`);
  });

  describe('optional missing dependencies section', () => {
    const source: ParsedSolution = {
      ...emptySolution,
      entities: [{
        name: 'new_case', logicalName: 'new_case', isCustom: true, attributes: [], relationships: [],
      }],
      missingDependencies: [{
        dependentName: 'new_case.new_field', dependentType: 'Column',
        requiredName: 'account|special\nname', requiredType: 'Table', tableLogicalNames: ['new_case'],
      }],
      warnings: ['Example warning'],
    };
    const options = { documentationSettings: { generateMissingDependencies: true } };

    it('defaults off and is omitted when disabled', () => {
      expect(generateMarkdown(source)).not.toContain('Missing Dependencies');
      expect(generateMarkdown(source, { documentationSettings: { generateMissingDependencies: false } })).not.toContain('Missing Dependencies');
    });

    it('appears last, has a contents link and escapes dependency values', () => {
      const markdown = generateMarkdown(source, options);
      expect(markdown).toContain('[Missing Dependencies](#missing-dependencies)');
      expect(markdown).toContain('| new_case.new_field | Column | account\\|special<br>name | Table | new_case | sample |');
      expect(markdown).toContain('may already exist in the target environment');
      const headings = [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
      expect(headings[headings.length - 1]).toBe('Missing Dependencies');
      expect(splitMarkdownByCategory(markdown).find((category) => category.key === 'reports-and-insights')?.markdown).toContain('## Missing Dependencies');
    });

    it('distinguishes an authoritative empty result from dependencies not collected', () => {
      const markdown = generateMarkdown({ ...emptySolution, missingDependencies: [] }, options);
      expect(markdown).toContain('## Missing Dependencies');
      expect(markdown).toContain('No missing installation/import prerequisites were declared for this solution');
      const unavailable = generateMarkdown(emptySolution, options);
      expect(unavailable).toContain('Dependency information is unavailable or incomplete.');
      expect(unavailable).not.toContain('No missing installation/import prerequisites');
      const failed = generateMarkdown({ ...emptySolution, missingDependenciesError: 'Access denied' }, options);
      expect(failed).not.toContain('Access denied');
      expect(failed).toContain('Dependency information is unavailable or incomplete.');
      expect(failed).not.toContain('No missing installation/import prerequisites');
    });

    it('omits other solutions and runtime-only dependencies from an individual document', () => {
      const markdown = generateMarkdown({
        ...source,
        missingDependencies: [...source.missingDependencies!, {
          dependentName: 'Unrelated item', dependentType: 'Process', requiredName: 'other_solution_dependency',
          requiredType: 'Table', tableLogicalNames: [], solutionUniqueName: 'other',
        }],
        dataverseInsights: { customApis: [], dependencies: [{
          dependentName: 'Runtime flow', dependentType: 'Process', requiredName: 'runtime_only',
          requiredType: 'Table',
        }] },
      }, options).split('## Missing Dependencies')[1];
      expect(markdown).toContain('account\\|special');
      expect(markdown).not.toContain('other_solution_dependency');
      expect(markdown).not.toContain('runtime_only');
    });

    it('includes the section in consolidated summaries too', () => {
      const markdown = generateConsolidatedMarkdown([
        source, { ...emptySolution, metadata: { ...emptySolution.metadata, uniqueName: 'second' } },
      ], options);
      expect(markdown).toContain('## Missing Dependencies');
      expect(markdown).toContain('[Missing Dependencies](#missing-dependencies)');
    });
  });

  it('uses the table source even when enrichment indicators are omitted', () => {
    const markdown = generateMarkdown({
      ...emptySolution, entities: [{ ...entity, metadataSource: 'dataverse' }],
    }, { documentationSettings });
    expect(markdown).toContain('| **Metadata Source** | Dataverse Connected |');
    expect(markdown).not.toContain('ZIP Export');
  });

  it('retains the individual table sources in consolidated documentation', () => {
    const markdown = generateMarkdown(consolidateSolutions([
      { ...emptySolution, entities: [{ ...entity, metadataSource: 'dataverse' }] },
      {
        ...emptySolution,
        metadata: { ...emptySolution.metadata, uniqueName: 'second' },
        entities: [{ ...entity, name: 'new_local', logicalName: 'new_local', metadataSource: 'local' }],
      },
    ]), { documentationSettings });
    expect(markdown).toContain('| **Metadata Source** | Dataverse Connected |');
    expect(markdown).toContain('| **Metadata Source** | ZIP Export |');
  });
});

describe('consolidated document navigation and companion diagrams', () => {
  it('includes context, a table of contents, and Back to Top links', () => {
    const markdown = generateConsolidatedMarkdown([
      emptySolution,
      { ...emptySolution, metadata: { ...emptySolution.metadata, uniqueName: 'second', displayName: 'Second' } },
    ], {
      documentContext: { client: 'Contoso', project: 'Migration', contract: '', sow: '', sprint: '', releaseDate: '' },
    });

    expect(markdown).toContain('| **Client** | Contoso |');
    expect(markdown).not.toMatch(/<table|<tr|<td|<strong>/i);
    expect(markdown).toContain('Contoso');
    expect(markdown).toContain('## Table of Contents');
    expect(markdown).toContain('[Included Solutions](#included-solutions)');
    expect(markdown).toContain('[Back to Top](#table-of-contents)');
  });

  it('keeps diagrams in a standalone document and out of the main document when omitted', () => {
    const diagramMarkdown = '# Source\n\n## Entity Relationship Diagram\n\n```mermaid\nerDiagram\n  ACCOUNT {}\n```';
    const companion = extractDiagramsDocument(diagramMarkdown, 'All Selected Solutions: Diagrams');
    const main = generateMarkdown(emptySolution, { includeDiagrams: false });

    expect(main).not.toContain('```mermaid');
    expect(companion).toContain('# All Selected Solutions: Diagrams');
    expect(companion).toContain('## Table of Contents');
    expect(companion).toContain('```mermaid');
    expect(companion).toContain('[Back to Top](#table-of-contents)');
  });

  it('splits diagram sections from the main document and removes their table-of-contents links', () => {
    const markdown = [
      '# Source',
      '',
      '## Table of Contents',
      '',
      '- [Overview](#overview)',
      '- [Entity Relationship Diagram](#entity-relationship-diagram)',
      '',
      '## Overview',
      '',
      'Solution details.',
      '',
      '## Entity Relationship Diagram',
      '',
      '```mermaid',
      'erDiagram',
      '  ACCOUNT {}',
      '```',
    ].join('\n');

    const split = splitDiagramsDocument(markdown, 'Source: Diagrams');

    expect(split.mainMarkdown).toContain('Solution details.');
    expect(split.mainMarkdown).not.toContain('erDiagram');
    expect(split.mainMarkdown).not.toContain('[Entity Relationship Diagram]');
    expect(split.diagramsMarkdown).toContain('erDiagram');
    expect(split.diagramsMarkdown).toContain('Source: Diagrams');
  });

  it('generates internal links whose targets exist as headings', () => {
    const markdown = generateConsolidatedMarkdown([
      emptySolution,
      { ...emptySolution, metadata: { ...emptySolution.metadata, uniqueName: 'second', displayName: 'Second' } },
    ]);
    const headings = new Set(
      [...markdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1]
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')),
    );
    [...markdown.matchAll(/\]\(#([^)]+)\)/g)].forEach((match) => {
      expect(headings.has(match[1])).toBe(true);
    });
  });
});