/**
 * @file dataverseClient.ts
 * @description Shared, read-only Dataverse query primitives used by every connected-mode collector:
 * value coercion helpers, FetchXML/OData paging with safety limits, metadata collection reads,
 * and cooperative cancellation of in-flight collection runs.
 */

/** Rows requested per FetchXML page. */
export const FETCH_XML_PAGE_SIZE = 5000;
/** Maximum FetchXML pages read before a query is reported as exceeding the safety limit. */
export const FETCH_XML_MAX_PAGES = 20;
/** Maximum OData rows accepted from a single entity-set or metadata query. */
export const ODATA_MAX_ROWS = 5000;

/** Raised when a query reaches a safety limit, so callers never present truncated data as complete. */
export class DataverseResultLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataverseResultLimitError';
  }
}

/** Raised when the user cancels a collection run while Dataverse requests are still outstanding. */
export class DataverseCollectionCancelledError extends Error {
  constructor(message = 'Dataverse collection was cancelled.') {
    super(message);
    this.name = 'AbortError';
  }
}

// One documentation run executes at a time, so an ambient signal avoids threading
// a parameter through every collector while still stopping between requests.
let activeAbortSignal: AbortSignal | undefined;

/**
 * Runs a collection operation with an abort signal that every Dataverse request checks
 * before it is sent. The previous signal is restored afterwards so nested runs are safe.
 */
export async function withDataverseAbortSignal<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  const previous = activeAbortSignal;
  activeAbortSignal = signal;
  try {
    throwIfDataverseCollectionCancelled();
    return await operation();
  } finally {
    activeAbortSignal = previous;
  }
}

/** Throws {@link DataverseCollectionCancelledError} when the active collection run has been cancelled. */
export function throwIfDataverseCollectionCancelled(): void {
  if (activeAbortSignal?.aborted) throw new DataverseCollectionCancelledError();
}

/** True when an error represents user cancellation rather than a Dataverse failure. */
export function isCollectionCancelledError(error: unknown): boolean {
  return error instanceof DataverseCollectionCancelledError
    || (error instanceof Error && error.name === 'AbortError');
}

/** Escapes a value for safe inclusion in FetchXML attribute or text content. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Coerces primitive Dataverse values to a string; objects and missing values use the fallback. */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/** Narrows a value to a plain object record. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalizes GUIDs and entity-reference shapes to a lowercase, brace-free identifier. */
export function referenceId(value: unknown): string {
  if (isRecord(value)) return referenceId(value.id ?? value.Id ?? value.value ?? value.Value);
  return asString(value).trim().replace(/^\{|\}$/g, '').toLowerCase();
}

/** Coerces numeric or numeric-string values; non-finite values use the fallback. */
export function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** Coerces boolean, numeric, and "true"/"false" string values. */
export function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
}

/** Reads plain booleans and BooleanManagedProperty ({ Value }) shapes; undefined when absent. */
export function asOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'object' && 'Value' in (value as Record<string, unknown>)) {
    return asOptionalBoolean((value as Record<string, unknown>).Value);
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return undefined;
}

/** Returns the value when it is an array, otherwise an empty array. */
export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

/** Returns the first non-empty string value found under the listed keys. */
export function firstNonEmptyString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key]).trim();
    if (value) return value;
  }
  return '';
}

/** Reads the user-localized (or first available) label from a Dataverse Label object. */
export function getLabel(value: unknown, fallback = ''): string {
  if (!value || typeof value !== 'object') return fallback;
  const node = value as {
    UserLocalizedLabel?: { Label?: string };
    LocalizedLabels?: Array<{ Label?: string }>;
  };

  return node.UserLocalizedLabel?.Label
    ?? node.LocalizedLabels?.find((entry) => !!entry.Label)?.Label
    ?? fallback;
}

/** Formats a section-prefixed warning from any thrown value. */
export function warningMessage(section: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return `${section}: ${message}`;
}

/** Builds a FetchXML `in` condition; returns an empty string for an empty ID list. */
export function buildInConditions(attribute: string, ids: string[]): string {
  if (ids.length === 0) return '';
  const values = ids.map((id) => `<value>${escapeXml(id)}</value>`).join('');
  return `<condition attribute="${attribute}" operator="in">${values}</condition>`;
}

/** IDs per FetchXML `in` condition; keeps GET request URLs well below host length limits. */
export const FETCH_XML_IN_CHUNK_SIZE = 100;

/**
 * Runs one FetchXML query per chunk of IDs (see {@link FETCH_XML_IN_CHUNK_SIZE}) and concatenates
 * the rows. Replaces per-record query loops with a bounded number of set-based requests.
 */
export async function fetchXmlQueryForIds(
  ids: string[],
  buildFetchXml: (inCondition: string) => string,
  attribute: string,
): Promise<Record<string, unknown>[]> {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start < uniqueIds.length; start += FETCH_XML_IN_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(start, start + FETCH_XML_IN_CHUNK_SIZE);
    rows.push(...await fetchXmlQuery(buildFetchXml(buildInConditions(attribute, chunk))));
  }
  return rows;
}

/** Build the FetchXML join used to scope a component record to one solution. */
export function solutionComponentLink(solutionId: string, recordId: string, componentTypes: number[]): string {
  const typeFilter = componentTypes.map((type) => `<value>${type}</value>`).join('');
  return `<link-entity name="solutioncomponent" from="objectid" to="${recordId}" link-type="inner">
    <filter type="and">
      <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
      <condition attribute="componenttype" operator="in">${typeFilter}</condition>
    </filter>
  </link-entity>`;
}

function withFetchXmlPage(fetchXml: string, page: number, pagingCookie?: string): string {
  const match = /<fetch\b([^>]*)>/i.exec(fetchXml);
  if (!match) throw new Error('Invalid FetchXML: missing fetch root element.');

  const attributes = match[1].replace(/\s+(?:count|page|paging-cookie)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  const pagingAttributes = [`count="${FETCH_XML_PAGE_SIZE}"`, `page="${page}"`];
  if (pagingCookie) pagingAttributes.push(`paging-cookie="${escapeXml(pagingCookie)}"`);

  return fetchXml.replace(match[0], `<fetch${attributes} ${pagingAttributes.join(' ')}>`);
}

function decodeFetchXmlPagingCookie(annotation: string): string {
  // Web API wraps a twice-URL-encoded SDK cookie; some hosts return the SDK cookie directly.
  const wrappedCookie = /\bpagingcookie\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(annotation);
  if (!wrappedCookie) return annotation;
  try {
    return decodeURIComponent(decodeURIComponent(wrappedCookie[1] ?? wrappedCookie[2]));
  } catch {
    throw new Error('Dataverse returned an invalid URL-encoded FetchXML paging cookie.');
  }
}

/**
 * Runs a FetchXML query, paging with the server paging cookie until all rows are read.
 * Queries with an explicit `top` are sent once. Cancellation is checked before every page.
 */
export async function fetchXmlQuery(fetchXml: string): Promise<Record<string, unknown>[]> {
  const fetchRoot = /<fetch\b([^>]*)>/i.exec(fetchXml);
  if (!fetchRoot) throw new Error('Invalid FetchXML: missing fetch root element.');
  throwIfDataverseCollectionCancelled();
  if (/\btop\s*=/i.test(fetchRoot[1])) {
    const result = await window.dataverseAPI.fetchXmlQuery(fetchXml);
    return result.value;
  }

  const rows: Record<string, unknown>[] = [];
  let pagingCookie: string | undefined;
  for (let page = 1; page <= FETCH_XML_MAX_PAGES; page += 1) {
    throwIfDataverseCollectionCancelled();
    const result = await window.dataverseAPI.fetchXmlQuery(withFetchXmlPage(fetchXml, page, pagingCookie));
    rows.push(...result.value);
    const moreRecords = asOptionalBoolean('@Microsoft.Dynamics.CRM.morerecords' in result
      ? result['@Microsoft.Dynamics.CRM.morerecords'] : undefined);
    if (moreRecords === false) return rows;
    const annotation = result['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'];
    pagingCookie = annotation ? decodeFetchXmlPagingCookie(annotation) : undefined;
    if (moreRecords === true && !pagingCookie) {
      throw new Error('Dataverse reported more FetchXML records without a paging cookie; the inventory is incomplete.');
    }
    if (!pagingCookie && result.value.length < FETCH_XML_PAGE_SIZE) return rows;
  }

  throw new DataverseResultLimitError(
    `FetchXML results exceeded the ${FETCH_XML_PAGE_SIZE * FETCH_XML_MAX_PAGES}-row safety limit. Narrow the selected solution or collection scope.`,
  );
}

/** Reads a single metadata definition; some host versions wrap the record in `value`. */
export async function readMetadataRecord(query: string): Promise<Record<string, unknown>> {
  throwIfDataverseCollectionCancelled();
  const response: unknown = await window.dataverseAPI.queryData(query);
  if (!isRecord(response)) throw new Error('Dataverse returned an invalid metadata response.');
  const record: unknown = Array.isArray(response.value) ? response.value[0] : isRecord(response.value) ? response.value : response;
  if (!isRecord(record)) throw new Error('Dataverse did not return the requested metadata definition.');
  return record;
}

/** Reads a metadata collection; metadata endpoints return all matches and reject `$top`. */
export async function queryMetadataCollection(query: string): Promise<Record<string, unknown>[]> {
  throwIfDataverseCollectionCancelled();
  const response: unknown = await window.dataverseAPI.queryData(query);
  if (!isRecord(response) || !Array.isArray(response.value) || !response.value.every(isRecord)) {
    throw new Error('Dataverse returned an invalid metadata collection.');
  }
  if (response.value.length > ODATA_MAX_ROWS) {
    throw new DataverseResultLimitError(`Metadata lookup exceeded the ${ODATA_MAX_ROWS}-table safety limit.`);
  }
  if (response['@odata.nextLink']) {
    throw new DataverseResultLimitError('Dataverse returned a partial metadata collection; it cannot be reported as a complete inventory.');
  }
  return response.value;
}

/** Query a Dataverse entity set with explicit OData selection and filtering, bounded by `$top`. */
export async function queryDataverse(odataQuery: string): Promise<Record<string, unknown>[]> {
  throwIfDataverseCollectionCancelled();
  const separator = odataQuery.includes('?') ? '&' : '?';
  const boundedQuery = /(?:\?|&)\$top=/i.test(odataQuery)
    ? odataQuery
    : `${odataQuery}${separator}$top=${ODATA_MAX_ROWS}`;
  const result = await window.dataverseAPI.queryData(boundedQuery);
  if (result.value.length >= ODATA_MAX_ROWS) {
    throw new DataverseResultLimitError(
      `OData results reached the ${ODATA_MAX_ROWS}-row safety limit and may be incomplete. Narrow the selected solution or collection scope.`,
    );
  }
  return result.value;
}

/**
 * Tries each candidate OData query in order (for schema differences between Dataverse versions)
 * and returns the first success. Failures become warnings; cancellation is always rethrown.
 */
export async function queryDataverseWithFallback(
  candidateQueries: string[],
  section: string,
  warnings: string[] = [],
  warnOnFailure = true,
): Promise<Record<string, unknown>[]> {
  const errors: unknown[] = [];

  for (const query of candidateQueries) {
    try {
      return await queryDataverse(query);
    } catch (error) {
      if (isCollectionCancelledError(error)) throw error;
      errors.push(error);
    }
  }

  const resultLimitError = errors.find((error) => error instanceof DataverseResultLimitError);
  if (errors.length > 0 && warnings && (warnOnFailure || resultLimitError)) {
    warnings.push(warningMessage(section, resultLimitError ?? errors[0]));
  }

  return [];
}
