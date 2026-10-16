import { describe, expect, it } from 'vitest';
import { AttributeType, ProcessCategory, AppType, type ParsedSolution, type MissingDependency } from '../types/solution';
import { collectMissingDependencies, dependenciesForTable, missingDependenciesNotice } from './missingDependencies';
import { consolidateSolutions, fillSolutionGapsFromPeerSolutions } from './markdownGenerator';

const solution: ParsedSolution = {
  metadata: { uniqueName: 'sample', displayName: 'Sample', version: '1', publisherName: 'Test', isManaged: false },
  entities: [{ name: 'new_case', logicalName: 'new_case', isCustom: true, attributes: [], relationships: [] }],
  optionSets: [], forms: [], views: [], processes: [], apps: [], webResources: [],
  securityRoles: [], fieldSecurityProfiles: [], connectionReferences: [], environmentVariables: [],
  emailTemplates: [], reports: [], dashboards: [], pluginAssemblies: [], warnings: [],
  agents: [], aiModels: [], desktopFlows: [], dataflows: [], customApis: [], offlineProfiles: [],
  missingDependencies: [],
};
const dependency: MissingDependency = {
  dependentName: 'new_case.new_parent', dependentType: 'Column', requiredName: 'account', requiredType: 'Table',
  tableLogicalNames: ['new_case'], solutionUniqueName: 'sample',
};

describe('per-solution installation/import dependencies', () => {
  it('does not infer prerequisites from environment-wide columns, relationships or runtime references', () => {
    const source: ParsedSolution = {
      ...solution,
      entities: [{
        ...solution.entities[0],
        attributes: [{ name: 'new_parent', type: AttributeType.Lookup, required: false, isCustom: true, lookupTarget: 'account, contact', optionSetName: 'external_choices' }],
        relationships: [
          { name: 'outbound', type: 'ManyToOne', referencedEntity: 'account', referencingEntity: 'new_case' },
          { name: 'many', type: 'ManyToMany', referencedEntity: 'new_case', referencingEntity: 'contact' },
        ],
      }],
      views: [{ name: 'active', entityLogicalName: 'new_case', viewType: 'Public', columns: [], fetchXml: '<fetch><entity name="external_table" /></fetch>' }],
      apps: [{ name: 'app', uniqueName: 'app', appType: AppType.ModelDriven, entities: ['new_case', 'external_table'], connectors: ['shared_dataverse'] }],
      processes: [{
        name: 'flow', uniqueName: 'flow', category: ProcessCategory.PowerAutomateFlow, primaryEntity: 'new_case',
        steps: [], relatedEntities: ['external_table'], flowConnectors: ['shared_office365'],
        flowEnvironmentVariables: ['external_variable'], flowConnectionReferences: ['external_connection'],
      }],
      dataverseInsights: { customApis: [], dependencies: [
        { dependentName: 'Unrelated flow', dependentType: 'Process', requiredName: 'unrelated_table', requiredType: 'Table' },
      ] },
    };
    expect(collectMissingDependencies(source)).toEqual([]);
    expect(collectMissingDependencies({ ...source, missingDependencies: [dependency] })).toEqual([dependency]);
  });

  it('includes only the current solution prerequisites even if another solution has been selected', () => {
    const other = { ...dependency, solutionUniqueName: 'other', requiredName: 'other_table' };
    expect(collectMissingDependencies({ ...solution, missingDependencies: [dependency, other] })).toEqual([dependency]);
  });

  it('preserves declared prerequisites rather than guessing component membership from broad metadata', () => {
    const column: MissingDependency = {
      ...dependency, requiredName: 'new_external_field', requiredType: 'Column', requiredParent: 'new_case',
    };
    const source = {
      ...solution,
      entities: [{
        ...solution.entities[0],
        attributes: [{ name: 'new_external_field', type: AttributeType.String, isCustom: true, required: false }],
      }],
      missingDependencies: [column],
    };
    expect(collectMissingDependencies(source)).toEqual([column]);
  });

  it('uses parsed metadata only to associate declared dependencies with worksheet owners', () => {
    const source: ParsedSolution = {
      ...solution,
      forms: [{ name: 'main', displayName: 'Main', entityLogicalName: 'new_case', formType: 'Main', fields: [] }],
      missingDependencies: [{
        dependentName: 'Main', dependentType: 'Form', requiredName: 'external_script.js',
        requiredType: 'Web Resource', tableLogicalNames: [],
      }],
    };
    const dependencies = collectMissingDependencies(source);
    expect(dependencies).toEqual([expect.objectContaining({ tableLogicalNames: ['new_case'], solutionUniqueName: 'sample' })]);
    expect(dependenciesForTable(dependencies, 'NEW_CASE')).toHaveLength(1);
    expect(dependenciesForTable(dependencies, 'unrelated')).toEqual([]);
  });

  it('deduplicates records case-insensitively using component identity and merges table associations', () => {
    const dependencies = collectMissingDependencies({
      ...solution, missingDependencies: [
        { ...dependency, dependentId: '{dep}', requiredId: '{req}' },
        { ...dependency, dependentId: 'DEP', requiredId: 'REQ', dependentName: 'Different label', tableLogicalNames: ['NEW_CASE', 'other'] },
      ],
    });
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0].tableLogicalNames).toEqual(['new_case', 'other']);
  });

  it('does not acquire prerequisites through peer gap fill or a peer runtime graph', () => {
    const other: ParsedSolution = {
      ...solution, metadata: { ...solution.metadata, uniqueName: 'other' },
      missingDependencies: [{ ...dependency, solutionUniqueName: 'other', requiredName: 'other_table' }],
      dataverseInsights: { customApis: [], dependencies: [
        { dependentName: 'Peer flow', dependentType: 'Process', requiredName: 'other_table', requiredType: 'Table' },
      ] },
    };
    expect(collectMissingDependencies(fillSolutionGapsFromPeerSolutions(solution, [other]))).toEqual([]);
    expect(collectMissingDependencies(fillSolutionGapsFromPeerSolutions({ ...solution, missingDependencies: [dependency] }, [other]))).toEqual([dependency]);
  });

  it('keeps each solution installation requirements distinct in consolidated reports', () => {
    const other: ParsedSolution = {
      ...solution, metadata: { ...solution.metadata, uniqueName: 'other' },
      entities: [{ ...solution.entities[0], name: 'account', logicalName: 'account' }],
      missingDependencies: [{ ...dependency, solutionUniqueName: 'other', requiredName: 'contact' }],
    };
    const merged = consolidateSolutions([{ ...solution, missingDependencies: [dependency] }, other]);
    expect(collectMissingDependencies(merged).map((item) => [item.solutionUniqueName, item.requiredName]))
      .toEqual([['other', 'contact'], ['sample', 'account']]);
    expect(collectMissingDependencies(solution)).toEqual([]);
  });

  it('distinguishes a successful empty result from unavailable or uncollected dependencies', () => {
    expect(missingDependenciesNotice(solution)).toBeUndefined();
    expect(missingDependenciesNotice({ ...solution, missingDependencies: undefined })).toContain('have not been collected');
    expect(missingDependenciesNotice({ ...solution, missingDependenciesError: 'Permission denied' })).toBe('Permission denied');
    const merged = consolidateSolutions([solution, {
      ...solution, metadata: { ...solution.metadata, uniqueName: 'other' }, missingDependenciesError: 'Permission denied',
    }]);
    expect(missingDependenciesNotice(merged)).toContain('other: Permission denied');
  });

  it('does not mutate input metadata or its authoritative records', () => {
    const source = { ...solution, missingDependencies: [dependency] };
    const original = JSON.stringify(source);
    collectMissingDependencies(source);
    expect(JSON.stringify(source)).toBe(original);
  });
});
