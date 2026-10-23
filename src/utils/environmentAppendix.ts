import type { EnvironmentAppendix, EnvironmentSetting } from '../types/solution';
import { parameterDisplayLabel, toUkEnglish } from './ukEnglish';

export const compareEnvironmentLabels = (left: string, right: string): number =>
  left.localeCompare(right, 'en-GB', { sensitivity: 'base', numeric: true });

function sorted<T>(items: T[], label: (item: T) => string): T[] {
  return [...items].sort((left, right) => compareEnvironmentLabels(label(left), label(right)));
}

function settings(items: EnvironmentSetting[]): EnvironmentSetting[] {
  return sorted(items.map((item) => ({ ...item, name: toUkEnglish(item.name) })), (item) => item.name);
}

/** Applies the same non-mutating ordering and display labels to every appendix export. */
export function sortEnvironmentAppendix(appendix: EnvironmentAppendix): EnvironmentAppendix {
  return {
    ...appendix,
    identity: settings(appendix.identity),
    settingGroups: sorted(appendix.settingGroups.map((group) => ({
      ...group, title: toUkEnglish(group.title), settings: settings(group.settings),
    })), (group) => group.title),
    powerPlatformSettings: settings(appendix.powerPlatformSettings.map((item) => ({
      ...item, name: parameterDisplayLabel(item.name),
    }))),
    languages: sorted(appendix.languages, (item) => item.name),
    currencies: sorted(appendix.currencies, (item) => item.name),
    counts: [...appendix.counts].sort((left, right) =>
      compareEnvironmentLabels(left.category, right.category) || compareEnvironmentLabels(left.label, right.label)),
    solutions: sorted(appendix.solutions, (item) => item.displayName),
    applicationPackages: sorted(appendix.applicationPackages, (item) => item.name),
    publishers: sorted(appendix.publishers, (item) => item.displayName),
    businessUnits: sorted(appendix.businessUnits, (item) => item.name),
    warnings: sorted(appendix.warnings, (item) => item),
  };
}

export function formatEnvironmentCount(value: number | undefined, isLowerBound = false): string {
  return value === undefined ? 'Unavailable' : `${isLowerBound ? 'At least ' : ''}${value.toLocaleString('en-GB')}`;
}
