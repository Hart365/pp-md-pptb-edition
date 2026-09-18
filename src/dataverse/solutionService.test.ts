import { describe, expect, it, vi } from 'vitest';

import { fetchEnvironmentVariables, fetchModernDataverseArtifacts } from './solutionService';

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

  it('keeps the explicit solution-scoped collection policy on connected solutions', async () => {
    const solution = await (await import('./solutionService')).buildParsedSolutionFromDataverse('sol-123', undefined, 'solutionOnly');
    expect(solution.collectionPolicy).toBe('solutionOnly');
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
});
