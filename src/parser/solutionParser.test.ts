import { describe, expect, it } from 'vitest';
import { fillLookupTargetsFromRelationships, parseManifestMissingDependencies, parseSolutionZip, readLookupTargets, xmlBool } from './solutionParser';
import JSZip from 'jszip';
import { AttributeType, type EntityDefinition } from '../types/solution';

describe('readLookupTargets', () => {
  it('reads plain, delimited, nested and array target shapes', () => {
    expect(readLookupTargets('Contact')).toEqual(['contact']);
    expect(readLookupTargets('account, contact')).toEqual(['account', 'contact']);
    expect(readLookupTargets({ Target: ['account', 'contact'] })).toEqual(['account', 'contact']);
    expect(readLookupTargets([{ Target: { '#text': 'systemuser' } }, { Target: 'team' }])).toEqual(['systemuser', 'team']);
    expect(readLookupTargets({ Target: ['contact', 'Contact'] })).toEqual(['contact']);
    expect(readLookupTargets(undefined)).toEqual([]);
  });

  describe('manifest missing dependencies', () => {
    const xml = `<ImportExportXml><SolutionManifest>
      <UniqueName>sample</UniqueName><Version>1</Version>
      <MissingDependencies>
        <MissingDependency>
          <Required type="1" schemaName="account" displayName="Account" />
          <Dependent type="2" schemaName="new_customer" parentSchemaName="new_case" />
        </MissingDependency>
        <MissingDependency>
          <Required type="61" schemaName="new_script.js" />
          <Dependent type="60" displayName="Main form" id="{form-id}" />
        </MissingDependency>
      </MissingDependencies>
    </SolutionManifest></ImportExportXml>`;

    it('preserves declared component types, schema names and owning tables', () => {
      expect(parseManifestMissingDependencies(xml)).toEqual([
        {
          dependentName: 'new_case.new_customer', dependentType: 'Column', requiredName: 'account',
          requiredType: 'Table', tableLogicalNames: ['new_case'], requiredParent: undefined,
        },
        {
          dependentName: 'Main form', dependentType: 'Form', requiredName: 'new_script.js',
          requiredType: 'Web Resource', tableLogicalNames: [], requiredParent: undefined,
        },
      ]);
      expect(parseManifestMissingDependencies('<ImportExportXml><SolutionManifest /></ImportExportXml>')).toEqual([]);
    });

    it('reads a singleton and retains unknown component identifiers rather than dropping them', () => {
      expect(parseManifestMissingDependencies(`<ImportExportXml><SolutionManifest><MissingDependencies><MissingDependency>
        <Required type="999" id="{required-id}" />
        <Dependent type="1" schemaName="new_case" />
      </MissingDependency></MissingDependencies></SolutionManifest></ImportExportXml>`)).toEqual([
        expect.objectContaining({ requiredType: 'Component 999', requiredName: '{required-id}', tableLogicalNames: ['new_case'] }),
      ]);
    });

    it('wires manifest dependencies into the parsed ZIP solution', async () => {
      const zip = new JSZip();
      zip.file('solution.xml', xml);
      const parsed = await parseSolutionZip(await zip.generateAsync({ type: 'blob' }));
      expect(parsed.missingDependencies).toEqual(parseManifestMissingDependencies(xml).map((dependency) => ({
        ...dependency, solutionUniqueName: 'sample',
      })));
    });
  });
});

describe('fillLookupTargetsFromRelationships', () => {
  it('fills missing lookup targets from referencing relationships only', () => {
    const entities = [
      {
        logicalName: 'account',
        name: 'account',
        displayName: 'Account',
        isCustom: false,
        attributes: [
          { name: 'primarycontactid', displayName: 'Primary Contact', type: AttributeType.Lookup, required: false, isCustom: false },
          { name: 'ownerid', displayName: 'Owner', type: AttributeType.Owner, required: false, isCustom: false, lookupTarget: 'systemuser, team' },
          { name: 'name', displayName: 'Name', type: AttributeType.String, required: true, isCustom: false },
        ],
        relationships: [
          { name: 'account_primary_contact', type: 'ManyToOne', referencedEntity: 'contact', referencingEntity: 'account', referencingAttribute: 'primarycontactid' },
          { name: 'account_owner', type: 'ManyToOne', referencedEntity: 'businessunit', referencingEntity: 'account', referencingAttribute: 'ownerid' },
        ],
      },
    ] as unknown as EntityDefinition[];

    fillLookupTargetsFromRelationships(entities);

    expect(entities[0].attributes[0].lookupTarget).toBe('contact');
    expect(entities[0].attributes[1].lookupTarget).toBe('systemuser, team');
    expect(entities[0].attributes[2].lookupTarget).toBeUndefined();
  });
});

describe('xmlBool', () => {
  it('reads 1/0, true/false, attribute and nested Value forms', () => {
    expect(xmlBool({ IsAuditEnabled: '1' }, 'IsAuditEnabled')).toBe(true);
    expect(xmlBool({ ChangeTrackingEnabled: '0' }, 'ChangeTrackingEnabled')).toBe(false);
    expect(xmlBool({ '@_IsActivity': 'true' }, 'IsActivity')).toBe(true);
    expect(xmlBool({ IsAuditEnabled: { '@_Value': 'false' } }, 'IsAuditEnabled')).toBe(false);
    expect(xmlBool({}, 'Missing')).toBeUndefined();
  });
});