/**
 * @file environmentCollector.ts
 * @description Collects the environment-wide Environment Appendix (identity, version, organization
 * settings, languages, currencies, installed solutions, publishers, business units, aggregate counts,
 * and optional Power Platform API settings/application packages). Collected once per documentation
 * run and rendered only in the consolidated "All Selected Solutions" document.
 *
 * Privacy rules enforced here:
 * - user and team data is limited to aggregate counts (no names, emails, or IDs of people);
 * - environment-variable values, secrets, credentials, and record payloads are never read;
 * - every section fails independently and is reported as a warning.
 */

import type {
  EnvironmentAppendix,
  EnvironmentApplicationPackage,
  EnvironmentBusinessUnit,
  EnvironmentCount,
  EnvironmentCurrency,
  EnvironmentInstalledSolution,
  EnvironmentLanguage,
  EnvironmentPublisher,
  EnvironmentSetting,
  EnvironmentSettingGroup,
} from '../types/solution';
import {
  asBoolean,
  asNumber,
  asOptionalBoolean,
  asString,
  fetchXmlQuery,
  isCollectionCancelledError,
  isRecord,
  queryDataverse,
  queryMetadataCollection,
  referenceId,
  throwIfDataverseCollectionCancelled,
  warningMessage,
} from './dataverseClient';
import { sortEnvironmentAppendix } from '../utils/environmentAppendix';
import { parameterDisplayLabel } from '../utils/ukEnglish';

/** Connection fields the appendix may show; tokens and scopes are deliberately excluded. */
export type EnvironmentConnectionInfo = Pick<ToolBoxAPI.Connection, 'name' | 'url' | 'environment' | 'enabledForPowerPlatformAPI'>;

export interface EnvironmentCollectionProgress {
  message: string;
  percent: number;
}

/** Default aggregate input limit, not a valid lower bound for a distinct count. */
export const AGGREGATE_RECORD_LIMIT = 50000;
const POWER_PLATFORM_API_VERSION = '2024-10-01';

type SettingFormat = 'boolean' | 'number' | 'text' | 'minutes' | 'days' | 'bytes' | Record<number, string>;

interface OrganizationSettingDescriptor {
  column: string;
  label: string;
  format: SettingFormat;
}

const PLUGIN_TRACE_LOG: Record<number, string> = { 0: 'Off', 1: 'Exception', 2: 'All' };
const CURRENCY_DISPLAY: Record<number, string> = { 0: 'Currency symbol', 1: 'Currency code' };
const FULL_NAME_CONVENTION: Record<number, string> = {
  0: 'Last Name, First Name', 1: 'First Name', 2: 'Last Name, First Name, Middle Initial',
  3: 'First Name, Middle Initial, Last Name', 4: 'Last Name, First Name, Middle Name',
  5: 'First Name, Middle Name, Last Name', 6: 'Last Name space First Name', 7: 'Last Name no space First Name',
};

/**
 * Organization-table settings documented in the appendix, grouped by administrative area.
 * Column names are verified against the Dataverse organization table reference.
 */
export const ORGANIZATION_SETTING_GROUPS: Array<{ title: string; settings: OrganizationSettingDescriptor[] }> = [
  {
    title: 'Regional and Formatting',
    settings: [
      { column: 'languagecode', label: 'Base Language (LCID)', format: 'number' },
      { column: 'localeid', label: 'Locale ID', format: 'number' },
      { column: 'basecurrencysymbol', label: 'Base Currency Symbol', format: 'text' },
      { column: 'currencydisplayoption', label: 'Currency Display', format: CURRENCY_DISPLAY },
      { column: 'dateformatstring', label: 'Date Format', format: 'text' },
      { column: 'timeformatstring', label: 'Time Format', format: 'text' },
      { column: 'fullnameconventioncode', label: 'Full Name Format', format: FULL_NAME_CONVENTION },
      { column: 'defaultcountrycode', label: 'Default Country Code', format: 'text' },
      { column: 'isdefaultcountrycodecheckenabled', label: 'Default Country Code Check', format: 'boolean' },
      { column: 'fiscalcalendarstart', label: 'Fiscal Calendar Start', format: 'text' },
      { column: 'isfiscalperiodmonthbased', label: 'Fiscal Period Month Based', format: 'boolean' },
    ],
  },
  {
    title: 'Auditing',
    settings: [
      { column: 'isauditenabled', label: 'Auditing Enabled', format: 'boolean' },
      { column: 'auditretentionperiodv2', label: 'Audit Retention Period', format: 'days' },
      { column: 'isuseraccessauditenabled', label: 'User Access Auditing', format: 'boolean' },
      { column: 'useraccessauditinginterval', label: 'User Access Audit Interval (hours)', format: 'number' },
      { column: 'isreadauditenabled', label: 'Read Auditing', format: 'boolean' },
    ],
  },
  {
    title: 'Security and Sessions',
    settings: [
      { column: 'sessiontimeoutenabled', label: 'Session Timeout Enabled', format: 'boolean' },
      { column: 'sessiontimeoutinmins', label: 'Session Timeout', format: 'minutes' },
      { column: 'inactivitytimeoutenabled', label: 'Inactivity Timeout Enabled', format: 'boolean' },
      { column: 'inactivitytimeoutinmins', label: 'Inactivity Timeout', format: 'minutes' },
      { column: 'ishierarchicalsecuritymodelenabled', label: 'Hierarchy Security', format: 'boolean' },
      { column: 'maxdepthforhierarchicalsecuritymodel', label: 'Hierarchy Security Depth', format: 'number' },
      { column: 'isdelegateaccessenabled', label: 'Delegate Access', format: 'boolean' },
      { column: 'issharinginorgallowed', label: 'Sharing Within Organisation', format: 'boolean' },
      { column: 'iscontentsecuritypolicyenabled', label: 'Content Security Policy', format: 'boolean' },
    ],
  },
  {
    title: 'Files and Email',
    settings: [
      { column: 'maxuploadfilesize', label: 'Maximum Attachment Size', format: 'bytes' },
      { column: 'blockedattachments', label: 'Blocked Attachment Extensions', format: 'text' },
      { column: 'allowedmimetypes', label: 'Allowed MIME Types', format: 'text' },
      { column: 'blockedmimetypes', label: 'Blocked MIME Types', format: 'text' },
      { column: 'isfolderbasedtrackingenabled', label: 'Folder-Based Email Tracking', format: 'boolean' },
    ],
  },
  {
    title: 'Features and Search',
    settings: [
      { column: 'isexternalsearchindexenabled', label: 'Dataverse Search', format: 'boolean' },
      { column: 'isfulltextsearchenabled', label: 'Full-Text Quick Find', format: 'boolean' },
      { column: 'isautosaveenabled', label: 'Auto Save', format: 'boolean' },
      { column: 'ismobileofflineenabled', label: 'Mobile Offline', format: 'boolean' },
      { column: 'ispresenceenabled', label: 'Presence', format: 'boolean' },
      { column: 'ismsteamsenabled', label: 'Microsoft Teams Integration', format: 'boolean' },
      { column: 'ismsteamscollaborationenabled', label: 'Microsoft Teams Collaboration', format: 'boolean' },
      { column: 'isactioncardenabled', label: 'Action Cards', format: 'boolean' },
      { column: 'istextwrapenabled', label: 'Grid Text Wrap', format: 'boolean' },
      { column: 'modernadvancedfindfiltering', label: 'Modern Advanced Find', format: 'boolean' },
      { column: 'enablebingmapsintegration', label: 'Bing Maps', format: 'boolean' },
      { column: 'isnotesanalysisenabled', label: 'Notes Analysis', format: 'boolean' },
    ],
  },
  {
    title: 'Duplicate Detection',
    settings: [
      { column: 'isduplicatedetectionenabled', label: 'Duplicate Detection', format: 'boolean' },
      { column: 'isduplicatedetectionenabledforimport', label: 'During Import', format: 'boolean' },
      { column: 'isduplicatedetectionenabledforonlinecreateupdate', label: 'On Create and Update', format: 'boolean' },
      { column: 'isduplicatedetectionenabledforofflinesync', label: 'During Offline Sync', format: 'boolean' },
    ],
  },
  {
    title: 'Customisation and Limits',
    settings: [
      { column: 'schemanameprefix', label: 'Default Schema Prefix', format: 'text' },
      { column: 'plugintracelogsetting', label: 'Plug-in Trace Log', format: PLUGIN_TRACE_LOG },
      { column: 'maxrecordsforexporttoexcel', label: 'Maximum Records Exported to Excel', format: 'number' },
      { column: 'maxappointmentdurationdays', label: 'Maximum Appointment Duration', format: 'days' },
    ],
  },
];

/** Common Dataverse language LCIDs; unknown LCIDs are shown numerically. */
const LANGUAGE_NAMES: Record<number, string> = {
  1025: 'Arabic', 1026: 'Bulgarian', 1027: 'Catalan', 1028: 'Chinese (Traditional)', 1029: 'Czech', 1030: 'Danish',
  1031: 'German', 1032: 'Greek', 1033: 'English (United States)', 1035: 'Finnish', 1036: 'French', 1037: 'Hebrew',
  1038: 'Hungarian', 1040: 'Italian', 1041: 'Japanese', 1042: 'Korean', 1043: 'Dutch', 1044: 'Norwegian (Bokmål)',
  1045: 'Polish', 1046: 'Portuguese (Brazil)', 1048: 'Romanian', 1049: 'Russian', 1050: 'Croatian', 1051: 'Slovak',
  1053: 'Swedish', 1054: 'Thai', 1055: 'Turkish', 1057: 'Indonesian', 1058: 'Ukrainian', 1060: 'Slovenian',
  1061: 'Estonian', 1062: 'Latvian', 1063: 'Lithuanian', 1066: 'Vietnamese', 1069: 'Basque', 1081: 'Hindi',
  1086: 'Malay', 1087: 'Kazakh', 1110: 'Galician', 2052: 'Chinese (Simplified)', 2070: 'Portuguese (Portugal)',
  2074: 'Serbian (Latin)', 3076: 'Chinese (Hong Kong SAR)', 3082: 'Spanish', 3098: 'Serbian (Cyrillic)',
};

/** Returns a friendly language label for an LCID. */
export function languageName(lcid: number): string {
  return LANGUAGE_NAMES[lcid] ?? `LCID ${lcid}`;
}

/** Formats an organization column value for display; undefined when the value is absent. */
export function formatOrganizationSetting(value: unknown, format: SettingFormat, formatted?: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof format === 'object') {
    const label = format[asNumber(value, Number.NaN)];
    return label ?? (asString(formatted) || asString(value));
  }
  switch (format) {
    case 'boolean': {
      const enabled = asOptionalBoolean(value);
      return enabled === undefined ? 'Unavailable (invalid boolean value)' : enabled ? 'Yes' : 'No';
    }
    case 'minutes': {
      const minutes = asNumber(value, Number.NaN);
      return Number.isFinite(minutes) && minutes >= 0 ? `${minutes.toLocaleString('en-GB')} minutes` : 'Unavailable (invalid duration)';
    }
    case 'days': {
      const days = asNumber(value, Number.NaN);
      if (days === -1) return 'Forever';
      return Number.isFinite(days) && days >= 0 ? `${days.toLocaleString('en-GB')} days` : 'Unavailable (invalid duration)';
    }
    case 'bytes': {
      const kilobytes = asNumber(value, Number.NaN);
      return Number.isFinite(kilobytes) && kilobytes >= 0
        ? `${(kilobytes / 1024).toLocaleString('en-GB', { maximumFractionDigits: 2 })} MB (${kilobytes.toLocaleString('en-GB')} KB)`
        : 'Unavailable (invalid attachment size)';
    }
    case 'number': {
      const number = asNumber(value, Number.NaN);
      return Number.isFinite(number) ? number.toLocaleString('en-GB') : 'Unavailable (invalid number)';
    }
    default: return asString(formatted) || asString(value);
  }
}

function optionalNumber(value: unknown, label: string, warnings: string[], integer = true): number | undefined {
  if (value === null || value === undefined) return undefined;
  const number = asNumber(value, Number.NaN);
  if (integer ? Number.isSafeInteger(number) && number >= 0 : Number.isFinite(number) && number > 0) return number;
  warnings.push(`${label} is unavailable: Dataverse returned an invalid number.`);
  return undefined;
}

/** Counts unique primary keys. A missing, malformed or limited result is never reported as zero. */
async function aggregateCount(entity: string, idAttribute: string, filterXml = ''): Promise<number> {
  throwIfDataverseCollectionCancelled();
  const result = await window.dataverseAPI.fetchXmlQuery(`<fetch aggregate="true">
    <entity name="${entity}">
      <attribute name="${idAttribute}" alias="total" aggregate="countcolumn" distinct="true" />
      ${filterXml}
    </entity>
  </fetch>`);
  const raw = result.value?.[0]?.total;
  const value = asNumber(isRecord(raw) ? raw.Value ?? raw.value : raw, Number.NaN);
  if (result.value?.length !== 1 || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Dataverse returned an invalid distinct count for ${entity}; no total can be established.`);
  }
  return value;
}

interface CountDescriptor {
  category: string;
  label: string;
  entity: string;
  idAttribute: string;
  filter?: string;
  /** Schema/unique name, not a friendly display name or an arbitrary record payload. */
  namespaceAttribute?: string;
  /** Uses the record's associated managed solution, never arbitrary solution memberships. */
  solutionPublisher?: boolean;
  note?: string;
}

const USER_MEMBERSHIP_FILTER = `<filter type="or">
  <link-entity name="systemuserroles" from="systemuserid" to="systemuserid" link-type="any" intersect="true">
    <link-entity name="role" from="roleid" to="roleid" link-type="inner" />
  </link-entity>
  <link-entity name="teammembership" from="systemuserid" to="systemuserid" link-type="any" intersect="true">
    <link-entity name="team" from="teamid" to="teamid" link-type="inner">
      <filter><condition attribute="isdefault" operator="eq" value="0" /></filter>
    </link-entity>
  </link-entity>
</filter>`;

const CUSTOM_CLASSIFICATION_NOTE = 'Custom counts use recognised publisher namespaces or the associated managed solution publisher. Microsoft/default publishers are excluded. Missing or ambiguous provenance remains unclassified; managed/unmanaged and customisable flags alone do not establish publisher provenance.';
type PublisherOrigin = 'custom' | 'excluded' | 'unknown';

function excludedNamespace(prefix: string): boolean {
  return /^(msdyn|mscrm)/.test(prefix) || ['mspp', 'adx', 'new'].includes(prefix);
}

function publisherOrigin(publisher: EnvironmentPublisher | undefined): PublisherOrigin {
  const name = publisher?.uniqueName.trim().toLowerCase();
  const prefix = publisher?.customizationPrefix?.trim().toLowerCase();
  if (!name) return 'unknown';
  if (/^(microsoft|msdyn|defaultpublisher|cdsdefaultpublisher)/.test(name)
    || excludedNamespace(prefix ?? '')) return 'excluded';
  if (!prefix || prefix.startsWith('ms')) return 'unknown';
  return 'custom';
}

function namespaceOrigin(name: string, publishers: EnvironmentPublisher[] | undefined): PublisherOrigin {
  const separator = name.indexOf('_');
  if (separator <= 0) return 'unknown';
  const prefix = name.slice(0, separator).toLowerCase();
  const matches = publishers?.filter((publisher) => publisher.customizationPrefix?.toLowerCase() === prefix) ?? [];
  if (matches.length === 0 && excludedNamespace(prefix)) return 'excluded';
  const origins = new Set(matches.map(publisherOrigin));
  return origins.size === 1 ? origins.values().next().value ?? 'unknown' : 'unknown';
}

function associatedSolutionOrigin(row: Record<string, unknown>): PublisherOrigin {
  // Active/Default solution publishers do not identify authors of unmanaged components.
  if (asOptionalBoolean(row['origin_solution.ismanaged']) !== true) return 'unknown';
  const solutionName = asString(row['origin_solution.uniquename']).toLowerCase();
  if (!solutionName || ['active', 'default'].includes(solutionName)) return 'unknown';
  return publisherOrigin({
    uniqueName: asString(row['origin_publisher.uniquename']),
    displayName: asString(row['origin_publisher.friendlyname']),
    customizationPrefix: asString(row['origin_publisher.customizationprefix']),
  });
}

function customCounts(origins: PublisherOrigin[]): NonNullable<EnvironmentCount['custom']> {
  return {
    value: origins.filter((origin) => origin === 'custom').length,
    unclassified: origins.filter((origin) => origin === 'unknown').length,
    note: CUSTOM_CLASSIFICATION_NOTE,
  };
}

/** Environment-wide counts. People are counted only; names are never retrieved. */
export const ENVIRONMENT_COUNT_DESCRIPTORS: CountDescriptor[] = [
  {
    category: 'People and Security', label: 'Users in environment', entity: 'systemuser', idAttribute: 'systemuserid',
    filter: `<filter type="and"><condition attribute="isdisabled" operator="eq" value="0" />
      <condition attribute="applicationid" operator="null" />
      <condition attribute="azureactivedirectoryobjectid" operator="not-null" />${USER_MEMBERSHIP_FILTER}</filter>`,
    note: 'Distinct enabled human users with a direct security role or membership of a non-default team. Automatic business-unit default teams, disabled accounts, application users and internal system accounts are excluded. Roles have no active/inactive state. Directory group members not yet represented in Dataverse team membership cannot be inferred.',
  },
  {
    category: 'People and Security', label: 'Application users in environment', entity: 'systemuser', idAttribute: 'systemuserid',
    filter: `<filter type="and"><condition attribute="isdisabled" operator="eq" value="0" />
      <condition attribute="applicationid" operator="not-null" />${USER_MEMBERSHIP_FILTER}</filter>`,
    note: 'Distinct enabled application users with a direct role or non-default team membership; not included in the human-user count.',
  },
  { category: 'People and Security', label: 'Teams', entity: 'team', idAttribute: 'teamid', note: 'All teams, including automatic business-unit default teams. Default-team membership does not qualify a user for the environment-user count.' },
  { category: 'People and Security', label: 'Security roles (root business unit)', entity: 'role', idAttribute: 'roleid', namespaceAttribute: 'name', filter: '<filter><condition attribute="parentroleid" operator="null" /></filter>', note: 'Inherited business-unit copies are excluded. Role names without a publisher namespace remain unclassified.' },
  { category: 'People and Security', label: 'Column security profiles', entity: 'fieldsecurityprofile', idAttribute: 'fieldsecurityprofileid', namespaceAttribute: 'name' },
  { category: 'Apps and Automation', label: 'Model-driven apps', entity: 'appmodule', idAttribute: 'appmoduleid', namespaceAttribute: 'uniquename' },
  { category: 'Apps and Automation', label: 'Canvas apps', entity: 'canvasapp', idAttribute: 'canvasappid', namespaceAttribute: 'name' },
  ...[
    ['Cloud flows', 5], ['Classic workflows', 0], ['Business process flows', 4],
    ['Business rules', 2], ['Custom actions', 3], ['Desktop flows', 6],
  ].map(([label, category]): CountDescriptor => ({
    category: 'Apps and Automation', label: String(label), entity: 'workflow', idAttribute: 'workflowid', namespaceAttribute: 'uniquename',
    filter: `<filter><condition attribute="category" operator="eq" value="${category}" /><condition attribute="type" operator="eq" value="1" /></filter>`,
    note: 'Workflow definitions only (type 1); activation copies and templates are excluded. Active and inactive definitions are included.',
  })),
  { category: 'Apps and Automation', label: 'Copilot Studio agents', entity: 'bot', idAttribute: 'botid', namespaceAttribute: 'schemaname' },
  { category: 'Extensibility', label: 'Plug-in assemblies', entity: 'pluginassembly', idAttribute: 'pluginassemblyid', namespaceAttribute: 'name', solutionPublisher: true },
  { category: 'Extensibility', label: 'Plug-in steps', entity: 'sdkmessageprocessingstep', idAttribute: 'sdkmessageprocessingstepid', namespaceAttribute: 'name', solutionPublisher: true, note: 'Includes system and custom steps. Unnamed publisher namespaces use the associated managed solution publisher where available; unresolved items remain unclassified.' },
  { category: 'Extensibility', label: 'Custom APIs', entity: 'customapi', idAttribute: 'customapiid', namespaceAttribute: 'uniquename', solutionPublisher: true },
  { category: 'Extensibility', label: 'Web resources', entity: 'webresource', idAttribute: 'webresourceid', namespaceAttribute: 'name', solutionPublisher: true },
  { category: 'Extensibility', label: 'Connection references', entity: 'connectionreference', idAttribute: 'connectionreferenceid', namespaceAttribute: 'connectionreferencelogicalname' },
  { category: 'Extensibility', label: 'Environment variable definitions', entity: 'environmentvariabledefinition', idAttribute: 'environmentvariabledefinitionid', namespaceAttribute: 'schemaname', note: 'Definitions only; values are never read.' },
];

function settingsFromRecord(record: Record<string, unknown>): EnvironmentSetting[] {
  return Object.entries(record)
    .filter(([key, value]) => !key.startsWith('@') && !key.includes('@') && value !== null && value !== undefined && value !== '' && typeof value !== 'object')
    .filter(([key]) => !['responseMessage', 'nextLink'].includes(key))
    .map(([key, value]) => ({ name: parameterDisplayLabel(key), value: typeof value === 'boolean' ? (value ? 'Yes' : 'No') : asString(value) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Pushes a section warning unless the failure is a user cancellation, which is rethrown. */
function sectionFailed(warnings: string[], section: string, error: unknown): void {
  if (isCollectionCancelledError(error)) throw error;
  warnings.push(warningMessage(section, error));
}

async function readOrganizationDetail(identity: EnvironmentSetting[], warnings: string[]): Promise<string | undefined> {
  try {
    throwIfDataverseCollectionCancelled();
    const response = await window.dataverseAPI.execute({
      operationName: 'RetrieveCurrentOrganization',
      operationType: 'function',
      parameters: { AccessType: "Microsoft.Dynamics.CRM.EndpointAccessType'Default'" },
    });
    const detail = isRecord(response.Detail) ? response.Detail : response;
    const fields: Array<[string, string]> = [
      ['FriendlyName', 'Organisation Name'], ['UniqueName', 'Organisation Unique Name'], ['UrlName', 'URL Name'],
      ['EnvironmentId', 'Environment ID'], ['OrganizationId', 'Organisation ID'], ['TenantId', 'Tenant ID'],
      ['Geo', 'Geography'], ['DatacenterId', 'Datacentre ID'], ['SchemaType', 'Schema Type'],
      ['OrganizationType', 'Organisation Type'], ['State', 'State'], ['OrganizationVersion', 'Organisation Version'],
    ];
    for (const [key, label] of fields) {
      const value = asString(detail[key]);
      if (value) identity.push({ name: label, value });
    }
    return asString(detail.EnvironmentId) || undefined;
  } catch (error) {
    sectionFailed(warnings, 'Organisation identity (RetrieveCurrentOrganization) could not be read', error);
    return undefined;
  }
}

async function readOrganizationSettings(warnings: string[]): Promise<{ groups: EnvironmentSettingGroup[]; baseLanguage?: number; baseCurrencyId?: string }> {
  const columns = ORGANIZATION_SETTING_GROUPS.flatMap((group) => group.settings.map((setting) => setting.column));
  let row: Record<string, unknown> | undefined;
  try {
    row = (await queryDataverse(`organizations?$select=${['name', '_basecurrencyid_value', ...columns].join(',')}`))[0];
  } catch (error) {
    if (isCollectionCancelledError(error)) throw error;
    // Older environments may lack a newer column; read the single row and pick known columns.
    try {
      row = (await queryDataverse('organizations'))[0];
    } catch (fallbackError) {
      sectionFailed(warnings, 'Organisation settings could not be read', fallbackError);
      return { groups: [] };
    }
  }
  if (!row) {
    warnings.push('Organisation settings could not be read: Dataverse returned no organisation row.');
    return { groups: [] };
  }
  const groups = ORGANIZATION_SETTING_GROUPS.map((group) => ({
    title: group.title,
    settings: group.settings.flatMap((setting) => {
      const value = formatOrganizationSetting(row[setting.column], setting.format, row[`${setting.column}@OData.Community.Display.V1.FormattedValue`]);
      return value === undefined ? [] : [{ name: setting.label, value }];
    }),
  })).filter((group) => group.settings.length > 0);
  return {
    groups,
    baseLanguage: asNumber(row.languagecode, Number.NaN) || undefined,
    baseCurrencyId: referenceId(row._basecurrencyid_value) || undefined,
  };
}

async function readLanguages(baseLanguage: number | undefined, warnings: string[]): Promise<EnvironmentLanguage[]> {
  try {
    throwIfDataverseCollectionCancelled();
    const response = await window.dataverseAPI.execute({ operationName: 'RetrieveProvisionedLanguages', operationType: 'function' });
    if (!Array.isArray(response.RetrieveProvisionedLanguages)) throw new Error('Dataverse returned no provisioned-language list.');
    const lcids = response.RetrieveProvisionedLanguages.map((value) => asNumber(value, Number.NaN));
    if (lcids.some((lcid) => !Number.isSafeInteger(lcid) || lcid <= 0)) throw new Error('Dataverse returned an invalid language code.');
    return [...new Set(lcids)]
      .map((lcid) => ({ lcid, name: languageName(lcid), isBaseLanguage: lcid === baseLanguage }));
  } catch (error) {
    sectionFailed(warnings, 'Provisioned languages could not be read', error);
    return [];
  }
}

async function readCurrencies(baseCurrencyId: string | undefined, warnings: string[]): Promise<EnvironmentCurrency[]> {
  try {
    const rows = await queryDataverse('transactioncurrencies?$select=transactioncurrencyid,isocurrencycode,currencyname,currencysymbol,currencyprecision,exchangerate,statecode');
    return rows.map((row) => ({
      isoCode: asString(row.isocurrencycode),
      name: asString(row.currencyname),
      symbol: asString(row.currencysymbol) || undefined,
      precision: optionalNumber(row.currencyprecision, 'Currency precision', warnings),
      exchangeRate: optionalNumber(row.exchangerate, 'Currency exchange rate', warnings, false),
      isBaseCurrency: !!baseCurrencyId && referenceId(row.transactioncurrencyid) === baseCurrencyId,
      isActive: asNumber(row.statecode) === 0,
    })).sort((left, right) => Number(right.isBaseCurrency) - Number(left.isBaseCurrency) || left.isoCode.localeCompare(right.isoCode));
  } catch (error) {
    sectionFailed(warnings, 'Currencies could not be read', error);
    return [];
  }
}

async function readSolutions(warnings: string[]): Promise<EnvironmentInstalledSolution[] | undefined> {
  try {
    const rows = await fetchXmlQuery(`<fetch>
      <entity name="solution">
        <attribute name="solutionid" /><attribute name="uniquename" /><attribute name="friendlyname" /><attribute name="version" />
        <attribute name="ismanaged" /><attribute name="installedon" />
        <filter><condition attribute="isvisible" operator="eq" value="1" /></filter>
        <link-entity name="publisher" from="publisherid" to="publisherid" alias="publisher" link-type="outer">
          <attribute name="friendlyname" /><attribute name="uniquename" />
        </link-entity>
      </entity>
    </fetch>`);
    const uniqueRows = new Map(rows.map((row) => [referenceId(row.solutionid) || asString(row.uniquename).toLowerCase(), row]));
    if (uniqueRows.has('')) throw new Error('A solution was returned without an identifier; the inventory is incomplete.');
    if ([...uniqueRows.values()].some((row) => asOptionalBoolean(row.ismanaged) === undefined)) {
      throw new Error('A solution was returned without a valid managed/unmanaged flag; solution counts are unavailable.');
    }
    return [...uniqueRows.values()].map((row) => ({
      uniqueName: asString(row.uniquename),
      displayName: asString(row.friendlyname) || asString(row.uniquename),
      version: asString(row.version),
      isManaged: asBoolean(row.ismanaged),
      publisherName: asString(row['publisher.friendlyname']) || undefined,
      publisherUniqueName: asString(row['publisher.uniquename']) || undefined,
      installedOn: asString(row.installedon) || undefined,
    })).sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }));
  } catch (error) {
    sectionFailed(warnings, 'Installed solutions could not be read', error);
    return undefined;
  }
}

async function readPublishers(warnings: string[]): Promise<EnvironmentPublisher[] | undefined> {
  try {
    const rows = await fetchXmlQuery(`<fetch>
      <entity name="publisher">
        <attribute name="uniquename" /><attribute name="friendlyname" />
        <attribute name="customizationprefix" /><attribute name="customizationoptionvalueprefix" />
      </entity>
    </fetch>`);
    const uniqueRows = new Map(rows.map((row) => [asString(row.uniquename).toLowerCase(), row]));
    if (uniqueRows.has('')) throw new Error('A publisher was returned without a unique name; publisher provenance is unavailable.');
    return [...uniqueRows.values()].map((row) => ({
      uniqueName: asString(row.uniquename),
      displayName: asString(row.friendlyname) || asString(row.uniquename),
      customizationPrefix: asString(row.customizationprefix) || undefined,
      optionValuePrefix: optionalNumber(row.customizationoptionvalueprefix, 'Choice value prefix', warnings),
    })).sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }));
  } catch (error) {
    sectionFailed(warnings, 'Publishers could not be read', error);
    return undefined;
  }
}

async function readBusinessUnits(warnings: string[]): Promise<EnvironmentBusinessUnit[] | undefined> {
  try {
    const rows = await fetchXmlQuery(`<fetch>
      <entity name="businessunit">
        <attribute name="businessunitid" /><attribute name="name" /><attribute name="isdisabled" />
        <link-entity name="businessunit" from="businessunitid" to="parentbusinessunitid" alias="parent" link-type="outer">
          <attribute name="name" />
        </link-entity>
      </entity>
    </fetch>`);
    const uniqueRows = new Map(rows.map((row) => [referenceId(row.businessunitid), row]));
    if (uniqueRows.has('')) throw new Error('A business unit was returned without its identifier; the count is unavailable.');
    return [...uniqueRows.values()].map((row) => ({
      name: asString(row.name),
      parentName: asString(row['parent.name']) || undefined,
      isDisabled: asBoolean(row.isdisabled),
    })).sort((left, right) => Number(!!left.parentName) - Number(!!right.parentName) || left.name.localeCompare(right.name));
  } catch (error) {
    sectionFailed(warnings, 'Business units could not be read', error);
    return undefined;
  }
}

async function componentInventoryCount(descriptor: CountDescriptor, publishers: EnvironmentPublisher[] | undefined): Promise<Pick<EnvironmentCount, 'value' | 'custom'>> {
  if (!descriptor.namespaceAttribute) {
    return { value: await aggregateCount(descriptor.entity, descriptor.idAttribute, descriptor.filter) };
  }
  try {
    const rows = await fetchXmlQuery(`<fetch distinct="true">
      <entity name="${descriptor.entity}">
        <attribute name="${descriptor.idAttribute}" /><attribute name="${descriptor.namespaceAttribute}" />
        <order attribute="${descriptor.idAttribute}" />
        ${descriptor.filter ?? ''}
        ${descriptor.solutionPublisher ? `<link-entity name="solution" from="solutionid" to="solutionid" alias="origin_solution" link-type="outer">
          <attribute name="uniquename" /><attribute name="ismanaged" />
          <link-entity name="publisher" from="publisherid" to="publisherid" alias="origin_publisher" link-type="outer">
            <attribute name="uniquename" /><attribute name="friendlyname" /><attribute name="customizationprefix" />
          </link-entity>
        </link-entity>` : ''}
      </entity>
    </fetch>`);
    const origins = new Map<string, PublisherOrigin>();
    for (const row of rows) {
      const id = referenceId(row[descriptor.idAttribute]);
      if (!id) throw new Error(`A ${descriptor.entity} record was returned without its primary key.`);
      const namespace = namespaceOrigin(asString(row[descriptor.namespaceAttribute]), publishers);
      const origin = namespace === 'unknown' && descriptor.solutionPublisher ? associatedSolutionOrigin(row) : namespace;
      origins.set(id, origins.has(id) && origins.get(id) !== origin ? 'unknown' : origin);
    }
    return { value: origins.size, custom: customCounts([...origins.values()]) };
  } catch (error) {
    if (isCollectionCancelledError(error)) throw error;
    // A classification/read limit must not erase a separately available aggregate total.
    const value = await aggregateCount(descriptor.entity, descriptor.idAttribute, descriptor.filter);
    return { value, custom: { note: warningMessage('Publisher classification unavailable', error) } };
  }
}

async function readCounts(publishers: EnvironmentPublisher[] | undefined, warnings: string[]): Promise<EnvironmentCount[]> {
  const counts: EnvironmentCount[] = [{
    category: 'People and Security', label: 'Users in tenant',
    note: 'Unavailable: the current PPTB connection does not expose Microsoft Entra directory user counts. Dataverse systemuser records are not the tenant directory and are not used as a substitute.',
  }];
  try {
    const tables = await queryMetadataCollection('EntityDefinitions?$select=LogicalName,IsCustomEntity');
    const byName = new Map<string, PublisherOrigin>();
    for (const table of tables) {
      const name = asString(table.LogicalName).toLowerCase();
      if (!name) throw new Error('A table definition was returned without its logical name.');
      const origin = asOptionalBoolean(table.IsCustomEntity) === false ? 'excluded' : namespaceOrigin(name, publishers);
      byName.set(name, byName.has(name) && byName.get(name) !== origin ? 'unknown' : origin);
    }
    counts.push({
      category: 'Data Model', label: 'Tables (total)', value: byName.size,
      custom: customCounts([...byName.values()]),
      note: 'All table definitions visible to the connection, including system/internal tables. IsCustomEntity alone is not a non-Microsoft indicator.',
    });
  } catch (error) {
    sectionFailed(warnings, 'Table counts could not be read', error);
    counts.push({ category: 'Data Model', label: 'Tables (total)', custom: {}, note: warningMessage('Unavailable', error) });
  }
  // Sequential to stay well inside Dataverse service-protection limits.
  for (const descriptor of ENVIRONMENT_COUNT_DESCRIPTORS) {
    try {
      const result = await componentInventoryCount(descriptor, publishers);
      counts.push({ category: descriptor.category, label: descriptor.label, ...result, note: descriptor.note });
    } catch (error) {
      sectionFailed(warnings, `${descriptor.label} count could not be read`, error);
      counts.push({
        category: descriptor.category, label: descriptor.label,
        custom: descriptor.namespaceAttribute ? {} : undefined,
        note: [descriptor.note, warningMessage('Unavailable', error), 'No numerical lower bound is inferred from an aggregate-input limit.'].filter(Boolean).join(' '),
      });
    }
  }
  return counts;
}

async function readPowerPlatformApi(
  connection: EnvironmentConnectionInfo | null | undefined,
  environmentId: string | undefined,
  warnings: string[],
): Promise<Pick<EnvironmentAppendix, 'powerPlatformSettings' | 'powerPlatformStatus' | 'applicationPackages'>> {
  const empty = { powerPlatformSettings: [], applicationPackages: [] };
  if (!connection?.enabledForPowerPlatformAPI) {
    return { ...empty, powerPlatformStatus: 'Power Platform API access is not enabled for this PPTB connection, so tenant-level environment settings and installed application packages were not retrieved. Enable Power Platform API access on the connection in Power Platform ToolBox to include them.' };
  }
  if (!environmentId) {
    return { ...empty, powerPlatformStatus: 'The Power Platform environment ID could not be determined, so Power Platform API settings were not retrieved.' };
  }
  if (typeof window.powerplatformAPI === 'undefined') {
    return { ...empty, powerPlatformStatus: 'This Power Platform ToolBox host does not expose the Power Platform API.' };
  }
  const result: Pick<EnvironmentAppendix, 'powerPlatformSettings' | 'powerPlatformStatus' | 'applicationPackages'> = { ...empty };
  const environmentPath = `environments/${encodeURIComponent(environmentId)}`;
  try {
    throwIfDataverseCollectionCancelled();
    const response = await window.powerplatformAPI.EnvironmentManagement.Get(`${environmentPath}/settings?api-version=${POWER_PLATFORM_API_VERSION}`);
    const settingsRecord = [response.objectResult, response.value].flatMap((entry) => (Array.isArray(entry) ? entry : [entry])).find(isRecord) ?? response;
    result.powerPlatformSettings = settingsFromRecord(settingsRecord);
  } catch (error) {
    sectionFailed(warnings, 'Power Platform API environment settings could not be read', error);
  }
  try {
    throwIfDataverseCollectionCancelled();
    const response = await window.powerplatformAPI.AppManagement.Get(`${environmentPath}/applicationPackages?appInstallState=Installed&api-version=${POWER_PLATFORM_API_VERSION}`);
    const packages = Array.isArray(response.value) ? response.value.filter(isRecord) : [];
    result.applicationPackages = packages.map((entry): EnvironmentApplicationPackage => ({
      name: asString(entry.localizedName) || asString(entry.applicationName) || asString(entry.uniqueName),
      uniqueName: asString(entry.uniqueName) || undefined,
      version: asString(entry.version) || undefined,
      state: asString(entry.state) || undefined,
      publisherName: asString(entry.publisherName) || undefined,
    })).sort((left, right) => left.name.localeCompare(right.name));
    if (response['@odata.nextLink']) warnings.push('Installed application packages were truncated to the first page returned by the Power Platform API.');
  } catch (error) {
    sectionFailed(warnings, 'Installed application packages (Power Platform API) could not be read', error);
  }
  return result;
}

/**
 * Collects the Environment Appendix for the active connection. Each section is independent;
 * failures become warnings so a partial appendix is still produced. Cancellation is honoured
 * between requests and rethrown to the caller.
 */
export async function collectEnvironmentAppendix(
  connection?: EnvironmentConnectionInfo | null,
  onProgress?: (update: EnvironmentCollectionProgress) => void,
): Promise<EnvironmentAppendix> {
  const warnings: string[] = [];
  const identity: EnvironmentSetting[] = [];
  const update = (message: string, percent: number) => onProgress?.({ message, percent });

  if (connection) {
    identity.push({ name: 'Connection Name', value: connection.name });
    identity.push({ name: 'Environment URL', value: connection.url });
    if (connection.environment) identity.push({ name: 'Environment Type (PPTB)', value: connection.environment });
  }

  update('Reading environment identity and version...', 5);
  const environmentId = await readOrganizationDetail(identity, warnings);
  try {
    throwIfDataverseCollectionCancelled();
    const version = await window.dataverseAPI.execute({ operationName: 'RetrieveVersion', operationType: 'function' });
    if (asString(version.Version)) identity.push({ name: 'Dataverse Version', value: asString(version.Version) });
  } catch (error) {
    sectionFailed(warnings, 'Dataverse version could not be read', error);
  }

  update('Reading environment settings...', 15);
  const organization = await readOrganizationSettings(warnings);
  update('Reading languages and currencies...', 30);
  const languages = await readLanguages(organization.baseLanguage, warnings);
  const currencies = await readCurrencies(organization.baseCurrencyId, warnings);
  update('Reading installed solutions and publishers...', 45);
  const solutions = await readSolutions(warnings);
  const publishers = await readPublishers(warnings);
  update('Reading business units...', 55);
  const businessUnits = await readBusinessUnits(warnings);
  update('Counting environment components...', 65);
  const counts = await readCounts(publishers, warnings);
  const solutionCustomCounts = (items: EnvironmentInstalledSolution[] | undefined) => items === undefined ? {} : customCounts(items.map((solution) => (
    ['default', 'active'].includes(solution.uniqueName.toLowerCase()) ? 'excluded'
      : publisherOrigin(publishers?.find((publisher) => publisher.uniqueName.toLowerCase() === solution.publisherUniqueName?.toLowerCase()))
  )));
  counts.push(
    { category: 'Solutions', label: 'Installed solutions (visible)', value: solutions?.length, custom: solutionCustomCounts(solutions) },
    { category: 'Solutions', label: 'Managed solutions', value: solutions?.filter((solution) => solution.isManaged).length, custom: solutionCustomCounts(solutions?.filter((solution) => solution.isManaged)), note: 'Visible installed solutions only; hidden/internal solutions are excluded.' },
    { category: 'Solutions', label: 'Unmanaged solutions', value: solutions?.filter((solution) => !solution.isManaged).length, custom: solutionCustomCounts(solutions?.filter((solution) => !solution.isManaged)), note: 'Visible installed solutions only; hidden/internal solutions are excluded.' },
    { category: 'Solutions', label: 'Publishers', value: publishers?.length, custom: publishers === undefined ? {} : customCounts(publishers.map(publisherOrigin)) },
    { category: 'People and Security', label: 'Business units', value: businessUnits?.length, note: businessUnits === undefined ? 'Unavailable: business units could not be collected.' : undefined },
  );
  update('Reading Power Platform API settings...', 90);
  const powerPlatform = await readPowerPlatformApi(connection, environmentId, warnings);
  update('Environment appendix collected.', 100);

  return sortEnvironmentAppendix({
    collectedAt: new Date().toISOString(),
    identity,
    settingGroups: organization.groups,
    ...powerPlatform,
    languages,
    currencies,
    counts,
    solutions: solutions ?? [],
    publishers: publishers ?? [],
    businessUnits: businessUnits ?? [],
    warnings,
  });
}
