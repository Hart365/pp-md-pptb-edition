/**
 * @file environmentAppendixSection.ts
 * @description Renders the Environment Appendix section. Used only by the consolidated
 * "All Selected Solutions" document when the Environment Appendix collection policy is selected.
 */

import type { EnvironmentAppendix, EnvironmentSetting } from '../../types/solution';
import { blockquote, heading, markdownTable, mdEscape } from '../markdownFormatting';
import { formatEnvironmentCount, sortEnvironmentAppendix } from '../../utils/environmentAppendix';

/** H2 heading used for the appendix; also referenced by the table of contents. */
export const ENVIRONMENT_APPENDIX_HEADING = 'Environment Appendix';

/** Maximum business units listed before the table is truncated with a note. */
export const MAX_BUSINESS_UNITS_LISTED = 500;

function settingsTable(settings: EnvironmentSetting[]): string[] {
  return markdownTable(['Setting', 'Value'], settings.map((setting) => [mdEscape(setting.name), mdEscape(setting.value)]));
}

function yesNo(value: boolean): string {
  return value ? 'Yes' : 'No';
}

/** Generates the Environment Appendix Markdown; returns an empty string when no appendix exists. */
export function generateEnvironmentAppendixSection(source: EnvironmentAppendix | undefined): string {
  if (!source) return '';
  const appendix = sortEnvironmentAppendix(source);
  const lines: string[] = [
    heading(2, ENVIRONMENT_APPENDIX_HEADING),
    '',
    blockquote([
      `Environment-wide information collected on ${new Date(appendix.collectedAt).toLocaleString('en-GB')} from the connected environment.`,
      'It describes the environment that hosts the selected solutions, not the solutions themselves.',
      'People data is limited to aggregate counts; environment-variable values, secrets, and record data are never collected.',
    ].join('\n')),
    '',
  ];

  if (appendix.identity.length > 0) {
    lines.push(heading(3, 'Environment Identity'), '', ...settingsTable(appendix.identity), '');
  }

  if (appendix.settingGroups.length > 0) {
    lines.push(heading(3, 'Environment Settings'), '');
    appendix.settingGroups.forEach((group) => {
      lines.push(heading(4, group.title), '', ...settingsTable(group.settings), '');
    });
  }

  lines.push(heading(3, 'Power Platform Environment Settings'), '');
  if (appendix.powerPlatformSettings.length > 0) {
    lines.push(...settingsTable(appendix.powerPlatformSettings), '');
  } else if (!appendix.powerPlatformStatus) {
    lines.push('_The Power Platform API returned no environment settings._', '');
  }

  if (appendix.languages.length > 0) {
    lines.push(heading(3, 'Provisioned Languages'), '', ...markdownTable(
      ['Language', 'LCID', 'Base Language'],
      appendix.languages.map((language) => [mdEscape(language.name), String(language.lcid), yesNo(language.isBaseLanguage)]),
    ), '');
  }

  if (appendix.currencies.length > 0) {
    lines.push(heading(3, 'Currencies'), '', ...markdownTable(
      ['Currency', 'ISO Code', 'Symbol', 'Precision', 'Exchange Rate', 'Base Currency', 'Active'],
      appendix.currencies.map((currency) => [
        mdEscape(currency.name), mdEscape(currency.isoCode), mdEscape(currency.symbol),
        currency.precision === undefined ? '' : String(currency.precision),
        currency.exchangeRate === undefined ? '' : String(currency.exchangeRate),
        yesNo(currency.isBaseCurrency), yesNo(currency.isActive),
      ]),
    ), '');
  }

  if (appendix.counts.length > 0) {
    lines.push(heading(3, 'Environment Inventory Counts'), '',
      blockquote('Totals count distinct items visible to the connection, not components in the selected solutions. Custom (confirmed) uses recognised namespaces or associated managed-solution publishers and excludes Microsoft/default publishers. Unclassified items are not assumed to be custom; zero confirmed custom items does not mean none exist when items remain unclassified. Non-component counts have no custom classification. Counts are collected sequentially, not as an atomic snapshot, and permissions or concurrent changes can affect them.'), '',
      ...markdownTable(
      ['Area', 'Item', 'Total', 'Custom (confirmed)', 'Unclassified'],
      appendix.counts.map((count) => [
        mdEscape(count.category), mdEscape(count.label),
        formatEnvironmentCount(count.value, count.isLowerBound),
        count.custom ? formatEnvironmentCount(count.custom.value) : 'Not applicable',
        count.custom ? formatEnvironmentCount(count.custom.unclassified) : 'Not applicable',
      ]),
    ), '');
  }

  if (appendix.solutions.length > 0) {
    lines.push(heading(3, 'Installed Solutions'), '', ...markdownTable(
      ['Solution', 'Unique Name', 'Version', 'Type', 'Publisher', 'Installed On'],
      appendix.solutions.map((solution) => [
        mdEscape(solution.displayName), `\`${mdEscape(solution.uniqueName)}\``, mdEscape(solution.version),
        solution.isManaged ? 'Managed' : 'Unmanaged', mdEscape(solution.publisherName),
        solution.installedOn ? mdEscape(new Date(solution.installedOn).toLocaleDateString('en-GB')) : '',
      ]),
    ), '');
  }

  if (appendix.applicationPackages.length > 0) {
    lines.push(heading(3, 'Installed Application Packages'), '', ...markdownTable(
      ['Application', 'Unique Name', 'Version', 'State', 'Publisher'],
      appendix.applicationPackages.map((entry) => [
        mdEscape(entry.name), mdEscape(entry.uniqueName), mdEscape(entry.version), mdEscape(entry.state), mdEscape(entry.publisherName),
      ]),
    ), '');
  }

  if (appendix.publishers.length > 0) {
    lines.push(heading(3, 'Publishers'), '', ...markdownTable(
      ['Publisher', 'Unique Name', 'Prefix', 'Choice Value Prefix'],
      appendix.publishers.map((publisher) => [
        mdEscape(publisher.displayName), `\`${mdEscape(publisher.uniqueName)}\``, mdEscape(publisher.customizationPrefix),
        publisher.optionValuePrefix === undefined ? '' : String(publisher.optionValuePrefix),
      ]),
    ), '');
  }

  if (appendix.businessUnits.length > 0) {
    const listed = appendix.businessUnits.slice(0, MAX_BUSINESS_UNITS_LISTED);
    lines.push(heading(3, 'Business Units'), '', ...markdownTable(
      ['Business Unit', 'Parent Business Unit', 'Status'],
      listed.map((unit) => [mdEscape(unit.name), unit.parentName ? mdEscape(unit.parentName) : '_Root_', unit.isDisabled ? 'Disabled' : 'Enabled']),
    ), '');
    if (appendix.businessUnits.length > listed.length) {
      lines.push(`_Showing the first ${listed.length.toLocaleString('en-GB')} of ${appendix.businessUnits.length.toLocaleString('en-GB')} business units._`, '');
    }
  }

  return lines.join('\n');
}
