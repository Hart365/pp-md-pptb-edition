import { describe, expect, it, vi } from 'vitest';
import componentTypeReference from '../../docs/research/solution-component-types.json?raw';
import { buildParsedSolutionFromDataverse, fetchEnvironmentVariables, fetchSolutionComponentDetails } from './solutionService';
import { SOLUTION_COMPONENT_TYPE_NAMES } from './componentTypes';
import { AttributeType } from '../types/solution';
import type { EntityDefinition } from '../types/solution';

const guid = (value: number) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`;
const label = (value: string) => ({ UserLocalizedLabel: { Label: value } });
const installApi = (api: Record<string, unknown>) => Object.defineProperty(globalThis, 'window', {
  value: { dataverseAPI: api }, configurable: true,
});
const columnEntity: EntityDefinition = {
  name: 'account', logicalName: 'account', displayName: 'Account', isCustom: false, relationships: [],
  attributes: [{ metadataId: guid(200), name: 'new_flag', displayName: 'Flag', type: AttributeType.Boolean, required: false, isCustom: true }],
};

describe('complete connected component coverage', () => {
  it('keeps all documented component codes and UK English display names in sync', () => {
    const reference: { componentTypes: { value: number; label: string }[] } = JSON.parse(componentTypeReference);
    expect(Object.keys(SOLUTION_COMPONENT_TYPE_NAMES)).toHaveLength(reference.componentTypes.length);
    reference.componentTypes.forEach(({ value, label }) => {
      expect(SOLUTION_COMPONENT_TYPE_NAMES[value]).toBe(label);
    });
  });

  it('documents all 64 components in the reported nine type groups using solution IDs and runtime metadata', async () => {
    const counts = new Map([[9, 14], [62, 3], [431, 1], [432, 1], [2, 1], [10084, 4], [10087, 3], [10164, 36], [10350, 1]]);
    let nextId = 1;
    const inventory = [...counts].flatMap(([type, count]) => Array.from({ length: count }, () => ({
      componenttype: type, objectid: type === 2 ? guid(200) : guid(nextId++),
    })));
    const dynamic = [10084, 10087, 10164, 10350].map((type) => ({
      LogicalName: type === 10084 ? 'appsetting' : type === 10087 ? 'settingdefinition' : `sample_type${type}`,
      ObjectTypeCode: type, PrimaryIdAttribute: `sample_type${type}id`, PrimaryNameAttribute: 'name',
      DisplayName: label(`Runtime type ${type}`),
    }));
    const queryData = vi.fn(async (query: string) => {
      const id = /GlobalOptionSetDefinitions\(([^)]+)\)/.exec(query)?.[1];
      if (id) {
        const choice = {
          MetadataId: id, Name: `new_choice_${id.slice(-2)}`, DisplayName: label('Global choice'),
          Description: label('Choice description'), IsGlobal: true,
          Options: [{ Value: 7, Label: label('Seven'), Description: label('Option description'), Color: '#123456' }],
        };
        return Number(id.slice(-2)) % 2 ? choice : { value: [choice] };
      }
      return { value: dynamic };
    });
    const fetchXmlQuery = vi.fn(async (xml: string) => {
      if (xml.includes('<entity name="solutioncomponent">')) return { value: inventory };
      const entity = /<entity name="([^"]+)"/.exec(xml)?.[1];
      const type = entity === 'sitemap' ? 62 : entity === 'attributeimageconfig' ? 431 : entity === 'entityimageconfig' ? 432
        : dynamic.find((item) => item.LogicalName === entity)?.ObjectTypeCode;
      const descriptor = dynamic.find((item) => item.ObjectTypeCode === type);
      const idField = type === 62 ? 'sitemapid' : type === 431 ? 'attributeimageconfigid' : type === 432 ? 'entityimageconfigid' : descriptor?.PrimaryIdAttribute ?? '';
      return { value: inventory.filter((item) => item.componenttype === type).map((item) => ({
        [idField]: item.objectid, name: `Config ${item.objectid}`, sitemapname: 'Sales Navigation',
        sitemapxml: '<SiteMap><Area Id="Sales"><Group Id="Work"><SubArea Id="Accounts" Entity="account" /></Group></Area></SiteMap>',
        parententitylogicalname: 'account', attributelogicalname: 'entityimage', primaryimageattribute: 'entityimage',
        canstorefullimage: false, description: 'Configuration description', isenabled: false, value: 'false', defaultvalue: 'true',
      })) };
    });
    const getEntityRelatedMetadata = vi.fn(async () => ({ value: [
      { LogicalName: 'name', AttributeType: 'String', DisplayName: label('Name') },
      { LogicalName: 'description', AttributeType: 'String' },
      { LogicalName: 'isenabled', AttributeType: 'Boolean', DisplayName: label('Enabled') },
      { LogicalName: 'password', AttributeType: 'String' },
      { LogicalName: 'secureflag', AttributeType: 'Boolean', IsSecured: true },
      { LogicalName: 'value', AttributeType: 'String' },
      { LogicalName: 'defaultvalue', AttributeType: 'String' },
    ] }));
    installApi({ queryData, fetchXmlQuery, getEntityRelatedMetadata });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected-solution', [columnEntity], warnings);

    expect(inventory).toHaveLength(64);
    expect(result.optionSets).toHaveLength(14);
    expect(result.optionSets[0].options[0]).toMatchObject({ value: 7, label: 'Seven', color: '#123456', description: 'Option description' });
    expect(result.solutionComponents).toHaveLength(50);
    expect(result.unmappedComponents).toEqual([]);
    expect(warnings).toEqual([]);
    expect(result.solutionComponents.find((item) => item.componentType === 62)?.properties).toContainEqual({ name: 'Navigation', value: 'Sales\nSales / Work\nSales / Work / Accounts (account)' });
    expect(result.solutionComponents.find((item) => item.componentType === 431)?.properties).toContainEqual({ name: 'Can Store Full Image', value: 'No' });
    expect(result.solutionComponents.find((item) => item.componentType === 2)?.name).toBe('account.new_flag');
    for (const type of dynamic) {
      expect(result.solutionComponents.filter((item) => item.componentType === type.ObjectTypeCode)).toHaveLength(counts.get(type.ObjectTypeCode)!);
      expect(result.solutionComponents.find((item) => item.componentType === type.ObjectTypeCode)?.componentTypeName).toBe(`Runtime type ${type.ObjectTypeCode}`);
    }
    const recordQueries = fetchXmlQuery.mock.calls.map(([xml]) => xml).filter((xml) => !xml.includes('<entity name="solutioncomponent">'));
    expect(recordQueries.every((xml) => xml.includes('operator="in"') && !xml.includes('<all-attributes'))).toBe(true);
    expect(queryData.mock.calls.every(([query]) => !query.includes('$top'))).toBe(true);
    expect(recordQueries.join('')).not.toMatch(/attribute name="(?:password|secureflag)"/);
    expect(recordQueries.filter((xml) => xml.includes('<entity name="sample_type')).join('')).not.toContain('<attribute name="value"');
  });

  it('retrieves boolean global choices and retains explicit errors without discarding other records in the same group', async () => {
    installApi({
      queryData: vi.fn(async () => ({
        Name: 'new_boolean', TrueOption: { Value: 1, Label: label('Enabled') }, FalseOption: { Value: 0, Label: label('Disabled') },
      })),
      fetchXmlQuery: vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="solutioncomponent">')
        ? [{ componenttype: 9, objectid: guid(1) }, { componenttype: 432, objectid: guid(2) }, { componenttype: 432, objectid: guid(3) }]
        : [{ entityimageconfigid: guid(2), parententitylogicalname: 'account', primaryimageattribute: 'entityimage' }] })),
    });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.optionSets[0].options.map((option) => option.value)).toEqual([0, 1]);
    expect(result.solutionComponents).toHaveLength(1);
    expect(result.unmappedComponents).toEqual([expect.objectContaining({ componentType: 432, objectId: guid(3), componentTypeName: 'Entity Image Configuration' })]);
    expect(warnings[0]).toContain('was not returned when searched by');
  });

  it('matches site maps by component-layer identifiers as well as primary identifiers', async () => {
    const ids = [guid(62), guid(63)];
    const fetchXmlQuery = vi.fn(async (xml: string) => {
      if (xml.includes('<entity name="solutioncomponent">')) {
        return { value: ids.map((objectid) => ({ componenttype: 62, objectid })) };
      }
      expect(xml).toContain('<attribute name="sitemapidunique"');
      expect(xml).toContain('<condition attribute="sitemapidunique" operator="in"');
      expect(xml).toContain('<condition attribute="sitemapid" operator="in"');
      return { value: [
        { sitemapid: guid(620), sitemapidunique: `{${ids[0].toUpperCase()}}`, sitemapname: 'Sales',
          sitemapxml: '<SiteMap><Area Id="Sales"><Group Id="Work"><SubArea Id="Accounts" Entity="account" /></Group></Area></SiteMap>' },
        { sitemapid: ids[1], sitemapidunique: guid(630), sitemapname: 'Service', sitemapxml: '<SiteMap />' },
      ] };
    });
    installApi({ fetchXmlQuery });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.solutionComponents.map((item) => [item.objectId, item.name])).toEqual([
      [ids[0], 'Sales'], [ids[1], 'Service'],
    ]);
    expect(result.solutionComponents[0].properties).toContainEqual({
      name: 'Navigation', value: 'Sales\nSales / Work\nSales / Work / Accounts (account)',
    });
    expect(result.unmappedComponents).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it.each([
    [10084, 'runtime_appelement', 'appelementid', 'Model-Driven App Element'],
    [10087, 'runtime_appsetting', 'appsettingid', 'Model-Driven App Setting'],
  ])('resolves type %s from metadata and matches only its <primary id>unique solution-layer identifier', async (type, logicalName, primaryId, typeName) => {
    const objectId = guid(type);
    const alternateId = `${primaryId}unique`;
    const fetchXmlQuery = vi.fn(async (xml: string) => {
      if (xml.includes('<entity name="solutioncomponent">')) return { value: [{ componenttype: type, objectid: objectId }] };
      expect(xml).toContain(`<entity name="${logicalName}">`);
      expect(xml).toContain(`<condition attribute="${alternateId}" operator="in"`);
      expect(xml).not.toMatch(/condition attribute="(?:componentidunique|componentid|parentidunique|secretidunique)"/);
      return { value: [{ [primaryId]: guid(900), [alternateId]: objectId, name: 'App configuration', isenabled: false }] };
    });
    installApi({
      fetchXmlQuery,
      queryData: vi.fn(async () => ({ value: [{
        LogicalName: logicalName, PrimaryIdAttribute: primaryId, PrimaryNameAttribute: 'name',
        ObjectTypeCode: type, DisplayName: label(typeName),
      }] })),
      getEntityRelatedMetadata: vi.fn(async () => ({ value: [
        { LogicalName: 'name', AttributeType: 'String' },
        { LogicalName: alternateId, AttributeType: 'Uniqueidentifier', IsValidForRead: true },
        { LogicalName: 'isenabled', AttributeType: 'Boolean' },
        { LogicalName: 'componentidunique', AttributeType: 'Uniqueidentifier' },
        { LogicalName: 'componentid', AttributeType: 'Uniqueidentifier' },
        { LogicalName: 'secretidunique', AttributeType: 'Uniqueidentifier', IsSecured: true },
        { LogicalName: 'parentidunique', AttributeType: 'Lookup' },
      ] })),
    });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.solutionComponents).toEqual([expect.objectContaining({
      componentType: type, componentTypeName: typeName, objectId, name: 'App configuration',
      properties: expect.arrayContaining([{ name: 'isenabled', value: 'No' }]),
    })]);
    expect(result.unmappedComponents).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('documents unpublished site maps through RetrieveUnpublishedMultiple and labels them', async () => {
    const ids = [guid(62), guid(63)];
    const queryData = vi.fn(async (query: string) => {
      expect(query).toMatch(/^sitemaps\/Microsoft\.Dynamics\.CRM\.RetrieveUnpublishedMultiple\(\)\?\$select=/);
      expect(query).toContain(`sitemapidunique eq ${ids[1]}`);
      expect(query).not.toContain(ids[0]);
      return { value: [{ sitemapid: guid(631), sitemapidunique: ids[1], sitemapname: 'Draft App', sitemapxml: '<SiteMap />' }] };
    });
    installApi({
      queryData,
      fetchXmlQuery: vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="solutioncomponent">')
        ? ids.map((objectid) => ({ componenttype: 62, objectid }))
        : [{ sitemapid: guid(620), sitemapidunique: ids[0], sitemapname: 'Published App', sitemapxml: '<SiteMap />' }] })),
    });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(warnings).toEqual([]);
    expect(result.unmappedComponents).toEqual([]);
    const [published, draft] = result.solutionComponents;
    expect(published.properties.some((property) => property.name === 'Publication State')).toBe(false);
    expect(draft).toMatchObject({ objectId: ids[1], name: 'Draft App' });
    expect(draft.properties).toContainEqual(expect.objectContaining({ name: 'Publication State', value: expect.stringContaining('Unpublished') }));
  });

  it('explains every lookup tried when a referenced site map is genuinely missing', async () => {
    installApi({
      queryData: vi.fn(async () => ({ value: [] })),
      fetchXmlQuery: vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="solutioncomponent">')
        ? [{ componenttype: 62, objectid: guid(62) }] : [] })),
    });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.unmappedComponents).toEqual([expect.objectContaining({ objectId: guid(62) })]);
    expect(warnings[0]).toContain('primary ID (sitemapid), solution-layer ID (sitemapidunique), unpublished records');
    expect(warnings[0]).toContain('may have been deleted, or the connection may not have read access');
  });

  it('reports when unpublished site maps could not be checked instead of hiding the failure', async () => {
    installApi({
      queryData: vi.fn(async () => { throw new Error('Function not supported'); }),
      fetchXmlQuery: vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="solutioncomponent">')
        ? [{ componenttype: 62, objectid: guid(62) }] : [] })),
    });
    const warnings: string[] = [];
    await fetchSolutionComponentDetails('selected', [], warnings);
    expect(warnings[0]).toContain('Unpublished records could not be checked');
    expect(warnings[0]).toContain('Function not supported');
  });

  it('does not choose an arbitrary site map when an alternate identifier is ambiguous', async () => {
    installApi({ fetchXmlQuery: vi.fn(async (xml: string) => ({
      value: xml.includes('<entity name="solutioncomponent">') ? [{ componenttype: 62, objectid: guid(62) }]
        : [
          { sitemapid: guid(1), sitemapidunique: guid(62), sitemapname: 'First' },
          { sitemapid: guid(2), sitemapidunique: guid(62), sitemapname: 'Second' },
        ],
    })) });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.solutionComponents).toEqual([]);
    expect(result.unmappedComponents).toEqual([expect.objectContaining({ objectId: guid(62) })]);
    expect(warnings[0]).toContain('matched multiple records');
  });

  it('never treats a denied or malformed global choice definition as an empty successful collection', async () => {
    const queryData = vi.fn<(query: string) => Promise<{ value: Record<string, unknown>[] }>>().mockResolvedValue({ value: [] });
    installApi({
      queryData,
      fetchXmlQuery: vi.fn(async () => ({ value: [{ componenttype: 9, objectid: guid(1) }] })),
    });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.optionSets).toEqual([]);
    expect(result.unmappedComponents[0]).toMatchObject({ componentTypeName: 'Option Set', objectId: guid(1) });
    expect(warnings[0]).toContain('requested metadata definition');
    expect(queryData.mock.calls[0][0]).not.toContain('$top');
  });

  it.each([true, false])('keeps explicitly selected columns on standard tables and excludes unrelated columns (parent packaged: %s)', async (includeParent) => {
    const fetchXmlQuery = vi.fn(async (xml: string) => {
      if (xml.includes('<entity name="solution">')) return { value: [{ uniquename: 'selected', friendlyname: 'Selected' }] };
      if (xml.includes('<entity name="solutioncomponent">') && xml.includes('value="1"')) return { value: includeParent ? [{ objectid: guid(100) }] : [] };
      if (xml.includes('<entity name="solutioncomponent">') && !xml.includes('operator="in"')) return { value: [{ componenttype: 2, objectid: guid(200) }] };
      return { value: [] };
    });
    installApi({
      fetchXmlQuery, queryData: vi.fn(async (query: string) => ({ value: query.includes('$expand=Attributes(')
        ? [{ LogicalName: 'account', Attributes: [{ MetadataId: guid(200), LogicalName: 'new_flag' }] }] : [] })),
      getEntityMetadata: vi.fn(async () => ({ LogicalName: 'account', IsCustomEntity: false })),
      getEntityRelatedMetadata: vi.fn(async (_name: string, kind: string) => ({ value: kind === 'Attributes' ? [
        { MetadataId: guid(200), LogicalName: 'new_flag', AttributeType: 'Boolean', IsCustomAttribute: true },
        { MetadataId: guid(201), LogicalName: 'other', AttributeType: 'String' },
      ] : [] })),
    });
    const result = await buildParsedSolutionFromDataverse('selected');
    expect(result.entities[0].attributes.map((attribute) => attribute.name)).toEqual(['new_flag']);
    expect(result.solutionComponents?.[0].name).toBe('account.new_flag');
  });

  it('uses corrected shared type names rather than the obsolete ZIP type map', () => {
    expect(SOLUTION_COMPONENT_TYPE_NAMES).toMatchObject({
      2: 'Attribute', 9: 'Option Set', 14: 'Entity Key', 36: 'Email Template',
      55: 'Ribbon Diff', 60: 'System Form', 61: 'Web Resource', 62: 'Site Map',
      80: 'App Module', 90: 'Plugin Type', 91: 'Plugin Assembly',
      154: 'Convert Rule', 161: 'Mobile Offline Profile',
      431: 'Attribute Image Configuration', 432: 'Entity Image Configuration',
    });
  });

  it('collects selected email-template metadata without retrieving body content', async () => {
    const fetchXmlQuery = vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="solutioncomponent">')
      ? [{ componenttype: 36, objectid: guid(36) }]
      : [{ templateid: guid(36), title: 'Account Update', subject: 'Your account is updated', templatetypecode: 'account', languagecode: 1033 }] }));
    installApi({ fetchXmlQuery });
    const warnings: string[] = [];
    const result = await fetchSolutionComponentDetails('selected', [], warnings);
    expect(result.emailTemplates).toEqual([{
      name: 'Account Update', displayName: 'Account Update', subject: 'Your account is updated',
      entityLogicalName: 'account', templateType: 'Email', languageCode: '1033',
    }]);
    const templateQuery = fetchXmlQuery.mock.calls.map(([query]) => query).find((query) => query.includes('<entity name="template">'));
    expect(templateQuery).toContain('templateid');
    expect(templateQuery).toContain(guid(36));
    expect(templateQuery).not.toContain('body');
    expect(warnings).toEqual([]);
  });
});

describe('environment-variable current-value presence', () => {
  it.each([
    [{ _environmentvariabledefinitionid_value: `{${guid(101).toUpperCase()}}` }],
    [{ environmentvariabledefinitionid: { id: guid(101) } }],
    [{ environmentvariabledefinitionid: guid(101) }],
  ])('recognizes Web API and SDK lookup shapes without reading the value: %j', async (row) => {
    const fetchXmlQuery = vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="environmentvariablevalue">')
      ? [row] : [{ environmentvariabledefinitionid: guid(101), displayname: 'Enabled', schemaname: 'new_Enabled', type: 100000002 }] }));
    installApi({ fetchXmlQuery });
    const warnings: string[] = [];
    const result = await fetchEnvironmentVariables('selected', warnings);
    expect(result[0]).toMatchObject({ hasCurrentValue: true, type: 'Boolean' });
    expect(result[0].currentValue).toBeUndefined();
    expect(fetchXmlQuery.mock.calls.map(([xml]) => xml).join('')).not.toContain('<attribute name="value"');
    expect(fetchXmlQuery.mock.calls[1][0]).toContain('<condition attribute="value" operator="not-null" />');
    expect(warnings).toEqual([]);
  });

  it('shows Unknown, not No, if current-value access fails or lookup identity is missing', async () => {
    const fetchXmlQuery = vi.fn(async (xml: string) => {
      if (xml.includes('<entity name="environmentvariablevalue">')) throw new Error('Access denied');
      return { value: [{ environmentvariabledefinitionid: guid(101), schemaname: 'new_Enabled', type: 100000002 }] };
    });
    installApi({ fetchXmlQuery });
    const warnings: string[] = [];
    const result = await fetchEnvironmentVariables('selected', warnings);
    expect(result[0].hasCurrentValue).toBeUndefined();
    expect(result[0].currentValueError).toContain('Access denied');
    expect(warnings[0]).toContain('presence could not be checked');
  });

  it('reports No only after a successful empty lookup and labels all six variable types', async () => {
    installApi({ fetchXmlQuery: vi.fn(async (xml: string) => ({ value: xml.includes('<entity name="environmentvariablevalue">') ? []
      : Array.from({ length: 6 }, (_, index) => ({ environmentvariabledefinitionid: guid(index + 1), schemaname: `new_var${index}`, type: 100000000 + index })) })) });
    const result = await fetchEnvironmentVariables('selected', []);
    expect(result.every((variable) => variable.hasCurrentValue === false)).toBe(true);
    expect(result.map((variable) => variable.type)).toEqual(['String', 'Number', 'Boolean', 'JSON', 'Data Source', 'Secret']);
  });
});
