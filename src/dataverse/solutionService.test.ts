import { describe, expect, it, vi } from 'vitest';

import { buildEntityDefinition, fetchEnvironmentVariables, fetchModernDataverseArtifacts, listDataverseSolutions } from './solutionService';

describe('fetchModernDataverseArtifacts', () => {
  it('collects connected modern artifact families scoped to the selected solution', async () => {
    const solutionId = 'sol-123';
    const mockQueryData = vi.fn(async (url: string) => {
      if (url.startsWith('botcomponents')) {
        return {
          value: [{
            botcomponentid: 'bot-1',
            name: 'Agent One',
            displayname: 'Agent One',
            description: 'Bot agent',
            botcomponenttype: 'copilot',
            language: 'en-US',
          }],
        };
      }
      if (url.startsWith('aimodels')) {
        return {
          value: [{
            aimodelid: 'model-1',
            name: 'Model One',
            displayname: 'Model One',
            provider: 'Contoso',
            version: '1.0',
          }],
        };
      }
      if (url.startsWith('desktopflows')) {
        return {
          value: [{
            desktopflowid: 'flow-1',
            name: 'Desktop Runner',
            displayname: 'Desktop Runner',
            isenabled: true,
            stepcount: 3,
          }],
        };
      }
      if (url.startsWith('dataflows')) {
        return {
          value: [{
            dataflowid: 'df-1',
            name: 'Data Flow One',
            displayname: 'Data Flow One',
            refreshmode: 'Scheduled',
          }],
        };
      }
      if (url.startsWith('mobileofflineprofiles')) {
        return {
          value: [{
            mobileofflineprofileid: 'profile-1',
            name: 'Offline Profile',
            displayname: 'Offline Profile',
            profiletype: 'Mobile',
          }],
        };
      }
      return { value: [] };
    });

    Object.defineProperty(globalThis, 'window', {
      value: {
        dataverseAPI: {
          queryData: mockQueryData,
          fetchXmlQuery: vi.fn(async () => ({ value: [] })),
          getAllEntitiesMetadata: vi.fn(async () => ({ value: [] })),
          getEntityMetadata: vi.fn(async () => ({ value: [] })),
          getEntityRelatedMetadata: vi.fn(async () => ({ value: [] })),
        },
      },
      configurable: true,
    });

    const result = await fetchModernDataverseArtifacts(solutionId, []);

    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].name).toBe('Agent One');
    expect(result.aiModels).toHaveLength(1);
    expect(result.desktopFlows).toHaveLength(1);
    expect(result.dataflows).toHaveLength(1);
    expect(result.offlineProfiles).toHaveLength(1);
    expect(mockQueryData).toHaveBeenCalled();
  });

  it('paginates FetchXML results using the returned paging cookie', async () => {
    const mockFetchXml = vi.fn(async (fetchXml: string) => {
      expect(fetchXml).toContain('<fetch');
      if (fetchXml.includes('page="1"')) {
        return {
          value: [{ solutionid: 'solution-1', friendlyname: 'First' }],
          '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<cookie page="1" />',
        };
      }
      return { value: [{ solutionid: 'solution-2', friendlyname: 'Second' }] };
    });

    Object.defineProperty(globalThis, 'window', {
      value: { dataverseAPI: { fetchXmlQuery: mockFetchXml } },
      configurable: true,
    });

    const solutions = await listDataverseSolutions();
    const firstPage = mockFetchXml.mock.calls[0][0];
    const secondPage = mockFetchXml.mock.calls[1][0];

    expect(solutions).toHaveLength(2);
    expect(firstPage).toContain('count="5000" page="1"');
    expect(secondPage).toContain('count="5000" page="2"');
    expect(secondPage).toContain('paging-cookie="&lt;cookie page=&quot;1&quot; /&gt;"');
  });

  it('stops FetchXML pagination at the configured safety ceiling', async () => {
    const mockFetchXml = vi.fn(async (fetchXml: string) => {
      expect(fetchXml).toMatch(/page="\d+"/);
      return {
        value: [{ solutionid: 'solution-1', friendlyname: 'First' }],
        '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': '<cookie />',
      };
    });
    Object.defineProperty(globalThis, 'window', {
      value: { dataverseAPI: { fetchXmlQuery: mockFetchXml } },
      configurable: true,
    });

    await expect(listDataverseSolutions()).rejects.toThrow('100000-row safety limit');
    expect(mockFetchXml).toHaveBeenCalledTimes(20);
  });

  it('bounds OData queries and reports when results hit the safety limit', async () => {
    const maxRows = Array.from({ length: 5000 }, () => ({}));
    const mockQueryData = vi.fn(async (odataQuery: string) => {
      expect(odataQuery).toContain('$top=5000');
      return { value: maxRows };
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        dataverseAPI: {
          queryData: mockQueryData,
          fetchXmlQuery: vi.fn(async () => ({ value: [] })),
        },
      },
      configurable: true,
    });

    const warnings: string[] = [];
    await fetchModernDataverseArtifacts('solution-1', warnings);

    expect(mockQueryData.mock.calls[0][0]).toContain('&$top=5000');
    expect(warnings.some((warning) => warning.includes('5000-row safety limit'))).toBe(true);
  });

  it('keeps the explicit solution-scoped collection policy on connected solutions', async () => {
    const solution = await (await import('./solutionService')).buildParsedSolutionFromDataverse('sol-123', undefined, 'solutionOnly');
    expect(solution.collectionPolicy).toBe('solutionOnly');
  });

  it('resolves table metadata only for entity IDs in the selected solution', async () => {
    const mockFetchXml = vi.fn(async (fetchXml: string) => {
      if (fetchXml.includes('<entity name="solution">')) {
        return { value: [{ solutionid: 'sol-123', uniquename: 'solution', friendlyname: 'Solution' }] };
      }
      if (fetchXml.includes('<entity name="solutioncomponent">') && fetchXml.includes('operator="eq" value="1"')) {
        return { value: [{ objectid: 'entity-meta-1' }] };
      }
      return { value: [] };
    });
    const mockGetAllEntitiesMetadata = vi.fn(async () => ({ value: [] }));
    const mockGetEntityMetadata = vi.fn(async (name: string, searchByLogicalName: boolean) => ({
      MetadataId: searchByLogicalName ? 'entity-meta-1' : name,
      LogicalName: searchByLogicalName ? name : 'account',
      IsIntersect: false,
      PrimaryNameAttribute: 'name',
    }));
    Object.defineProperty(globalThis, 'window', {
      value: {
        dataverseAPI: {
          fetchXmlQuery: mockFetchXml,
          queryData: vi.fn(async () => ({ value: [] })),
          getAllEntitiesMetadata: mockGetAllEntitiesMetadata,
          getEntityMetadata: mockGetEntityMetadata,
          getEntityRelatedMetadata: vi.fn(async () => ({ value: [] })),
        },
      },
      configurable: true,
    });

    const solution = await (await import('./solutionService')).buildParsedSolutionFromDataverse('sol-123');

    expect(solution.entities.map((entity) => entity.logicalName)).toContain('account');
    expect(mockGetEntityMetadata).toHaveBeenCalledWith('entity-meta-1', false, ['MetadataId', 'LogicalName', 'IsIntersect']);
    expect(mockGetAllEntitiesMetadata).not.toHaveBeenCalled();
  });

  it('treats unavailable modern Dataverse resources as optional capabilities without parse warnings', async () => {
    const mockQueryData = vi.fn(async (url: string) => {
      if (url.startsWith('botcomponents') && url.includes('displayname')) {
        throw new Error("Could not find a property named 'displayname' on type 'Microsoft.Dynamics.CRM.botcomponent'.");
      }
      throw new Error("Resource not found for the segment 'optional-artifact'.");
    });
    const warnings: string[] = [];

    Object.defineProperty(globalThis, 'window', {
      value: {
        dataverseAPI: {
          queryData: mockQueryData,
          fetchXmlQuery: vi.fn(async () => ({ value: [] })),
        },
      },
      configurable: true,
    });

    const result = await fetchModernDataverseArtifacts('sol-123', warnings);

    expect(result.agents).toEqual([]);
    expect(result.aiModels).toEqual([]);
    expect(result.desktopFlows).toEqual([]);
    expect(result.dataflows).toEqual([]);
    expect(result.offlineProfiles).toEqual([]);
    expect(warnings).toEqual([]);
    expect(mockQueryData.mock.calls.some(([url]) => url.includes('botcomponents') && !url.includes('displayname'))).toBe(true);
  });

  it('collects environment variables through solution-component type 380 and redacts live values', async () => {
    const mockFetchXml = vi.fn(async (fetchXml: string) => {
      if (fetchXml.includes('<entity name="environmentvariablevalue">')) {
        return { value: [{ environmentvariablevalueid: 'value-1', environmentvariabledefinitionid: 'env-1' }] };
      }
      if (fetchXml.includes('<entity name="environmentvariabledefinition">')) {
        return { value: [{ environmentvariabledefinitionid: 'env-1', displayname: 'API URL', schemaname: 'sample_ApiUrl', type: 'String', defaultvalue: 'https://default.test' }] };
      }
      return { value: [] };
    });

    Object.defineProperty(globalThis, 'window', {
      value: { dataverseAPI: { fetchXmlQuery: mockFetchXml } },
      configurable: true,
    });

    const warnings: string[] = [];
    const result = await fetchEnvironmentVariables('sol-123', warnings);

    expect(result).toHaveLength(1);
    expect(result[0].schemaName).toBe('sample_ApiUrl');
    expect(result[0].hasCurrentValue).toBe(true);
    expect(result[0].currentValue).toBeUndefined();
    expect(mockFetchXml.mock.calls[0][0]).toContain('componenttype');
    expect(mockFetchXml.mock.calls[0][0]).toContain('380');
    expect(warnings).toEqual([]);
  });

  it('fills lookup targets and option set names from typed attribute queries and relationships', async () => {
    const mockQueryData = vi.fn(async (url: string) => {
      if (url.includes('LookupAttributeMetadata')) {
        return { value: [{ LogicalName: 'primarycontactid', Targets: ['contact'] }] };
      }
      if (url.includes('Microsoft.Dynamics.CRM.PicklistAttributeMetadata')) {
        return {
          value: [{
            LogicalName: 'industrycode',
            OptionSet: { Name: 'account_industrycode', Options: [{ Value: 1, Label: { UserLocalizedLabel: { Label: 'Retail' } } }] },
          }],
        };
      }
      return { value: [] };
    });
    const mockRelated = vi.fn(async (_name: string, kind: string) => {
      if (kind === 'Attributes') {
        return {
          value: [
            { LogicalName: 'primarycontactid', AttributeType: 'Lookup' },
            { LogicalName: 'parentaccountid', AttributeType: 'Lookup' },
            { LogicalName: 'industrycode', AttributeType: 'Picklist' },
          ],
        };
      }
      if (kind === 'ManyToOneRelationships') {
        return { value: [{ SchemaName: 'account_parent', ReferencingEntity: 'account', ReferencingAttribute: 'parentaccountid', ReferencedEntity: 'account' }] };
      }
      return { value: [] };
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        dataverseAPI: {
          queryData: mockQueryData,
          getEntityMetadata: vi.fn(async () => ({ LogicalName: 'account', PrimaryNameAttribute: 'name' })),
          getEntityRelatedMetadata: mockRelated,
        },
      },
      configurable: true,
    });

    const entity = await buildEntityDefinition('account');
    const byName = new Map(entity.attributes.map((attribute) => [attribute.name, attribute]));

    expect(byName.get('primarycontactid')?.lookupTarget).toBe('contact');
    expect(byName.get('parentaccountid')?.lookupTarget).toBe('account');
    expect(byName.get('industrycode')?.optionSetName).toBe('account_industrycode');
    expect(byName.get('industrycode')?.options).toHaveLength(1);
  });
});
