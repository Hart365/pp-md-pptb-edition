/**
 * @file solutionService.ts
 * @description Read-only Dataverse solution access for connected-mode documentation generation.
 */

import type {
  AppDefinition,
  DashboardDefinition,
  EntityAttribute,
  EntityDefinition,
  EntityRelationship,
  EnvironmentVariableDefinition,
  FieldSecurityProfileDefinition,
  FormDefinition,
  ParsedSolution,
  PluginAssemblyDefinition,
  PluginStepDefinition,
  ProcessDefinition,
  ProcessStep,
  ReportDefinition,
  RolePrivilege,
  SecurityRoleDefinition,
  SolutionMetadata,
  ViewDefinition,
  WebResourceDefinition,
  ConnectionReferenceDefinition,
  DataverseCustomApiDefinition,
} from '../types/solution';
import {
  AppType,
  AttributeType,
  ProcessCategory,
  WebResourceType,
} from '../types/solution';

export interface DataverseSolutionSummary {
  solutionId: string;
  uniqueName: string;
  displayName: string;
  description?: string;
  publisherName?: string;
  version: string;
  isManaged: boolean;
  installedOn?: string;
}

export interface DataverseProgressUpdate {
  message: string;
  percent: number;
}

const ENTITY_PROPERTIES = [
  'MetadataId',
  'LogicalName',
  'DisplayName',
  'Description',
  'ObjectTypeCode',
  'IsCustomEntity',
  'IsActivity',
  'ChangeTrackingEnabled',
  'OwnershipType',
  'EntitySetName',
  'PrimaryNameAttribute',
] as const;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return fallback;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function firstNonEmptyString(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = asString(row[key]).trim();
    if (value) return value;
  }
  return '';
}

function getLabel(value: unknown, fallback = ''): string {
  if (!value || typeof value !== 'object') return fallback;
  const node = value as {
    UserLocalizedLabel?: { Label?: string };
    LocalizedLabels?: Array<{ Label?: string }>;
  };

  return node.UserLocalizedLabel?.Label
    ?? node.LocalizedLabels?.find((entry) => !!entry.Label)?.Label
    ?? fallback;
}

function buildInConditions(attribute: string, ids: string[]): string {
  if (ids.length === 0) return '';
  const values = ids.map((id) => `<value>${escapeXml(id)}</value>`).join('');
  return `<condition attribute="${attribute}" operator="in">${values}</condition>`;
}

async function fetchXmlQuery(fetchXml: string): Promise<Record<string, unknown>[]> {
  const result = await window.dataverseAPI.fetchXmlQuery(fetchXml);
  return result.value;
}

function warningMessage(section: string, error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return `${section}: ${message}`;
}

function optionLabel(option: Record<string, unknown>): { value: number; label: string; description?: string } {
  return {
    value: asNumber(option.Value),
    label: getLabel(option.Label, asString(option.Value)),
    description: getLabel(option.Description),
  };
}

function mapAttributeType(type: string): AttributeType {
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

function mapWebResourceType(type: number): WebResourceType {
  const mapping: Record<number, WebResourceType> = {
    1: WebResourceType.HTML,
    2: WebResourceType.CSS,
    3: WebResourceType.JavaScript,
    4: WebResourceType.XML,
    5: WebResourceType.PNG,
    6: WebResourceType.JPG,
    7: WebResourceType.GIF,
    8: WebResourceType.XAP,
    9: WebResourceType.XSL,
    10: WebResourceType.ICO,
    11: WebResourceType.SVG,
    12: WebResourceType.Resx,
  };
  return mapping[type] ?? WebResourceType.Unknown;
}

function mapProcessCategory(category: number): ProcessCategory {
  const mapping: Record<number, ProcessCategory> = {
    0: ProcessCategory.Workflow,
    1: ProcessCategory.Dialog,
    2: ProcessCategory.BusinessRule,
    3: ProcessCategory.Action,
    4: ProcessCategory.BusinessProcessFlow,
    5: ProcessCategory.PowerAutomateFlow,
    6: ProcessCategory.CustomAction,
  };

  return mapping[category] ?? ProcessCategory.Workflow;
}

function mapFormType(type: number): string {
  const mapping: Record<number, string> = {
    2: 'Main',
    6: 'Quick View',
    7: 'Card',
    11: 'Quick Create',
    12: 'Main Interactive',
  };
  return mapping[type] ?? `Type ${type}`;
}

function privilegeDepthFromMask(mask: number): number {
  const normalized = Math.max(0, mask);
  if ((normalized & 8) === 8) return 4;
  if ((normalized & 4) === 4) return 3;
  if ((normalized & 2) === 2) return 2;
  if ((normalized & 1) === 1) return 1;
  return 0;
}

function extractFormFields(formXml: string): Array<{ attributeName: string; label?: string }> {
  if (!formXml) return [];
  try {
    const xml = new DOMParser().parseFromString(formXml, 'text/xml');
    const controls = Array.from(xml.querySelectorAll('control[datafieldname]'));
    const seen = new Set<string>();
    const fields: Array<{ attributeName: string; label?: string } | null> = controls.map((control) => {
      const attributeName = control.getAttribute('datafieldname')?.trim() ?? '';
      const label = control.getAttribute('id')?.trim() ?? undefined;
      if (!attributeName || seen.has(attributeName)) return null;
      seen.add(attributeName);
      return { attributeName, label };
    });
    return fields.filter((entry): entry is { attributeName: string; label?: string } => entry !== null);
  } catch {
    return [];
  }
}

function extractViewColumns(layoutXml: string): string[] {
  if (!layoutXml) return [];
  try {
    const xml = new DOMParser().parseFromString(layoutXml, 'text/xml');
    return Array.from(xml.querySelectorAll('cell[name]'))
      .map((cell) => cell.getAttribute('name')?.trim() ?? '')
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getSolutionMetadata(solutionId: string): Promise<SolutionMetadata> {
  const rows = await fetchXmlQuery(`
    <fetch top="1">
      <entity name="solution">
        <attribute name="solutionid" />
        <attribute name="uniquename" />
        <attribute name="friendlyname" />
        <attribute name="version" />
        <attribute name="description" />
        <attribute name="ismanaged" />
        <link-entity name="publisher" from="publisherid" to="publisherid" alias="publisher" link-type="outer">
          <attribute name="friendlyname" />
          <attribute name="uniquename" />
        </link-entity>
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  const row = rows[0] ?? {};
  return {
    uniqueName: asString(row.uniquename),
    displayName: asString(row.friendlyname) || asString(row.uniquename),
    version: asString(row.version),
    publisherName: asString(row['publisher.friendlyname']),
    publisherUniqueName: asString(row['publisher.uniquename']),
    description: asString(row.description),
    isManaged: asBoolean(row.ismanaged),
  };
}

async function getEntityLogicalNamesForSolution(solutionId: string): Promise<string[]> {
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

  const ids = new Set(componentRows.map((row) => asString(row.objectid)).filter(Boolean));
  if (ids.size === 0) return [];

  const allEntities = await window.dataverseAPI.getAllEntitiesMetadata([...ENTITY_PROPERTIES]);
  return allEntities.value
    .filter((entity) => ids.has(asString(entity.MetadataId)))
    .map((entity) => asString(entity.LogicalName))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

async function buildEntityDefinition(logicalName: string): Promise<EntityDefinition> {
  const metadata = await window.dataverseAPI.getEntityMetadata(logicalName, true, [...ENTITY_PROPERTIES]);
  const [attributesResponse, oneToManyResponse, manyToOneResponse, manyToManyResponse] = await Promise.all([
    // Only request properties that are valid for base AttributeMetadata.
    // Type-specific properties (for example MaxLength on StringAttributeMetadata)
    // can break this endpoint when requested against the base type.
    window.dataverseAPI.getEntityRelatedMetadata(logicalName, 'Attributes', [
      'LogicalName',
      'DisplayName',
      'Description',
      'AttributeType',
      'RequiredLevel',
      'IsCustomAttribute',
      'IsPrimaryName',
      'IsAuditEnabled',
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
  ]);

  const attributes = asArray<Record<string, unknown>>(attributesResponse.value).map((attribute): EntityAttribute => {
    const optionSet = attribute.OptionSet as Record<string, unknown> | undefined;
    const options = asArray<Record<string, unknown>>(optionSet?.Options).map(optionLabel);
    const targets = asArray<string>(attribute.Targets);
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
      name: asString(attribute.LogicalName),
      displayName: getLabel(attribute.DisplayName, asString(attribute.LogicalName)),
      description: getLabel(attribute.Description),
      type: mapAttributeType(asString(attribute.AttributeType)),
      required: requiredValue === 'ApplicationRequired' || requiredValue === 'SystemRequired',
      auditing: asBoolean(attribute.IsAuditEnabled),
      maxLength,
      precision,
      lookupTarget: targets[0],
      options: options.length > 0 ? options : undefined,
      optionSetName: asString(optionSet?.Name) || undefined,
      isCustom: asBoolean(attribute.IsCustomAttribute, true),
      isPrimaryName: asBoolean(attribute.IsPrimaryName),
      isAuditEnabled: asBoolean(attribute.IsAuditEnabled),
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
    ownershipType: asString(metadata.OwnershipType) as EntityDefinition['ownershipType'],
    entitySetName: asString(metadata.EntitySetName) || undefined,
    primaryAttributeName: asString(metadata.PrimaryNameAttribute) || undefined,
  };
}

async function fetchForms(solutionId: string): Promise<FormDefinition[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="systemform">
        <attribute name="name" />
        <attribute name="description" />
        <attribute name="objecttypecode" />
        <attribute name="type" />
        <attribute name="formxml" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  return rows
    .filter((row) => {
      const type = asNumber(row.type, -1);
      return [2, 6, 7, 11, 12].includes(type);
    })
    .map((row): FormDefinition => ({
      name: asString(row.name),
      displayName: asString(row.name),
      description: asString(row.description) || undefined,
      entityLogicalName: asString(row.objecttypecode),
      formType: mapFormType(asNumber(row.type)),
      fields: extractFormFields(asString(row.formxml)),
    }));
}

async function fetchViews(solutionId: string): Promise<ViewDefinition[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="savedquery">
        <attribute name="name" />
        <attribute name="description" />
        <attribute name="returnedtypecode" />
        <attribute name="querytype" />
        <attribute name="fetchxml" />
        <attribute name="layoutxml" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  return rows.map((row): ViewDefinition => ({
    name: asString(row.name),
    displayName: asString(row.name),
    description: asString(row.description) || undefined,
    entityLogicalName: asString(row.returnedtypecode),
    viewType: asString(row.querytype) || 'Public',
    columns: extractViewColumns(asString(row.layoutxml)),
    fetchXml: asString(row.fetchxml) || undefined,
  }));
}

function buildWorkflowSteps(row: Record<string, unknown>): ProcessStep[] {
  const steps: ProcessStep[] = [];
  const updateAttributes = asString(row.triggeronupdateattributelist)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (asBoolean(row.triggeroncreate)) {
    steps.push({ id: `${asString(row.workflowid)}-create`, name: 'On Create', stepType: 'Trigger' });
  }
  if (asBoolean(row.triggerondelete)) {
    steps.push({ id: `${asString(row.workflowid)}-delete`, name: 'On Delete', stepType: 'Trigger' });
  }
  if (updateAttributes.length > 0) {
    steps.push({
      id: `${asString(row.workflowid)}-update`,
      name: 'On Update',
      stepType: 'Trigger',
      description: `Triggered by: ${updateAttributes.join(', ')}`,
      referencedEntities: [asString(row.primaryentity)].filter(Boolean),
    });
  }

  return steps;
}

interface SolutionAppComponentIds {
  modelDrivenIds: string[];
  canvasIds: string[];
}

function detectCanvasAppType(row: Record<string, unknown>): AppType {
  const numericType = asNumber(
    row.canvastype
    ?? row.canvasapptype
    ?? row.apptype,
    -1,
  );

  if (numericType === 2 || numericType === 3) {
    return AppType.CustomPage;
  }

  const signal = [
    asString(row.canvastype),
    asString(row.canvasapptype),
    asString(row.apptype),
    asString(row.type),
    asString(row.description),
    asString(row.displayname),
    asString(row.name),
  ].join(' ').toLowerCase();

  if (signal.includes('custompage') || signal.includes('custom page')) {
    return AppType.CustomPage;
  }

  return AppType.Canvas;
}

function dedupeApps(apps: AppDefinition[]): AppDefinition[] {
  const map = new Map<string, AppDefinition>();

  apps.forEach((app) => {
    const key = (app.uniqueName || app.name || app.displayName || '').toLowerCase();
    if (!key) return;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, app);
      return;
    }

    map.set(key, {
      ...existing,
      ...app,
      entities: Array.from(new Set([...(existing.entities ?? []), ...(app.entities ?? [])])),
      connectors: Array.from(new Set([...(existing.connectors ?? []), ...(app.connectors ?? [])])),
      sitemapAreas: Array.from(new Set([...(existing.sitemapAreas ?? []), ...(app.sitemapAreas ?? [])])),
    });
  });

  return Array.from(map.values());
}

async function fetchSolutionAppComponentIds(solutionId: string, warnings: string[]): Promise<SolutionAppComponentIds> {
  try {
    const rows = await fetchXmlQuery(`
      <fetch>
        <entity name="solutioncomponent">
          <attribute name="objectid" />
          <attribute name="componenttype" />
          <filter type="and">
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
            <condition attribute="componenttype" operator="in">
              <value>60</value>
              <value>300</value>
            </condition>
          </filter>
        </entity>
      </fetch>
    `);

    const modelDrivenIds = new Set<string>();
    const canvasIds = new Set<string>();

    rows.forEach((row) => {
      const objectId = asString(row.objectid);
      const componentType = asNumber(row.componenttype, -1);
      if (!objectId) return;

      if (componentType === 60) {
        modelDrivenIds.add(objectId);
      } else if (componentType === 300) {
        canvasIds.add(objectId);
      }
    });

    return {
      modelDrivenIds: Array.from(modelDrivenIds),
      canvasIds: Array.from(canvasIds),
    };
  } catch (error) {
    warnings.push(warningMessage('App components could not be discovered from solution metadata', error));
    return {
      modelDrivenIds: [],
      canvasIds: [],
    };
  }
}

async function fetchProcesses(solutionId: string): Promise<ProcessDefinition[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="workflow">
        <attribute name="workflowid" />
        <attribute name="name" />
        <attribute name="description" />
        <attribute name="uniquename" />
        <attribute name="category" />
        <attribute name="primaryentity" />
        <attribute name="statecode" />
        <attribute name="scope" />
        <attribute name="ondemand" />
        <attribute name="triggeroncreate" />
        <attribute name="triggerondelete" />
        <attribute name="triggeronupdateattributelist" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  return rows.map((row): ProcessDefinition => {
    const triggerAttributes = asString(row.triggeronupdateattributelist)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      name: asString(row.name),
      displayName: asString(row.name),
      description: asString(row.description) || undefined,
      uniqueName: asString(row.uniquename) || asString(row.name),
      category: mapProcessCategory(asNumber(row.category)),
      primaryEntity: asString(row.primaryentity) || undefined,
      relatedEntities: [asString(row.primaryentity)].filter(Boolean),
      isActivated: asNumber(row.statecode) === 1,
      triggerType: asBoolean(row.ondemand) ? 'On Demand' : (triggerAttributes.length > 0 ? 'On Update' : 'Automated'),
      triggerAttributes: triggerAttributes.length > 0 ? triggerAttributes : undefined,
      steps: buildWorkflowSteps(row),
      scope: asString(row.scope) || undefined,
    };
  });
}

async function fetchCustomApis(solutionId: string, warnings: string[]): Promise<DataverseCustomApiDefinition[]> {
  try {
    const rows = await fetchXmlQuery(`
      <fetch>
        <entity name="customapi">
          <attribute name="name" />
          <attribute name="uniquename" />
          <attribute name="description" />
          <attribute name="bindingtype" />
          <attribute name="isfunction" />
          <attribute name="isprivate" />
          <attribute name="allowedcustomprocessingsteptype" />
          <filter>
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
          </filter>
        </entity>
      </fetch>
    `);

    return rows.map((row): DataverseCustomApiDefinition => ({
      name: asString(row.name) || asString(row.uniquename),
      displayName: asString(row.name) || asString(row.uniquename),
      description: asString(row.description) || undefined,
      uniqueName: asString(row.uniquename) || asString(row.name),
      isFunction: asBoolean(row.isfunction),
      isPrivate: asBoolean(row.isprivate),
      bindingType: asString(row.bindingtype) || undefined,
      allowedCustomProcessingStepType: asString(row.allowedcustomprocessingsteptype) || undefined,
    }));
  } catch (error) {
    warnings.push(warningMessage('Custom APIs could not be read', error));
    return [];
  }
}

async function fetchApps(solutionId: string, warnings: string[]): Promise<AppDefinition[]> {
  const apps: AppDefinition[] = [];
  const componentIds = await fetchSolutionAppComponentIds(solutionId, warnings);

  try {
    const modelDrivenFilter = componentIds.modelDrivenIds.length > 0
      ? buildInConditions('appmoduleid', componentIds.modelDrivenIds)
      : `<condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />`;

    const modelDrivenRows = await fetchXmlQuery(`
      <fetch>
        <entity name="appmodule">
          <attribute name="appmoduleid" />
          <attribute name="name" />
          <attribute name="uniquename" />
          <attribute name="description" />
          <attribute name="statecode" />
          <attribute name="versionnumber" />
          <filter>
            ${modelDrivenFilter}
          </filter>
        </entity>
      </fetch>
    `);

    const appEntityMap = new Map<string, Set<string>>();
    const appModuleIds = modelDrivenRows
      .map((row) => asString(row.appmoduleid))
      .filter(Boolean);

    if (appModuleIds.length > 0) {
      try {
        const appComponentRows = await fetchXmlQuery(`
          <fetch>
            <entity name="appmodulecomponent">
              <attribute name="appmoduleid" />
              <attribute name="componenttype" />
              <attribute name="objectid" />
              <filter type="and">
                ${buildInConditions('appmoduleid', appModuleIds)}
                <condition attribute="componenttype" operator="eq" value="1" />
              </filter>
            </entity>
          </fetch>
        `);

        const entityMetadataIds = Array.from(new Set(
          appComponentRows.map((row) => asString(row.objectid)).filter(Boolean),
        ));

        if (entityMetadataIds.length > 0) {
          const entityMetadataRows = await window.dataverseAPI.getAllEntitiesMetadata(['MetadataId', 'LogicalName']);
          const metadataIdToLogicalName = new Map(
            entityMetadataRows.value.map((entity) => [asString(entity.MetadataId), asString(entity.LogicalName)]),
          );

          appComponentRows.forEach((row) => {
            const appModuleId = asString(row.appmoduleid);
            const logicalName = metadataIdToLogicalName.get(asString(row.objectid));
            if (!appModuleId || !logicalName) return;

            if (!appEntityMap.has(appModuleId)) {
              appEntityMap.set(appModuleId, new Set<string>());
            }
            appEntityMap.get(appModuleId)!.add(logicalName);
          });
        }
      } catch (error) {
        warnings.push(warningMessage('Model-driven app table references could not be read', error));
      }
    }

    apps.push(...modelDrivenRows.map((row): AppDefinition => ({
      name: asString(row.name),
      displayName: asString(row.name),
      description: asString(row.description) || undefined,
      uniqueName: asString(row.uniquename) || asString(row.name),
      appType: AppType.ModelDriven,
      isEnabled: asNumber(row.statecode) === 0,
      version: asString(row.versionnumber) || undefined,
      entities: Array.from(appEntityMap.get(asString(row.appmoduleid)) ?? []),
    })));
  } catch (error) {
    warnings.push(warningMessage('Model-driven apps could not be read', error));
  }

  try {
    const canvasFilter = componentIds.canvasIds.length > 0
      ? buildInConditions('canvasappid', componentIds.canvasIds)
      : `<condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />`;

    let canvasRows: Record<string, unknown>[] = [];

    try {
      canvasRows = await fetchXmlQuery(`
        <fetch>
          <entity name="canvasapp">
            <attribute name="canvasappid" />
            <attribute name="displayname" />
            <attribute name="name" />
            <attribute name="description" />
            <attribute name="statecode" />
            <attribute name="canvastype" />
            <attribute name="version" />
            <filter>
              ${canvasFilter}
            </filter>
          </entity>
        </fetch>
      `);
    } catch {
      // Fallback for environments where optional columns are not exposed.
      canvasRows = await fetchXmlQuery(`
        <fetch>
          <entity name="canvasapp">
            <attribute name="canvasappid" />
            <attribute name="displayname" />
            <attribute name="name" />
            <attribute name="description" />
            <filter>
              ${canvasFilter}
            </filter>
          </entity>
        </fetch>
      `);
    }

    apps.push(...canvasRows.map((row): AppDefinition => ({
      name: asString(row.name) || asString(row.displayname),
      displayName: asString(row.displayname) || asString(row.name),
      description: asString(row.description) || undefined,
      uniqueName: asString(row.name) || asString(row.displayname),
      appType: detectCanvasAppType(row),
      isEnabled: row.statecode === undefined ? true : asNumber(row.statecode) === 0,
      version: asString(row.version) || undefined,
    })));
  } catch (error) {
    warnings.push(warningMessage('Canvas apps could not be read', error));
  }

  return dedupeApps(apps);
}

async function fetchWebResources(solutionId: string): Promise<WebResourceDefinition[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="webresource">
        <attribute name="name" />
        <attribute name="displayname" />
        <attribute name="description" />
        <attribute name="webresourcetype" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  return rows.map((row): WebResourceDefinition => ({
    name: asString(row.name),
    displayName: asString(row.displayname) || asString(row.name),
    description: asString(row.description) || undefined,
    schemaName: asString(row.name),
    resourceType: mapWebResourceType(asNumber(row.webresourcetype)),
  }));
}

async function fetchSecurityRoles(solutionId: string, warnings: string[]): Promise<SecurityRoleDefinition[]> {
  try {
    const roleRows = await fetchXmlQuery(`
      <fetch>
        <entity name="role">
          <attribute name="roleid" />
          <attribute name="name" />
          <filter>
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
          </filter>
        </entity>
      </fetch>
    `);

    const roles = roleRows.map((row): SecurityRoleDefinition => ({
      name: asString(row.name),
      displayName: asString(row.name),
      privileges: [],
    }));

    const roleIds = roleRows.map((row) => asString(row.roleid)).filter(Boolean);
    if (roleIds.length === 0) {
      return roles;
    }

    try {
      const rolePrivilegeRows = await fetchXmlQuery(`
        <fetch>
          <entity name="roleprivileges">
            <attribute name="roleid" />
            <attribute name="privilegeid" />
            <attribute name="privilegedepthmask" />
            <filter>
              ${buildInConditions('roleid', roleIds)}
            </filter>
          </entity>
        </fetch>
      `);

      const privilegeIds = Array.from(new Set(
        rolePrivilegeRows.map((row) => asString(row.privilegeid)).filter(Boolean),
      ));

      let privilegeNameById = new Map<string, string>();
      if (privilegeIds.length > 0) {
        const privilegeRows = await fetchXmlQuery(`
          <fetch>
            <entity name="privilege">
              <attribute name="privilegeid" />
              <attribute name="name" />
              <filter>
                ${buildInConditions('privilegeid', privilegeIds)}
              </filter>
            </entity>
          </fetch>
        `);

        privilegeNameById = new Map(
          privilegeRows.map((row) => [asString(row.privilegeid), asString(row.name)]),
        );
      }

      const privilegesByRoleId = new Map<string, RolePrivilege[]>();
      rolePrivilegeRows.forEach((row) => {
        const roleId = asString(row.roleid);
        const privilegeId = asString(row.privilegeid);
        if (!roleId || !privilegeId) return;

        const privilegeName = privilegeNameById.get(privilegeId) || privilegeId;
        const depth = privilegeDepthFromMask(asNumber(row.privilegedepthmask));

        if (!privilegesByRoleId.has(roleId)) {
          privilegesByRoleId.set(roleId, []);
        }

        privilegesByRoleId.get(roleId)!.push({
          privilegeName,
          depth,
        });
      });

      return roleRows.map((row): SecurityRoleDefinition => {
        const roleId = asString(row.roleid);
        return {
          name: asString(row.name),
          displayName: asString(row.name),
          privileges: privilegesByRoleId.get(roleId) ?? [],
        };
      });
    } catch (error) {
      warnings.push(warningMessage('Security role privileges could not be read', error));
      return roles;
    }
  } catch (error) {
    warnings.push(warningMessage('Security roles could not be read', error));
    return [];
  }
}

async function fetchFieldSecurityProfiles(solutionId: string, warnings: string[]): Promise<FieldSecurityProfileDefinition[]> {
  try {
    const rows = await fetchXmlQuery(`
      <fetch>
        <entity name="fieldsecurityprofile">
          <attribute name="name" />
          <attribute name="description" />
          <filter>
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
          </filter>
        </entity>
      </fetch>
    `);

    return rows.map((row): FieldSecurityProfileDefinition => ({
      name: asString(row.name),
      displayName: asString(row.name),
      description: asString(row.description) || undefined,
      permissions: [],
    }));
  } catch (error) {
    warnings.push(warningMessage('Field security profiles could not be read', error));
    return [];
  }
}

async function fetchConnectionReferences(solutionId: string): Promise<ConnectionReferenceDefinition[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="connectionreference">
        <attribute name="connectionreferenceid" />
        <attribute name="connectionreferencelogicalname" />
        <attribute name="connectionreferencedisplayname" />
        <attribute name="connectionid" />
        <attribute name="connectorid" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  return rows.map((row): ConnectionReferenceDefinition => ({
    name: firstNonEmptyString(row, ['connectionreferencedisplayname', 'connectionreferencelogicalname']) || asString(row.connectionreferenceid),
    displayName: firstNonEmptyString(row, ['connectionreferencedisplayname']) || undefined,
    connectorId: asString(row.connectorid),
    connectionId: asString(row.connectionid) || undefined,
  }));
}

async function fetchEnvironmentVariables(solutionId: string, warnings: string[]): Promise<EnvironmentVariableDefinition[]> {
  const definitions = await fetchXmlQuery(`
    <fetch>
      <entity name="environmentvariabledefinition">
        <attribute name="environmentvariabledefinitionid" />
        <attribute name="displayname" />
        <attribute name="description" />
        <attribute name="schemaname" />
        <attribute name="type" />
        <attribute name="defaultvalue" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);

  const definitionIds = definitions.map((row) => asString(row.environmentvariabledefinitionid)).filter(Boolean);
  let valuesByDefinitionId = new Map<string, string>();

  if (definitionIds.length > 0) {
    try {
      const valueRows = await fetchXmlQuery(`
        <fetch>
          <entity name="environmentvariablevalue">
            <attribute name="value" />
            <attribute name="environmentvariabledefinitionid" />
            <filter type="and">
              ${buildInConditions('environmentvariabledefinitionid', definitionIds)}
            </filter>
          </entity>
        </fetch>
      `);
      valuesByDefinitionId = new Map(
        valueRows.map((row) => [asString(row.environmentvariabledefinitionid), asString(row.value)]),
      );
    } catch (error) {
      warnings.push(warningMessage('Environment variable current values could not be read', error));
    }
  }

  return definitions.map((row): EnvironmentVariableDefinition => {
    const id = asString(row.environmentvariabledefinitionid);
    const currentValue = valuesByDefinitionId.get(id);
    return {
      name: asString(row.displayname) || asString(row.schemaname),
      displayName: asString(row.displayname) || undefined,
      description: asString(row.description) || undefined,
      type: asString(row.type) || 'String',
      defaultValue: asString(row.defaultvalue) || undefined,
      hasCurrentValue: typeof currentValue === 'string' && currentValue.length > 0,
      currentValue,
      schemaName: asString(row.schemaname),
    };
  });
}

async function fetchReports(solutionId: string, warnings: string[]): Promise<ReportDefinition[]> {
  try {
    const rows = await fetchXmlQuery(`
      <fetch>
        <entity name="report">
          <attribute name="name" />
          <attribute name="filename" />
          <attribute name="description" />
          <filter>
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
          </filter>
        </entity>
      </fetch>
    `);

    return rows.map((row): ReportDefinition => ({
      name: asString(row.name),
      displayName: asString(row.name),
      description: asString(row.description) || undefined,
      fileName: asString(row.filename) || undefined,
    }));
  } catch (error) {
    warnings.push(warningMessage('Reports could not be read', error));
    return [];
  }
}

async function fetchDashboards(solutionId: string, warnings: string[]): Promise<DashboardDefinition[]> {
  try {
    const rows = await fetchXmlQuery(`
      <fetch>
        <entity name="systemform">
          <attribute name="name" />
          <attribute name="description" />
          <attribute name="objecttypecode" />
          <attribute name="type" />
          <filter>
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
            <condition attribute="type" operator="in">
              <value>0</value>
              <value>1</value>
            </condition>
          </filter>
        </entity>
      </fetch>
    `);

    return rows.map((row): DashboardDefinition => ({
      name: asString(row.name),
      displayName: asString(row.name),
      description: asString(row.description) || undefined,
      entityLogicalName: asString(row.objecttypecode) || undefined,
      dashboardType: asString(row.type) || undefined,
      components: [],
    }));
  } catch (error) {
    warnings.push(warningMessage('Dashboards could not be read', error));
    return [];
  }
}

async function fetchPluginAssemblies(solutionId: string, warnings: string[]): Promise<PluginAssemblyDefinition[]> {
  try {
    const assemblyRows = await fetchXmlQuery(`
      <fetch>
        <entity name="pluginassembly">
          <attribute name="pluginassemblyid" />
          <attribute name="name" />
          <attribute name="version" />
          <attribute name="culture" />
          <attribute name="publickeytoken" />
          <attribute name="isolationmode" />
          <attribute name="sourcetype" />
          <filter>
            <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
          </filter>
        </entity>
      </fetch>
    `);

    const assemblies: PluginAssemblyDefinition[] = [];

    for (const assembly of assemblyRows) {
      const assemblyId = asString(assembly.pluginassemblyid);
      const pluginTypeRows = await fetchXmlQuery(`
        <fetch>
          <entity name="plugintype">
            <attribute name="plugintypeid" />
            <attribute name="typename" />
            <filter>
              <condition attribute="pluginassemblyid" operator="eq" value="${escapeXml(assemblyId)}" />
            </filter>
          </entity>
        </fetch>
      `);

      const pluginTypeIds = pluginTypeRows.map((row) => asString(row.plugintypeid)).filter(Boolean);
      const pluginTypeNameById = new Map(pluginTypeRows.map((row) => [asString(row.plugintypeid), asString(row.typename)]));
      let stepRows: Record<string, unknown>[] = [];

      if (pluginTypeIds.length > 0) {
        stepRows = await fetchXmlQuery(`
          <fetch>
            <entity name="sdkmessageprocessingstep">
              <attribute name="name" />
              <attribute name="stage" />
              <attribute name="mode" />
              <attribute name="filteringattributes" />
              <attribute name="description" />
              <attribute name="eventhandler" />
              <link-entity name="sdkmessage" from="sdkmessageid" to="sdkmessageid" alias="message" link-type="outer">
                <attribute name="name" />
              </link-entity>
              <link-entity name="sdkmessagefilter" from="sdkmessagefilterid" to="sdkmessagefilterid" alias="filter" link-type="outer">
                <attribute name="primaryobjecttypecode" />
              </link-entity>
              <filter>
                ${buildInConditions('eventhandler', pluginTypeIds)}
              </filter>
            </entity>
          </fetch>
        `);
      }

      const steps: PluginStepDefinition[] = stepRows.map((row) => ({
        name: asString(row.name),
        message: asString(row['message.name']) || 'Unknown',
        primaryEntity: asString(row['filter.primaryobjecttypecode']) || undefined,
        stage: asNumber(row.stage),
        mode: asNumber(row.mode),
        pluginTypeName: pluginTypeNameById.get(asString(row.eventhandler)) ?? 'Unknown',
        filteringAttributes: asString(row.filteringattributes) || undefined,
        description: asString(row.description) || undefined,
      }));

      assemblies.push({
        name: asString(assembly.name),
        displayName: asString(assembly.name),
        assemblyName: asString(assembly.name),
        version: asString(assembly.version) || undefined,
        culture: asString(assembly.culture) || undefined,
        publicKeyToken: asString(assembly.publickeytoken) || undefined,
        isolationMode: asNumber(assembly.isolationmode),
        sourceType: asString(assembly.sourcetype) || undefined,
        steps,
      });
    }

    return assemblies;
  } catch (error) {
    warnings.push(warningMessage('Plugin assemblies could not be read', error));
    return [];
  }
}

export async function listDataverseSolutions(): Promise<DataverseSolutionSummary[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="solution">
        <attribute name="solutionid" />
        <attribute name="uniquename" />
        <attribute name="friendlyname" />
        <attribute name="description" />
        <attribute name="version" />
        <attribute name="ismanaged" />
        <attribute name="installedon" />
        <link-entity name="publisher" from="publisherid" to="publisherid" alias="publisher" link-type="outer">
          <attribute name="friendlyname" />
        </link-entity>
      </entity>
    </fetch>
  `);

  return rows
    .map((row) => ({
      solutionId: asString(row.solutionid),
      uniqueName: asString(row.uniquename),
      displayName: asString(row.friendlyname) || asString(row.uniquename),
      description: asString(row.description) || undefined,
      publisherName: asString(row['publisher.friendlyname']) || undefined,
      version: asString(row.version),
      isManaged: asBoolean(row.ismanaged),
      installedOn: asString(row.installedon) || undefined,
    }))
    .filter((solution) => !!solution.solutionId)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' }));
}

export function isCustomSolutionCandidate(solution: DataverseSolutionSummary): boolean {
  const name = `${solution.displayName} ${solution.uniqueName}`.toLowerCase();
  return !name.includes('active')
    && !name.includes('default')
    && !name.includes('system');
}

export async function buildParsedSolutionFromDataverse(
  solutionId: string,
  onProgress?: (update: DataverseProgressUpdate) => void,
): Promise<ParsedSolution> {
  const warnings: string[] = [];
  const update = (message: string, percent: number) => onProgress?.({ message, percent });

  update('Reading solution metadata...', 5);
  const metadata = await getSolutionMetadata(solutionId);

  update('Reading Dataverse entities and metadata...', 15);
  const entityLogicalNames = await getEntityLogicalNamesForSolution(solutionId);
  const entities: EntityDefinition[] = [];
  for (let index = 0; index < entityLogicalNames.length; index++) {
    const logicalName = entityLogicalNames[index];
    try {
      entities.push(await buildEntityDefinition(logicalName));
    } catch (error) {
      warnings.push(warningMessage(`Entity metadata for ${logicalName} could not be read`, error));
    }
    const progress = entityLogicalNames.length === 0 ? 25 : 15 + Math.round(((index + 1) / entityLogicalNames.length) * 25);
    update(`Reading table metadata (${index + 1}/${Math.max(entityLogicalNames.length, 1)})...`, progress);
  }

  update('Reading solution components...', 45);
  const [forms, views, processes, customApis, apps, webResources, securityRoles, fieldSecurityProfiles, connectionReferences, environmentVariables, reports, dashboards, pluginAssemblies] = await Promise.all([
    fetchForms(solutionId).catch((error) => {
      warnings.push(warningMessage('Forms could not be read', error));
      return [];
    }),
    fetchViews(solutionId).catch((error) => {
      warnings.push(warningMessage('Views could not be read', error));
      return [];
    }),
    fetchProcesses(solutionId).catch((error) => {
      warnings.push(warningMessage('Processes could not be read', error));
      return [];
    }),
    fetchCustomApis(solutionId, warnings),
    fetchApps(solutionId, warnings),
    fetchWebResources(solutionId).catch((error) => {
      warnings.push(warningMessage('Web resources could not be read', error));
      return [];
    }),
    fetchSecurityRoles(solutionId, warnings),
    fetchFieldSecurityProfiles(solutionId, warnings),
    fetchConnectionReferences(solutionId).catch((error) => {
      warnings.push(warningMessage('Connection references could not be read', error));
      return [];
    }),
    fetchEnvironmentVariables(solutionId, warnings),
    fetchReports(solutionId, warnings),
    fetchDashboards(solutionId, warnings),
    fetchPluginAssemblies(solutionId, warnings),
  ]);

  update('Preparing markdown source model...', 95);
  return {
    metadata,
    entities,
    optionSets: [],
    forms,
    views,
    processes,
    apps,
    webResources,
    securityRoles,
    fieldSecurityProfiles,
    connectionReferences,
    environmentVariables,
    emailTemplates: [],
    reports,
    dashboards,
    pluginAssemblies,
    dataverseInsights: {
      customApis,
      dependencies: [],
    },
    warnings,
  };
}

function collectReferencedEntityLogicalNames(solution: ParsedSolution): Set<string> {
  const names = new Set<string>();

  solution.entities.forEach((entity) => {
    if (entity.logicalName) names.add(entity.logicalName.toLowerCase());
    entity.relationships.forEach((relationship) => {
      if (relationship.referencedEntity) names.add(relationship.referencedEntity.toLowerCase());
      if (relationship.referencingEntity) names.add(relationship.referencingEntity.toLowerCase());
    });
    entity.attributes.forEach((attribute) => {
      if (attribute.lookupTarget) names.add(attribute.lookupTarget.toLowerCase());
    });
  });

  solution.forms.forEach((form) => {
    if (form.entityLogicalName) names.add(form.entityLogicalName.toLowerCase());
  });

  solution.views.forEach((view) => {
    if (view.entityLogicalName) names.add(view.entityLogicalName.toLowerCase());
  });

  solution.processes.forEach((process) => {
    if (process.primaryEntity) names.add(process.primaryEntity.toLowerCase());
    (process.relatedEntities ?? []).forEach((entityName) => {
      if (entityName) names.add(entityName.toLowerCase());
    });
  });

  solution.apps.forEach((app) => {
    (app.entities ?? []).forEach((entityName) => {
      if (entityName) names.add(entityName.toLowerCase());
    });
  });

  solution.reports.forEach((report) => {
    (report.relatedEntities ?? []).forEach((entityName) => {
      if (entityName) names.add(entityName.toLowerCase());
    });
  });

  solution.dashboards.forEach((dashboard) => {
    if (dashboard.entityLogicalName) names.add(dashboard.entityLogicalName.toLowerCase());
  });

  return names;
}

function mapDataverseEntityMetadataRowToEntity(row: Record<string, unknown>): EntityDefinition {
  const logicalName = asString(row.LogicalName);
  return {
    name: logicalName,
    logicalName,
    displayName: getLabel(row.DisplayName, logicalName),
    description: getLabel(row.Description),
    objectTypeCode: row.ObjectTypeCode !== undefined ? asNumber(row.ObjectTypeCode) : undefined,
    isCustom: asBoolean(row.IsCustomEntity, true),
    isActivity: asBoolean(row.IsActivity),
    changeTracking: asBoolean(row.ChangeTrackingEnabled),
    attributes: [],
    relationships: [],
    ownershipType: asString(row.OwnershipType) as EntityDefinition['ownershipType'],
    entitySetName: asString(row.EntitySetName) || undefined,
    primaryAttributeName: asString(row.PrimaryNameAttribute) || undefined,
  };
}

export async function enrichSolutionsWithDataverseMetadata(
  solutions: ParsedSolution[],
  onProgress?: (update: DataverseProgressUpdate) => void,
): Promise<ParsedSolution[]> {
  if (solutions.length === 0) return solutions;

  onProgress?.({ message: 'Reading Dataverse metadata for cross-solution gap filling...', percent: 10 });

  const metadataResponse = await window.dataverseAPI.getAllEntitiesMetadata([...ENTITY_PROPERTIES]);
  const metadataByLogicalName = new Map<string, Record<string, unknown>>(
    metadataResponse.value
      .map((row) => row as Record<string, unknown>)
      .map((row) => [asString(row.LogicalName).toLowerCase(), row]),
  );

  onProgress?.({ message: 'Applying Dataverse metadata gap filling...', percent: 60 });

  const enriched = solutions.map((solution) => {
    const referencedEntityNames = collectReferencedEntityLogicalNames(solution);
    const existingEntityMap = new Map(solution.entities.map((entity) => [entity.logicalName.toLowerCase(), entity]));

    const enrichedEntities = solution.entities.map((entity) => {
      const metadata = metadataByLogicalName.get(entity.logicalName.toLowerCase());
      if (!metadata) return entity;

      const metadataEntity = mapDataverseEntityMetadataRowToEntity(metadata);
      return {
        ...entity,
        displayName: entity.displayName || metadataEntity.displayName,
        description: entity.description || metadataEntity.description,
        objectTypeCode: entity.objectTypeCode ?? metadataEntity.objectTypeCode,
        ownershipType: entity.ownershipType || metadataEntity.ownershipType,
        entitySetName: entity.entitySetName || metadataEntity.entitySetName,
        primaryAttributeName: entity.primaryAttributeName || metadataEntity.primaryAttributeName,
      };
    });

    const appendedEntities: EntityDefinition[] = [];
    referencedEntityNames.forEach((logicalNameLower) => {
      if (existingEntityMap.has(logicalNameLower)) return;
      const metadata = metadataByLogicalName.get(logicalNameLower);
      if (!metadata) return;
      appendedEntities.push({ ...mapDataverseEntityMetadataRowToEntity(metadata), enrichedFromDataverse: true });
    });

    return {
      ...solution,
      entities: [...enrichedEntities, ...appendedEntities],
    };
  });

  onProgress?.({ message: 'Dataverse metadata gap filling completed.', percent: 100 });
  return enriched;
}
