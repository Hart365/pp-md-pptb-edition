import { describe, expect, it } from 'vitest';
import { fillLookupTargetsFromRelationships, readLookupTargets } from './solutionParser';
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
