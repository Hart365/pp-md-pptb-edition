import { describe, expect, it } from 'vitest';
import type { EnvironmentAppendix } from '../types/solution';
import { formatEnvironmentCount, sortEnvironmentAppendix } from './environmentAppendix';
import { parameterDisplayLabel, toUkEnglish } from './ukEnglish';

describe('UK English documentation labels', () => {
  it('localises display text while leaving technical identifiers intact', () => {
    expect(toUkEnglish('Organization / CUSTOMIZATION / Localized Color / Datacenter')).toBe('Organisation / CUSTOMISATION / Localised Colour / Datacentre');
    expect(toUkEnglish('RetrieveCurrentOrganization organizationid OrganizationOwned')).toBe('RetrieveCurrentOrganization organizationid OrganizationOwned');
    expect(parameterDisplayLabel('organizationUrl')).toBe('Organisation URL');
    expect(parameterDisplayLabel('enableCustomizations')).toBe('Enable Customisations');
    expect(parameterDisplayLabel('datacenterId')).toBe('Datacentre ID');
    expect(parameterDisplayLabel('maxAPIRequestCount')).toBe('Max API Request Count');
  });
});

describe('Environment Appendix ordering', () => {
  it('sorts every grouping by label rather than ID, language code, base currency or parent status, without mutation', () => {
    const input: EnvironmentAppendix = {
      collectedAt: '2026-10-23T08:00:00Z',
      identity: [{ name: 'Tenant ID', value: 't' }, { name: 'Organization Name', value: 'o' }],
      settingGroups: [
        { title: 'Security', settings: [{ name: 'Zebra', value: 'z' }, { name: 'Alpha', value: 'a' }] },
        { title: 'Auditing', settings: [] },
      ],
      powerPlatformSettings: [{ name: 'zebraCount', value: '2' }, { name: 'organizationSettings', value: '1' }],
      languages: [{ name: 'French', lcid: 1036, isBaseLanguage: true }, { name: 'English', lcid: 2057, isBaseLanguage: false }],
      currencies: [
        { name: 'Pound sterling', isoCode: 'GBP', isActive: true, isBaseCurrency: true },
        { name: 'Euro', isoCode: 'EUR', isActive: true, isBaseCurrency: false },
      ],
      counts: [
        { category: 'Solutions', label: 'Zebra', value: 1 }, { category: 'Data Model', label: 'Tables', value: 2 },
        { category: 'Solutions', label: 'Alpha', value: 3 },
      ],
      solutions: [
        { displayName: 'Zebra', uniqueName: 'a', version: '1', isManaged: false },
        { displayName: 'Alpha', uniqueName: 'z', version: '1', isManaged: true },
      ],
      publishers: [{ displayName: 'Zebra', uniqueName: 'a' }, { displayName: 'Alpha', uniqueName: 'z' }],
      applicationPackages: [{ name: 'Zebra' }, { name: 'Alpha' }],
      businessUnits: [{ name: 'Zebra', isDisabled: false }, { name: 'Alpha', parentName: 'Zebra', isDisabled: false }],
      warnings: ['Zebra warning', 'Alpha warning'],
    };
    const before = structuredClone(input);
    const output = sortEnvironmentAppendix(input);
    expect(output.identity.map((entry) => entry.name)).toEqual(['Organisation Name', 'Tenant ID']);
    expect(output.settingGroups.map((group) => group.title)).toEqual(['Auditing', 'Security']);
    expect(output.settingGroups[1].settings.map((entry) => entry.name)).toEqual(['Alpha', 'Zebra']);
    expect(output.powerPlatformSettings.map((entry) => entry.name)).toEqual(['Organisation Settings', 'Zebra Count']);
    expect(output.languages.map((entry) => entry.name)).toEqual(['English', 'French']);
    expect(output.currencies.map((entry) => entry.name)).toEqual(['Euro', 'Pound sterling']);
    expect(output.counts.map((entry) => `${entry.category}/${entry.label}`)).toEqual(['Data Model/Tables', 'Solutions/Alpha', 'Solutions/Zebra']);
    expect(output.solutions.map((entry) => entry.displayName)).toEqual(['Alpha', 'Zebra']);
    expect(output.publishers.map((entry) => entry.displayName)).toEqual(['Alpha', 'Zebra']);
    expect(output.applicationPackages.map((entry) => entry.name)).toEqual(['Alpha', 'Zebra']);
    expect(output.businessUnits.map((entry) => entry.name)).toEqual(['Alpha', 'Zebra']);
    expect(output.warnings).toEqual(['Alpha warning', 'Zebra warning']);
    expect(input).toEqual(before);
  });

  it('keeps a real zero distinct from an unavailable count and formats lower bounds accurately', () => {
    expect(formatEnvironmentCount(0)).toBe('0');
    expect(formatEnvironmentCount(undefined)).toBe('Unavailable');
    expect(formatEnvironmentCount(50000, true)).toBe('At least 50,000');
  });
});
