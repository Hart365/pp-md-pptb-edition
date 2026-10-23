/**
 * @file entityCollector.ts
 * @description Reads table (entity) metadata, columns, option values, keys, and relationships for connected-mode documentation.
 */

import type {
  EntityAttribute,
  EntityDefinition,
  EntityRelationship,
} from '../types/solution';
import {
  AttributeType,
} from '../types/solution';
import {
  DataverseResultLimitError, asArray, asBoolean, asNumber, asOptionalBoolean, asString, escapeXml,
  fetchXmlQuery, getLabel,
} from './dataverseClient';

/** Concurrent table-metadata reads; kept low to respect Dataverse service protection limits. */
export const ENTITY_METADATA_CONCURRENCY = 3;

export const ENTITY_PROPERTIES = [
  'MetadataId',
  'LogicalName',
  'DisplayName',
  'Description',
  'ObjectTypeCode',
  'IsCustomEntity',
  'IsIntersect',
  'IsActivity',
  'ChangeTrackingEnabled',
  'OwnershipType',
  'EntitySetName',
  'PrimaryNameAttribute',
] as const;

// Table-property flags shown on the XLSX table metadata header. Requested
// separately so an unsupported property on older orgs cannot break the base fetch.
export const EXTENDED_ENTITY_PROPERTIES = [
  'TableType',
  'HasNotes',
  'HasActivities',
  'HasFeedback',
  'HasEmailAddresses',
  'IsAuditEnabled',
  'IsDuplicateDetectionEnabled',
  'IsQuickCreateEnabled',
  'EntityHelpUrlEnabled',
  'EntityHelpUrl',
  'IsRetentionEnabled',
  'IsActivityParty',
  'IsOneNoteIntegrationEnabled',
  'IsMailMergeEnabled',
  'IsDocumentManagementEnabled',
  'IsConnectionsEnabled',
  'AutoCreateAccessTeams',
  'SyncToExternalSearchIndex',
  'IsAvailableOffline',
  'IsValidForQueue',
  'AutoRouteToOwnerQueue',
] as const;

export const MAX_SOLUTION_ENTITY_LOOKUPS = 500;
export const ENTITY_METADATA_BATCH_SIZE = 10;

/** Maps Dataverse OwnershipType values (UserOwned, OrganizationOwned, None, ...) to the shared shape. */
export function normalizeOwnershipType(value: unknown): EntityDefinition['ownershipType'] {
  const raw = asString(value).trim().toLowerCase();
  if (!raw) return undefined;
  if (raw.startsWith('user') || raw.startsWith('team')) return 'User';
  if (raw.startsWith('org') || raw.startsWith('business')) return 'Organization';
  if (raw === 'none') return 'None';
  return undefined;
}

export async function fetchEntityMetadata(logicalName: string): Promise<Record<string, unknown>> {
  try {
    return await window.dataverseAPI.getEntityMetadata(
      logicalName, true, [...ENTITY_PROPERTIES, ...EXTENDED_ENTITY_PROPERTIES],
    ) as Record<string, unknown>;
  } catch {
    return await window.dataverseAPI.getEntityMetadata(logicalName, true, [...ENTITY_PROPERTIES]) as Record<string, unknown>;
  }
}

export function optionLabel(option: Record<string, unknown>): { value: number; label: string; description?: string; color?: string } {
  return {
    value: asNumber(option.Value),
    label: getLabel(option.Label, asString(option.Value)),
    description: getLabel(option.Description),
    color: asString(option.Color) || undefined,
  };
}
export function mapAttributeType(type: string): AttributeType {
  const normalized = type.toLowerCase();
  const mapping: Record<string, AttributeType> = {
    string: AttributeType.String,
    memo: AttributeType.Memo,
    integer: AttributeType.Integer,
    bigint: AttributeType.BigInt,
    decimal: AttributeType.Decimal,
    money: AttributeType.Money,
    boolean: AttributeType.Boolean,
    datetime: AttributeType.DateTime,
    lookup: AttributeType.Lookup,
    picklist: AttributeType.OptionSet,
    multiselectpicklist: AttributeType.MultiSelectOptionSet,
    owner: AttributeType.Owner,
    uniqueidentifier: AttributeType.UniqueIdentifier,
    image: AttributeType.Image,
    file: AttributeType.File,
    customer: AttributeType.Customer,
    partylist: AttributeType.PartyList,
    managedproperty: AttributeType.ManagedProperty,
    virtual: AttributeType.Virtual,
  };

  return mapping[normalized] ?? AttributeType.Unknown;
}

export async function getEntityLogicalNamesForSolution(solutionId: string): Promise<string[]> {
  const componentRows = await fetchXmlQuery(`
    <fetch>
      <entity name="solutioncomponent">
        <attribute name="objectid" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
          <condition attribute="componenttype" operator="eq" value="1" />
        </filter>
      </entity>
    </fetch>
  `);

  const ids = Array.from(new Set(componentRows.map((row) => asString(row.objectid)).filter(Boolean)));
  if (ids.length === 0) return [];
  if (ids.length > MAX_SOLUTION_ENTITY_LOOKUPS) {
    throw new DataverseResultLimitError(
      `The selected solution contains more than ${MAX_SOLUTION_ENTITY_LOOKUPS} table components. Narrow the selected solution before generating documentation.`,
    );
  }

  const entities: Array<{ MetadataId: string; LogicalName: string; IsIntersect?: boolean }> = [];
  for (let index = 0; index < ids.length; index += ENTITY_METADATA_BATCH_SIZE) {
    const batch = ids.slice(index, index + ENTITY_METADATA_BATCH_SIZE);
    const metadata = await Promise.all(batch.map((id) => (
      window.dataverseAPI.getEntityMetadata(id, false, ['MetadataId', 'LogicalName', 'IsIntersect'])
    )));
    entities.push(...metadata);
  }

  return entities
    .filter((entity) => !asBoolean(entity.IsIntersect))
    .map((entity) => asString(entity.LogicalName))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

export interface TypedAttributeDetails {
  lookupTargets: Map<string, string[]>;
  optionSets: Map<string, Record<string, unknown>>;
}

export const OPTION_SET_ATTRIBUTE_TYPES = [
  'PicklistAttributeMetadata',
  'MultiSelectPicklistAttributeMetadata',
  'StateAttributeMetadata',
  'StatusAttributeMetadata',
] as const;

/**
 * Query a type-cast attribute collection. The base Attributes endpoint cannot
 * return type-specific properties such as Targets or OptionSet, so these are
 * fetched separately. Failures are swallowed so analysis still completes.
 */
export async function queryTypedAttributes(logicalName: string, typeName: string, query: string): Promise<Record<string, unknown>[]> {
  try {
    const escaped = logicalName.replace(/'/g, "''");
    const result = await window.dataverseAPI.queryData(
      `EntityDefinitions(LogicalName='${escaped}')/Attributes/Microsoft.Dynamics.CRM.${typeName}?${query}`,
    );
    return asArray<Record<string, unknown>>(result?.value);
  } catch {
    return [];
  }
}

export async function fetchTypedAttributeDetails(logicalName: string): Promise<TypedAttributeDetails> {
  const [lookupRows, ...optionSetRows] = await Promise.all([
    queryTypedAttributes(logicalName, 'LookupAttributeMetadata', '$select=LogicalName,Targets'),
    ...OPTION_SET_ATTRIBUTE_TYPES.map((typeName) => (
      queryTypedAttributes(logicalName, typeName, '$select=LogicalName&$expand=OptionSet,GlobalOptionSet($select=Name)')
    )),
  ]);

  const lookupTargets = new Map<string, string[]>();
  for (const row of lookupRows) {
    const name = asString(row.LogicalName);
    const targets = asArray<string>(row.Targets).filter(Boolean);
    if (name && targets.length > 0) lookupTargets.set(name.toLowerCase(), targets);
  }

  const optionSets = new Map<string, Record<string, unknown>>();
  for (const row of optionSetRows.flat()) {
    const name = asString(row.LogicalName);
    if (!name) continue;
    const optionSet = (row.OptionSet ?? {}) as Record<string, unknown>;
    const globalOptionSet = row.GlobalOptionSet as Record<string, unknown> | undefined;
    optionSets.set(name.toLowerCase(), {
      ...optionSet,
      Name: asString(optionSet.Name) || asString(globalOptionSet?.Name) || undefined,
    });
  }

  return { lookupTargets, optionSets };
}

/** Build a map of lookup attribute -> referenced tables from ManyToOne relationships. */
export function lookupTargetsFromRelationships(logicalName: string, manyToOne: Record<string, unknown>[]): Map<string, string[]> {
  const targets = new Map<string, string[]>();
  for (const relationship of manyToOne) {
    if (asString(relationship.ReferencingEntity).toLowerCase() !== logicalName.toLowerCase()) continue;
    const attribute = asString(relationship.ReferencingAttribute).toLowerCase();
    const referenced = asString(relationship.ReferencedEntity);
    if (!attribute || !referenced) continue;
    const existing = targets.get(attribute) ?? [];
    if (!existing.includes(referenced)) existing.push(referenced);
    targets.set(attribute, existing);
  }
  return targets;
}

export async function buildEntityDefinition(logicalName: string): Promise<EntityDefinition> {
  const metadata = await fetchEntityMetadata(logicalName);
  const [attributesResponse, oneToManyResponse, manyToOneResponse, manyToManyResponse, typedDetails] = await Promise.all([
    // Only request properties that are valid for base AttributeMetadata.
    // Type-specific properties (for example MaxLength on StringAttributeMetadata)
    // can break this endpoint when requested against the base type.
    window.dataverseAPI.getEntityRelatedMetadata(logicalName, 'Attributes', [
      'MetadataId',
      'LogicalName',
      'DisplayName',
      'Description',
      'AttributeType',
      'RequiredLevel',
      'IsCustomAttribute',
      'IsPrimaryName',
      'IsAuditEnabled',
      'IsValidForAdvancedFind',
      'IsSecured',
    ]),
    window.dataverseAPI.getEntityRelatedMetadata(logicalName, 'OneToManyRelationships', [
      'SchemaName',
      'ReferencedEntity',
      'ReferencingEntity',
      'ReferencingAttribute',
      'ReferencedAttribute',
      'CascadeConfiguration',
    ]),
    window.dataverseAPI.getEntityRelatedMetadata(logicalName, 'ManyToOneRelationships', [
      'SchemaName',
      'ReferencedEntity',
      'ReferencingEntity',
      'ReferencingAttribute',
      'ReferencedAttribute',
      'CascadeConfiguration',
    ]),
    window.dataverseAPI.getEntityRelatedMetadata(logicalName, 'ManyToManyRelationships', [
      'SchemaName',
      'Entity1LogicalName',
      'Entity2LogicalName',
      'IntersectEntityName',
    ]),
    fetchTypedAttributeDetails(logicalName),
  ]);

  const relationshipLookupTargets = lookupTargetsFromRelationships(
    logicalName,
    asArray<Record<string, unknown>>(manyToOneResponse.value),
  );

  const attributes = asArray<Record<string, unknown>>(attributesResponse.value).map((attribute): EntityAttribute => {
    const attributeKey = asString(attribute.LogicalName).toLowerCase();
    const optionSet = (attribute.OptionSet as Record<string, unknown> | undefined)
      ?? typedDetails.optionSets.get(attributeKey);
    const options = asArray<Record<string, unknown>>(optionSet?.Options).map(optionLabel);
    const directTargets = asArray<string>(attribute.Targets);
    const targets = directTargets.length > 0
      ? directTargets
      : typedDetails.lookupTargets.get(attributeKey) ?? relationshipLookupTargets.get(attributeKey) ?? [];
    const requiredValue = asString((attribute.RequiredLevel as { Value?: string } | undefined)?.Value);
    const maxLength =
      asNumber(attribute.MaxLength)
      || asNumber((attribute as { StringAttributeMetadata?: { MaxLength?: unknown } }).StringAttributeMetadata?.MaxLength)
      || undefined;
    const precision =
      asNumber(attribute.Precision)
      || asNumber((attribute as { DecimalAttributeMetadata?: { Precision?: unknown } }).DecimalAttributeMetadata?.Precision)
      || asNumber((attribute as { MoneyAttributeMetadata?: { Precision?: unknown } }).MoneyAttributeMetadata?.Precision)
      || undefined;

    return {
      metadataId: asString(attribute.MetadataId) || undefined,
      name: asString(attribute.LogicalName),
      displayName: getLabel(attribute.DisplayName, asString(attribute.LogicalName)),
      description: getLabel(attribute.Description),
      type: mapAttributeType(asString(attribute.AttributeType)),
      required: requiredValue === 'ApplicationRequired' || requiredValue === 'SystemRequired',
      auditing: asBoolean(attribute.IsAuditEnabled),
      maxLength,
      precision,
      lookupTarget: targets.length > 0 ? targets.join(', ') : undefined,
      options: options.length > 0 ? options : undefined,
      optionSetName: asString(optionSet?.Name) || undefined,
      isCustom: asBoolean(attribute.IsCustomAttribute, true),
      isPrimaryName: asBoolean(attribute.IsPrimaryName),
      isAuditEnabled: asBoolean(attribute.IsAuditEnabled),
      isValidForAdvancedFind: asBoolean((attribute.IsValidForAdvancedFind as { Value?: boolean } | undefined)?.Value, true),
      isSecured: asBoolean(attribute.IsSecured),
    };
  });

  const mapRelationship = (
    relationship: Record<string, unknown>,
    type: EntityRelationship['type'],
    referencedEntity: string,
    referencingEntity: string,
  ): EntityRelationship => ({
    name: asString(relationship.SchemaName),
    type,
    referencedEntity,
    referencingEntity,
    referencingAttribute: asString(relationship.ReferencingAttribute) || undefined,
    referencedAttribute: asString(relationship.ReferencedAttribute) || undefined,
    cascadeDelete: asString((relationship.CascadeConfiguration as Record<string, unknown> | undefined)?.Delete) || undefined,
    cascadeAssign: asString((relationship.CascadeConfiguration as Record<string, unknown> | undefined)?.Assign) || undefined,
    cascadeReparent: asString((relationship.CascadeConfiguration as Record<string, unknown> | undefined)?.Reparent) || undefined,
  });

  const relationships: EntityRelationship[] = [
    ...asArray<Record<string, unknown>>(oneToManyResponse.value).map((relationship) => mapRelationship(
      relationship,
      'OneToMany',
      asString(relationship.ReferencedEntity),
      asString(relationship.ReferencingEntity),
    )),
    ...asArray<Record<string, unknown>>(manyToOneResponse.value).map((relationship) => mapRelationship(
      relationship,
      'ManyToOne',
      asString(relationship.ReferencedEntity),
      asString(relationship.ReferencingEntity),
    )),
    ...asArray<Record<string, unknown>>(manyToManyResponse.value).map((relationship) => ({
      name: asString(relationship.SchemaName),
      type: 'ManyToMany' as const,
      referencedEntity: asString(relationship.Entity1LogicalName),
      referencingEntity: asString(relationship.Entity2LogicalName),
      relationshipDescription: asString(relationship.IntersectEntityName) || undefined,
    })),
  ];

  return {
    name: logicalName,
    logicalName,
    displayName: getLabel(metadata.DisplayName, logicalName),
    description: getLabel(metadata.Description),
    objectTypeCode: metadata.ObjectTypeCode ? asNumber(metadata.ObjectTypeCode) : undefined,
    isCustom: asBoolean(metadata.IsCustomEntity, true),
    isActivity: asBoolean(metadata.IsActivity),
    changeTracking: asBoolean(metadata.ChangeTrackingEnabled),
    attributes,
    relationships,
    ownershipType: normalizeOwnershipType(metadata.OwnershipType),
    entitySetName: asString(metadata.EntitySetName) || undefined,
    primaryAttributeName: asString(metadata.PrimaryNameAttribute) || undefined,
    metadataSource: 'dataverse',
    tableType: asString(metadata.TableType) || (asBoolean(metadata.IsActivity) ? 'Activity' : undefined),
    hasNotes: asOptionalBoolean(metadata.HasNotes),
    hasActivities: asOptionalBoolean(metadata.HasActivities),
    hasFeedback: asOptionalBoolean(metadata.HasFeedback),
    hasEmailAddresses: asOptionalBoolean(metadata.HasEmailAddresses),
    isAuditEnabled: asOptionalBoolean(metadata.IsAuditEnabled),
    isDuplicateDetectionEnabled: asOptionalBoolean(metadata.IsDuplicateDetectionEnabled),
    isQuickCreateEnabled: asOptionalBoolean(metadata.IsQuickCreateEnabled),
    entityHelpUrlEnabled: asOptionalBoolean(metadata.EntityHelpUrlEnabled),
    entityHelpUrl: asString(metadata.EntityHelpUrl) || undefined,
    isRetentionEnabled: asOptionalBoolean(metadata.IsRetentionEnabled),
    isActivityParty: asOptionalBoolean(metadata.IsActivityParty),
    isOneNoteIntegrationEnabled: asOptionalBoolean(metadata.IsOneNoteIntegrationEnabled),
    isMailMergeEnabled: asOptionalBoolean(metadata.IsMailMergeEnabled),
    isDocumentManagementEnabled: asOptionalBoolean(metadata.IsDocumentManagementEnabled),
    isConnectionsEnabled: asOptionalBoolean(metadata.IsConnectionsEnabled),
    autoCreateAccessTeams: asOptionalBoolean(metadata.AutoCreateAccessTeams),
    syncToExternalSearchIndex: asOptionalBoolean(metadata.SyncToExternalSearchIndex),
    isAvailableOffline: asOptionalBoolean(metadata.IsAvailableOffline),
    isValidForQueue: asOptionalBoolean(metadata.IsValidForQueue),
    autoRouteToOwnerQueue: asOptionalBoolean(metadata.AutoRouteToOwnerQueue),
  };
}
