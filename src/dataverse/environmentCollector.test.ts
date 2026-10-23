import { afterEach, describe, expect, it, vi } from 'vitest';
import { AGGREGATE_RECORD_LIMIT, collectEnvironmentAppendix, formatOrganizationSetting, languageName } from './environmentCollector';
import { DataverseCollectionCancelledError, withDataverseAbortSignal } from './dataverseClient';
import { XMLParser } from 'fast-xml-parser';

const connection = { name: 'Contoso Dev', url: 'https://contoso.crm.dynamics.com', environment: 'Dev' as const, enabledForPowerPlatformAPI: false };

interface FetchFilter {
  '@_type'?: string;
  condition?: { '@_attribute': string; '@_operator': string; '@_value'?: string }[];
  filter?: FetchFilter[];
  'link-entity'?: FetchLink[];
}
interface FetchLink {
  '@_name': string;
  filter?: FetchFilter[];
  'link-entity'?: FetchLink[];
}
type FixtureRow = Record<string, unknown>;

function matchesLink(link: FetchLink, row: FixtureRow): boolean {
  const related = row[link['@_name']];
  if (!Array.isArray(related)) return false;
  return related.some((candidate: FixtureRow) => (link.filter ?? []).every((filter) => matchesFilter(filter, candidate))
    && (link['link-entity'] ?? []).every((child) => matchesLink(child, candidate)));
}

function matchesFilter(filter: FetchFilter, row: FixtureRow): boolean {
  const conditions = (filter.condition ?? []).map((condition) => {
    const value = row[condition['@_attribute']];
    switch (condition['@_operator']) {
      case 'eq': return String(value) === condition['@_value'];
      case 'null': return value === null || value === undefined;
      case 'not-null': return value !== null && value !== undefined;
      default: throw new Error(`Unhandled fixture condition: ${condition['@_operator']}`);
    }
  });
  const results = [
    ...conditions,
    ...(filter.filter ?? []).map((child) => matchesFilter(child, row)),
    ...(filter['link-entity'] ?? []).map((link) => matchesLink(link, row)),
  ];
  return filter['@_type'] === 'or' ? results.some(Boolean) : results.every(Boolean);
}

function installWindow(overrides: { fetchXmlQuery?: (xml: string) => Promise<unknown>; queryData?: (query: string) => Promise<unknown>; powerplatformAPI?: unknown } = {}) {
  const execute = vi.fn(async ({ operationName }: { operationName: string }) => {
    if (operationName === 'RetrieveCurrentOrganization') {
      return { Detail: { FriendlyName: 'Contoso', EnvironmentId: 'env-1', TenantId: 'tenant-1', Geo: 'NA' } };
    }
    if (operationName === 'RetrieveVersion') return { Version: '9.2.25000.1' };
    if (operationName === 'RetrieveProvisionedLanguages') return { RetrieveProvisionedLanguages: [1036, 1033] };
    return {};
  });
  const queryData = vi.fn(overrides.queryData ?? (async (query: string) => {
    if (query.startsWith('organizations')) return { value: [{ name: 'Contoso', languagecode: 1033, _basecurrencyid_value: 'cur-usd', isauditenabled: true }] };
    if (query.startsWith('transactioncurrencies')) {
      return { value: [
        { transactioncurrencyid: 'cur-eur', isocurrencycode: 'EUR', currencyname: 'Euro', statecode: 0 },
        { transactioncurrencyid: 'cur-usd', isocurrencycode: 'USD', currencyname: 'US Dollar', statecode: 0 },
      ] };
    }
    if (query.startsWith('EntityDefinitions')) return { value: [
      { LogicalName: 'account', IsCustomEntity: false }, { LogicalName: 'con_thing', IsCustomEntity: true },
      { LogicalName: 'msdyn_system', IsCustomEntity: true },
    ] };
    return { value: [] };
  }));
  const fetchXmlQuery = vi.fn(overrides.fetchXmlQuery ?? (async (xml: string) => {
    if (xml.includes('aggregate="true"')) return { value: [{ total: 7 }] };
    if (xml.includes('<entity name="solution">')) {
      return { value: [
        { uniquename: 'Default', friendlyname: 'Default Solution', version: '1.0', ismanaged: false, 'publisher.friendlyname': 'Default Publisher' },
        { uniquename: 'msdyn_Core', friendlyname: 'Core', version: '2.0', ismanaged: true, 'publisher.uniquename': 'MicrosoftDynamics' },
      ] };
    }
    if (xml.includes('<entity name="publisher">')) return { value: [
      { uniquename: 'contoso', friendlyname: 'Contoso', customizationprefix: 'con' },
      { uniquename: 'MicrosoftDynamics', friendlyname: 'Microsoft Dynamics', customizationprefix: 'msdyn' },
      { uniquename: 'DefaultPublisher123', friendlyname: 'Default Publisher', customizationprefix: 'new' },
    ] };
    if (xml.includes('<entity name="businessunit">')) return { value: [{ businessunitid: 'sales-id', name: 'Sales', 'parent.name': 'Contoso' }, { businessunitid: 'root-id', name: 'Contoso' }] };
    return { value: [] };
  }));
  Object.defineProperty(globalThis, 'window', {
    value: { dataverseAPI: { execute, queryData, fetchXmlQuery }, powerplatformAPI: overrides.powerplatformAPI },
    configurable: true,
  });
  return { execute, queryData, fetchXmlQuery };
}

describe('collectEnvironmentAppendix', () => {
  afterEach(() => vi.restoreAllMocks());

  it('collects identity, settings, languages, currencies, counts, solutions, publishers, and business units', async () => {
    const { fetchXmlQuery } = installWindow();
    const appendix = await collectEnvironmentAppendix(connection);

    expect(appendix.identity).toEqual(expect.arrayContaining([
      { name: 'Connection Name', value: 'Contoso Dev' },
      { name: 'Environment ID', value: 'env-1' },
      { name: 'Dataverse Version', value: '9.2.25000.1' },
    ]));
    expect(appendix.languages.map((language) => [language.lcid, language.isBaseLanguage])).toEqual([[1033, true], [1036, false]]);
    expect(appendix.currencies[0]).toMatchObject({ isoCode: 'EUR', isBaseCurrency: false });
    expect(appendix.currencies.find((currency) => currency.isoCode === 'USD')?.isBaseCurrency).toBe(true);
    expect(appendix.counts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Tables (total)', value: 3, custom: expect.objectContaining({ value: 1, unclassified: 0 }) }),
      expect.objectContaining({ label: 'Users in environment', value: 7 }),
      expect.objectContaining({ label: 'Managed solutions', value: 1 }),
      expect.objectContaining({ label: 'Business units', value: 2 }),
    ]));
    expect(appendix.counts.find((count) => count.label === 'Users in tenant')?.value).toBeUndefined();
    expect(appendix.solutions.map((solution) => solution.uniqueName)).toEqual(['msdyn_Core', 'Default']);
    expect(appendix.publishers[0]).toMatchObject({ uniqueName: 'contoso', customizationPrefix: 'con' });
    expect(appendix.businessUnits[0]).toMatchObject({ name: 'Contoso', parentName: undefined });
    expect(appendix.warnings).toEqual([]);
    const queries = fetchXmlQuery.mock.calls.map(([xml]) => xml);
    queries.filter((xml) => xml.includes('<entity name="workflow">')).forEach((xml) => {
      expect(xml).toContain('attribute="type" operator="eq" value="1"');
    });
    expect(queries.find((xml) => xml.includes('<entity name="role">'))).toContain('attribute="parentroleid" operator="null"');
  });

  it('never queries user names or environment-variable values', async () => {
    const { fetchXmlQuery, queryData } = installWindow();
    await collectEnvironmentAppendix(connection);

    const allQueries = [...fetchXmlQuery.mock.calls.map(([xml]) => xml), ...queryData.mock.calls.map(([query]) => query)].join('\n');
    expect(allQueries).not.toMatch(/environmentvariablevalue/i);
    expect(allQueries).not.toMatch(/name="(fullname|domainname|internalemailaddress)"/i);
    const systemUserQueries = fetchXmlQuery.mock.calls.map(([xml]) => xml).filter((xml) => xml.includes('systemuser'));
    expect(systemUserQueries.length).toBeGreaterThan(0);
    systemUserQueries.forEach((xml) => expect(xml).toContain('aggregate="true"'));
  });

  it('explains why Power Platform API data is absent when the connection does not allow it', async () => {
    installWindow();
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.powerPlatformSettings).toEqual([]);
    expect(appendix.powerPlatformStatus).toMatch(/not enabled/i);
  });

  it('reads Power Platform API settings and installed application packages when enabled', async () => {
    const powerplatformAPI = {
      EnvironmentManagement: { Get: vi.fn(async () => ({ objectResult: { isCopilotEnabled: true, retentionDays: 7, nested: { ignored: true } } })) },
      AppManagement: { Get: vi.fn(async () => ({ value: [{ localizedName: 'Dynamics 365 Sales', uniqueName: 'msdyn_Sales', version: '9.0', state: 'Installed' }] })) },
    };
    installWindow({ powerplatformAPI });
    const appendix = await collectEnvironmentAppendix({ ...connection, enabledForPowerPlatformAPI: true });

    expect(powerplatformAPI.EnvironmentManagement.Get).toHaveBeenCalledWith(expect.stringContaining('environments/env-1/settings'));
    expect(appendix.powerPlatformSettings).toEqual([
      { name: 'Is Copilot Enabled', value: 'Yes' },
      { name: 'Retention Days', value: '7' },
    ]);
    expect(appendix.applicationPackages).toEqual([expect.objectContaining({ name: 'Dynamics 365 Sales', uniqueName: 'msdyn_Sales' })]);
    expect(appendix.powerPlatformStatus).toBeUndefined();
  });

  it('does not invent a numerical lower bound from an aggregate input limit', async () => {
    installWindow({
      fetchXmlQuery: async (xml: string) => {
        if (xml.includes('entity name="team"')) throw new Error('AggregateQueryRecordLimit exceeded');
        if (xml.includes('entity name="canvasapp"')) throw new Error('Entity not found');
        if (xml.includes('aggregate="true"')) return { value: [{ total: 1 }] };
        return { value: [] };
      },
    });
    const appendix = await collectEnvironmentAppendix(connection);
    const teams = appendix.counts.find((count) => count.label === 'Teams');
    expect(teams?.value).toBeUndefined();
    expect(teams?.isLowerBound).toBeUndefined();
    expect(teams?.note).toContain('AggregateQueryRecordLimit');
    expect(teams?.note).not.toContain(String(AGGREGATE_RECORD_LIMIT));
    const canvas = appendix.counts.find((count) => count.label === 'Canvas apps');
    expect(canvas?.value).toBeUndefined();
    expect(canvas?.note).toMatch(/unavailable/i);
  });

  it('rethrows cancellation instead of converting it to a warning', async () => {
    installWindow();
    const controller = new AbortController();
    controller.abort();
    await expect(withDataverseAbortSignal(controller.signal, () => collectEnvironmentAppendix(connection)))
      .rejects.toBeInstanceOf(DataverseCollectionCancelledError);
  });

  it('counts distinct enabled environment users through direct roles OR non-default teams, not tenant/default-team membership', async () => {
    const role = { roleid: 'role-1' };
    const directRoles = [{ role: [role] }, { role: [{ roleid: 'role-2' }] }];
    const nonDefaultTeams = [{ team: [{ teamid: 'team-1', isdefault: 0 }] }, { team: [{ teamid: 'team-2', isdefault: 0 }] }];
    const human = (id: string, extra: FixtureRow): FixtureRow => ({
      systemuserid: id, isdisabled: 0, azureactivedirectoryobjectid: `aad-${id}`, ...extra,
    });
    const users = [
      human('direct-only', { systemuserroles: directRoles }),
      human('team-only', { teammembership: nonDefaultTeams }),
      human('both', { systemuserroles: directRoles, teammembership: nonDefaultTeams }),
      human('both', { systemuserroles: directRoles, teammembership: nonDefaultTeams }),
      human('default-team-only', { teammembership: [{ team: [{ teamid: 'default-team', isdefault: 1 }] }] }),
      human('no-access', {}),
      human('disabled', { isdisabled: 1, systemuserroles: directRoles }),
      human('application', { applicationid: 'app-1', systemuserroles: directRoles }),
      human('system', { azureactivedirectoryobjectid: null, systemuserroles: directRoles }),
      human('orphaned-role', { systemuserroles: [{ role: [] }] }),
    ];
    const parser = new XMLParser({
      ignoreAttributes: false, attributeNamePrefix: '@_', isArray: (name: string) => ['filter', 'condition', 'link-entity', 'attribute'].includes(name),
    });
    const { fetchXmlQuery } = installWindow({ fetchXmlQuery: async (xml) => {
      if (!xml.includes('<entity name="systemuser">')) return { value: xml.includes('aggregate="true"') ? [{ total: 7 }] : [] };
      const { fetch: { entity } } = parser.parse(xml) as { fetch: { entity: { filter: FetchFilter[]; attribute: { '@_aggregate': string; '@_distinct': string }[] } } };
      const matching = users.filter((user) => entity.filter.every((filter) => matchesFilter(filter, user)));
      const count = entity.attribute[0]['@_aggregate'] === 'countcolumn' && entity.attribute[0]['@_distinct'] === 'true'
        ? new Set(matching.map((user) => user.systemuserid)).size : matching.length;
      return { value: [{ total: count }] };
    } });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Users in environment')?.value).toBe(3);
    expect(appendix.counts.find((count) => count.label === 'Application users in environment')?.value).toBe(1);
    expect(appendix.counts.find((count) => count.label === 'Users in tenant')).toMatchObject({ note: expect.stringContaining('not the tenant directory') });
    const queries = fetchXmlQuery.mock.calls.map(([xml]) => xml).filter((xml) => xml.includes('<entity name="systemuser">'));
    queries.forEach((xml) => {
      expect(xml).toContain('aggregate="countcolumn" distinct="true"');
      expect(xml).toContain('link-type="any"');
      expect(xml).toContain('attribute="isdefault" operator="eq" value="0"');
      expect(xml).not.toContain('attribute="statecode"');
      expect(xml).not.toContain('fullname');
    });
  });

  it('de-duplicates primary keys and separates customer, Microsoft, default and unknown publisher namespaces', async () => {
    installWindow({ fetchXmlQuery: async (xml) => {
      if (xml.includes('aggregate="true"')) return { value: [{ total: 10 }] };
      if (xml.includes('<entity name="publisher">')) return { value: [
        { uniquename: 'Contoso', friendlyname: 'Contoso', customizationprefix: 'con' },
        { uniquename: 'MicrosoftDynamics', friendlyname: 'Microsoft Dynamics', customizationprefix: 'msdyn' },
        { uniquename: 'DefaultPublisher123', friendlyname: 'Default Publisher', customizationprefix: 'new' },
      ] };
      if (xml.includes('<entity name="canvasapp">')) return { value: [
        { canvasappid: 'a', name: 'con_app', ismanaged: true },
        { canvasappid: '{A}', name: 'con_app', ismanaged: true },
        { canvasappid: 'b', name: 'con_other', ismanaged: false },
        { canvasappid: 'c', name: 'msdyn_system' },
        { canvasappid: 'd', name: 'new_default' },
        { canvasappid: 'e', name: 'unknown_app' },
        { canvasappid: 'f', name: 'No namespace' },
      ] };
      return { value: [] };
    } });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Canvas apps')).toMatchObject({
      value: 6, custom: { value: 2, unclassified: 2 },
    });
    expect(appendix.counts.find((count) => count.label === 'Tables (total)')).toMatchObject({
      value: 3, custom: { value: 1, unclassified: 0 },
    });
    appendix.counts.forEach((count) => {
      if (count.value !== undefined && count.custom?.value !== undefined && count.custom.unclassified !== undefined) {
        expect(count.custom.value + count.custom.unclassified).toBeLessThanOrEqual(count.value);
      }
    });
  });

  it('keeps component totals but marks provenance unclassified when publisher retrieval fails', async () => {
    installWindow({ fetchXmlQuery: async (xml) => {
      if (xml.includes('<entity name="publisher">')) throw new Error('Publisher access denied');
      return { value: xml.includes('aggregate="true"') ? [{ total: 1 }]
        : xml.includes('<entity name="canvasapp">') ? [{ canvasappid: 'app', name: 'con_app' }] : [] };
    } });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Canvas apps')).toMatchObject({
      value: 1, custom: { value: 0, unclassified: 1 },
    });
    expect(appendix.counts.find((count) => count.label === 'Publishers')?.value).toBeUndefined();
    expect(appendix.warnings.join(' ')).toContain('Publisher access denied');
  });

  it('recognises Microsoft namespaces even when their publisher is absent from the publisher inventory', async () => {
    installWindow({
      queryData: async (query) => ({ value: query.startsWith('EntityDefinitions') ? [
        { LogicalName: 'account', IsCustomEntity: false },
        { LogicalName: 'msdynmkt_event', IsCustomEntity: true },
        { LogicalName: 'msdyn_internal', IsCustomEntity: true },
        { LogicalName: 'unverified_table', IsCustomEntity: true },
      ] : [] }),
      fetchXmlQuery: async (xml) => ({ value: xml.includes('aggregate="true"') ? [{ total: 0 }]
        : xml.includes('<entity name="customapi">') ? [
          { customapiid: 'microsoft', uniquename: 'msdynmkt_DoWork' },
          { customapiid: 'unknown', uniquename: 'unverified_DoWork' },
        ] : [] }),
    });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Tables (total)')).toMatchObject({
      value: 4, custom: { value: 0, unclassified: 1 },
    });
    expect(appendix.counts.find((count) => count.label === 'Custom APIs')).toMatchObject({
      value: 2, custom: { value: 0, unclassified: 1 },
    });
  });

  it.each([
    ['pluginassembly', 'pluginassemblyid', 'Plug-in assemblies'],
    ['sdkmessageprocessingstep', 'sdkmessageprocessingstepid', 'Plug-in steps'],
    ['customapi', 'customapiid', 'Custom APIs'],
    ['webresource', 'webresourceid', 'Web resources'],
  ])('uses associated managed solution publishers for %s without guessing unmanaged ownership', async (entity, id, label) => {
    const source = (key: string, publisher: string, managed: boolean, solution = 'InstalledSolution') => ({
      [id]: key, name: `Assembly.${key}`, uniquename: `NoNamespace${key}`,
      'origin_solution.uniquename': solution, 'origin_solution.ismanaged': managed,
      'origin_publisher.uniquename': publisher, 'origin_publisher.customizationprefix': 'con',
    });
    const { fetchXmlQuery } = installWindow({ fetchXmlQuery: async (xml) => {
      if (xml.includes(`<entity name="${entity}">`)) {
        expect(xml).toContain('from="solutionid" to="solutionid"');
        expect(xml).not.toContain('name="solutioncomponent"');
        return { value: [
          source('customer', 'Contoso', true),
          source('microsoft', 'MicrosoftDynamics', true),
          source('unmanaged', 'Contoso', false),
          source('default', 'DefaultPublisher123', true),
          source('active', 'Contoso', true, 'Active'),
          { [id]: 'no-source', name: 'NoSource', uniquename: 'NoSource' },
        ] };
      }
      return { value: xml.includes('aggregate="true"') ? [{ total: 0 }] : [] };
    } });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === label)).toMatchObject({
      value: 6, custom: { value: 1, unclassified: 3 },
    });
    expect(fetchXmlQuery).toHaveBeenCalled();
  });

  it.each([
    ['sdkmessageprocessingstep', 'sdkmessageprocessingstepid', 'Plug-in steps', 32927],
    ['webresource', 'webresourceid', 'Web resources', 20673],
  ])('collects every %s record using real Web API cookie envelopes', async (entity, id, label, total) => {
    const { fetchXmlQuery } = installWindow({ fetchXmlQuery: async (xml) => {
      if (!xml.includes(`<entity name="${entity}">`)) {
        return { value: xml.includes('aggregate="true"') ? [{ total: 0 }] : [] };
      }
      expect(xml).not.toContain('aggregate="true"');
      const root = new XMLParser({ ignoreAttributes: false }).parse(xml).fetch;
      const page = Number(root['@_page']);
      if (page > 1) expect(root['@_paging-cookie']).toBe(`<cookie page="${page - 1}"><${id} last="${(page - 1) * 5000 - 1}" /></cookie>`);
      const start = (page - 1) * 5000;
      const count = Math.min(5000, total - start);
      const value = Array.from({ length: count }, (_, offset) => ({
        [id]: String(start + offset),
        name: (start + offset) % 3 === 1 ? `msdyn_resource_${start + offset}` : 'NoNamespace',
        ...((start + offset) % 3 === 0 ? {
          'origin_solution.uniquename': 'ContosoManaged',
          'origin_solution.ismanaged': true,
          'origin_publisher.uniquename': 'Contoso',
          'origin_publisher.customizationprefix': 'con',
        } : {}),
      }));
      const cookie = `<cookie page="${page}"><${id} last="${start + count - 1}" /></cookie>`;
      return {
        value,
        ...(start + count < total ? {
          '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': `<cookie pagenumber="${page + 1}" pagingcookie="${encodeURIComponent(encodeURIComponent(cookie))}" />`,
        } : {}),
      };
    } });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === label)).toMatchObject({
      value: total, custom: { value: Math.ceil(total / 3), unclassified: Math.floor(total / 3) },
    });
    expect(appendix.warnings).toEqual([]);
    expect(fetchXmlQuery.mock.calls.filter(([xml]) => xml.includes(`<entity name="${entity}">`))).toHaveLength(Math.ceil(total / 5000));
  });

  it('keeps ambiguous publisher prefixes unclassified', async () => {
    installWindow({ fetchXmlQuery: async (xml) => ({ value: xml.includes('aggregate="true"') ? [{ total: 1 }]
      : xml.includes('<entity name="publisher">') ? [
        { uniquename: 'MicrosoftShared', friendlyname: 'Microsoft', customizationprefix: 'con' },
        { uniquename: 'Contoso', friendlyname: 'Contoso', customizationprefix: 'con' },
      ] : xml.includes('<entity name="canvasapp">') ? [{ canvasappid: 'app', name: 'con_app' }] : [] }) });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Canvas apps')).toMatchObject({
      value: 1, custom: { value: 0, unclassified: 1 },
    });
  });

  it.each([undefined, null, 'bad', -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid aggregate total instead of showing zero: %s', async (total) => {
    installWindow({ fetchXmlQuery: async (xml) => ({ value: xml.includes('aggregate="true"') ? [{ total }] : [] }) });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Users in environment')).toMatchObject({
      note: expect.stringContaining('invalid distinct count'),
    });
    expect(appendix.counts.find((count) => count.label === 'Users in environment')?.value).toBeUndefined();
  });

  it.each([
    { rows: [], expected: undefined },
    { rows: [{ total: 0 }], expected: 0 },
    { rows: [{ total: { Value: '8' } }], expected: 8 },
  ])('distinguishes missing aggregate rows, genuine zero and wrapped SDK totals: $expected', async ({ rows, expected }) => {
    installWindow({ fetchXmlQuery: async (xml) => ({ value: xml.includes('aggregate="true"') ? rows : [] }) });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Users in environment')?.value).toBe(expected);
  });

  it('reports malformed solution management flags as unavailable, not unmanaged', async () => {
    installWindow({ fetchXmlQuery: async (xml) => ({ value: xml.includes('aggregate="true"') ? [{ total: 0 }]
      : xml.includes('<entity name="solution">') ? [{ uniquename: 'Contoso', friendlyname: 'Contoso' }] : [] }) });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Unmanaged solutions')?.value).toBeUndefined();
    expect(appendix.warnings.join(' ')).toContain('managed flag');
  });

  it('retains a valid aggregate total when publisher metadata cannot be enumerated, without guessing custom counts', async () => {
    installWindow({ fetchXmlQuery: async (xml) => {
      if (xml.includes('<entity name="canvasapp">') && !xml.includes('aggregate="true"')) throw new Error('Metadata access denied');
      return { value: xml.includes('aggregate="true"') ? [{ total: '12' }] : [] };
    } });
    const appendix = await collectEnvironmentAppendix(connection);
    expect(appendix.counts.find((count) => count.label === 'Canvas apps')).toMatchObject({
      value: 12, custom: { note: expect.stringContaining('Metadata access denied') },
    });
    expect(appendix.counts.find((count) => count.label === 'Canvas apps')?.custom?.value).toBeUndefined();
  });

  it('does not convert failed solution/business-unit reads or a partial metadata catalogue into zero totals', async () => {
    installWindow({
      fetchXmlQuery: async (xml) => {
        if (xml.includes('<entity name="solution">') || xml.includes('<entity name="businessunit">')) throw new Error('Access denied');
        return { value: xml.includes('aggregate="true"') ? [{ total: 0 }] : [] };
      },
      queryData: async (query) => query.startsWith('EntityDefinitions')
        ? { value: [{ LogicalName: 'account' }], '@odata.nextLink': 'more-metadata' } : { value: [] },
    });
    const appendix = await collectEnvironmentAppendix(connection);
    for (const label of ['Installed solutions (visible)', 'Managed solutions', 'Unmanaged solutions', 'Business units', 'Tables (total)']) {
      expect(appendix.counts.find((count) => count.label === label)?.value).toBeUndefined();
    }
    expect(appendix.warnings.join(' ')).toContain('partial metadata collection');
  });
});

describe('environment formatting helpers', () => {
  it('maps LCIDs to language names with a numeric fallback', () => {
    expect(languageName(1033)).toMatch(/English/);
    expect(languageName(99999)).toContain('99999');
  });

  it('formats boolean organisation settings and reports malformed numbers explicitly', () => {
    expect(formatOrganizationSetting(true, 'boolean')).toBe('Yes');
    expect(formatOrganizationSetting(undefined, 'boolean')).toBeUndefined();
    expect(formatOrganizationSetting('bad', 'number')).toContain('Unavailable');
    expect(formatOrganizationSetting('bad', 'minutes')).toContain('Unavailable');
    expect(formatOrganizationSetting('bad', 'boolean')).toContain('Unavailable');
    expect(formatOrganizationSetting(512, 'bytes')).toBe('0.5 MB (512 KB)');
  });
});
