import { describe, expect, it } from 'vitest';
import { extractDiagramsDocument, generateConsolidatedMarkdown, generateMarkdown } from './markdownGenerator';
import type { ParsedSolution } from '../types/solution';

const emptySolution: ParsedSolution = {
  metadata: { uniqueName: 'sample', displayName: 'Sample', version: '1.0.0.0', publisherName: 'Test', isManaged: false },
  entities: [], optionSets: [], forms: [], views: [], processes: [], apps: [], webResources: [],
  securityRoles: [], fieldSecurityProfiles: [], connectionReferences: [], environmentVariables: [],
  emailTemplates: [], reports: [], dashboards: [], pluginAssemblies: [], warnings: [],
  agents: [], aiModels: [], desktopFlows: [], dataflows: [], customApis: [], offlineProfiles: [],
};

describe('modern artifact Markdown output', () => {
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

    [0, 1, 2, 3, 4].forEach((depth) => {
      expect(markdown).toContain(`ppmd-privilege-${depth}`);
    });
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

    expect(markdown).toContain('<strong>Client</strong>');
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