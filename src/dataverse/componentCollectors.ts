/**
 * @file componentCollectors.ts
 * @description Reads solution-scoped configuration components (global option sets, columns, site maps, image configurations, email templates, and metadata-resolved extended types).
 */

import type {
  EmailTemplateDefinition,
  EntityDefinition,
  OptionSetDefinition,
  DocumentedSolutionComponent,
  UnresolvedSolutionComponent,
} from '../types/solution';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { solutionComponentTypeName } from './componentTypes';
import {
  asArray, asNumber, asOptionalBoolean, asString, buildInConditions, escapeXml,
  fetchXmlQuery, firstNonEmptyString, getLabel, isCollectionCancelledError, isRecord, queryDataverse, queryMetadataCollection,
  readMetadataRecord, referenceId, warningMessage,
} from './dataverseClient';
import { ENTITY_METADATA_CONCURRENCY, buildEntityDefinition, optionLabel } from './entityCollector';
import { toUkEnglish } from '../utils/ukEnglish';

export const DOCUMENTED_COMPONENT_TYPES = new Set([1, 20, 24, 26, 29, 31, 60, 61, 70, 80, 90, 91, 92, 300, 371, 372, 380, 381, 10039]);
export interface ComponentRecordDescriptor {
  logicalName: string;
  idAttribute: string;
  nameAttribute: string;
  typeName: string;
  /** Layer-specific identifiers that solutioncomponent.objectid may reference instead of the primary key. */
  alternateIdAttributes?: string[];
  /** Entity set bound to RetrieveUnpublishedMultiple; set only for tables documented as supporting it. */
  unpublishedEntitySet?: string;
  fields?: Array<{ name: string; label: string }>;
}

export const CONFIGURATION_COMPONENTS: Record<number, ComponentRecordDescriptor> = {
  62: {
    logicalName: 'sitemap', idAttribute: 'sitemapid', nameAttribute: 'sitemapname', typeName: 'Site Map',
    alternateIdAttributes: ['sitemapidunique'], unpublishedEntitySet: 'sitemaps',
    fields: [{ name: 'sitemapname', label: 'Name' }, { name: 'sitemapxml', label: 'Navigation' }],
  },
  431: {
    logicalName: 'attributeimageconfig', idAttribute: 'attributeimageconfigid', nameAttribute: 'attributelogicalname',
    typeName: 'Attribute Image Configuration',
    fields: [
      { name: 'parententitylogicalname', label: 'Parent Table' }, { name: 'attributelogicalname', label: 'Image Column' },
      { name: 'canstorefullimage', label: 'Can Store Full Image' },
    ],
  },
  432: {
    logicalName: 'entityimageconfig', idAttribute: 'entityimageconfigid', nameAttribute: 'parententitylogicalname',
    typeName: 'Entity Image Configuration',
    fields: [{ name: 'parententitylogicalname', label: 'Parent Table' }, { name: 'primaryimageattribute', label: 'Primary Image Column' }],
  },
};

export function siteMapNavigation(xml: string): string {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new Error(`Invalid site map XML: ${validation.err.msg}`);
  const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
  const navigation: string[] = [];
  const visit = (value: unknown, path: string[] = []): void => {
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, path));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, children] of Object.entries(value)) {
      if (!['Area', 'Group', 'SubArea'].includes(key)) {
        if (!key.startsWith('@_')) visit(children, path);
        continue;
      }
      for (const child of Array.isArray(children) ? children : [children]) {
        if (!isRecord(child)) continue;
        const titles = isRecord(child.Titles) ? child.Titles.Title : undefined;
        const title = (Array.isArray(titles) ? titles : [titles]).find(isRecord);
        const label = asString(child['@_Title']) || asString(title?.['@_Title']) || asString(child['@_Id']) || key;
        const nextPath = [...path, label];
        if (key === 'SubArea') {
          const entity = asString(child['@_Entity']);
          navigation.push(`${nextPath.join(' / ')}${entity ? ` (${entity})` : ''}`);
        } else {
          navigation.push(nextPath.join(' / '));
        }
        visit(child, nextPath);
      }
    }
  };
  visit(parser.parse(xml));
  return navigation.join('\n') || 'No navigation entries';
}

export function componentPropertyValue(value: unknown, formatted: unknown): string | undefined {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (isRecord(value)) {
    const id = referenceId(value);
    const name = asString(value.name ?? value.Name);
    return name && id ? `${name} (${id})` : name || id || undefined;
  }
  if (value === null || value === undefined) return undefined;
  const raw = asString(value);
  const label = asString(formatted);
  return label && label !== raw ? `${label} (${raw})` : raw;
}

const UNPUBLISHED_ID_BATCH_SIZE = 20;

/**
 * Reads unpublished (saved but not yet published) rows. Standard queries return published rows
 * only, so app-designer components that were never published appear missing without this.
 */
async function readUnpublishedRecords(
  entitySet: string,
  idFields: string[],
  selectedFields: string[],
  ids: string[],
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += UNPUBLISHED_ID_BATCH_SIZE) {
    const guids = ids.slice(index, index + UNPUBLISHED_ID_BATCH_SIZE).map(referenceId)
      .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id));
    if (guids.length === 0) continue;
    const filter = idFields.flatMap((field) => guids.map((id) => `${field} eq ${id}`)).join(' or ');
    rows.push(...await queryDataverse(`${entitySet}/Microsoft.Dynamics.CRM.RetrieveUnpublishedMultiple()?$select=${selectedFields.join(',')}&$filter=${filter}`));
  }
  return rows;
}

export async function readComponentRecords(
  descriptor: ComponentRecordDescriptor,
  componentType: number,
  ids: string[],
  onError: (id: string, error: unknown) => void,
): Promise<DocumentedSolutionComponent[]> {
  let fields = descriptor.fields;
  let uniqueIdAttributes: string[] = descriptor.alternateIdAttributes ?? [];
  if (!fields) {
    const attributes = (await window.dataverseAPI.getEntityRelatedMetadata(descriptor.logicalName, 'Attributes', [
      'LogicalName', 'DisplayName', 'AttributeType', 'IsSecured', 'IsValidForRead',
    ])).value;
    const safeNames = new Set([
      descriptor.nameAttribute, 'name', 'displayname', 'description', 'uniquename', 'schemaname',
      'parententitylogicalname', 'entitylogicalname', 'entityname', 'attributelogicalname', 'attributename',
      'tablelogicalname', 'componentname', 'settingname', 'appuniquename', 'primaryimageattribute',
    ]);
    const auditLookups = new Set(['createdby', 'modifiedby', 'createdonbehalfby', 'modifiedonbehalfby', 'ownerid', 'owninguser', 'owningteam', 'owningbusinessunit', 'organizationid']);
    fields = attributes.filter((attribute) => (
      asOptionalBoolean(attribute.IsSecured) !== true && asOptionalBoolean(attribute.IsValidForRead) !== false
      && !auditLookups.has(asString(attribute.LogicalName))
      && (safeNames.has(asString(attribute.LogicalName))
        || ['Boolean', 'Picklist', 'State', 'Status', 'Lookup', 'Integer', 'Decimal', 'Double', 'BigInt'].includes(asString(attribute.AttributeType)))
    )).map((attribute) => ({
      name: asString(attribute.LogicalName),
      label: toUkEnglish(getLabel(attribute.DisplayName, asString(attribute.LogicalName))),
    }));
    // App-designer tables (for example appmodule, sitemap) reference solution components by
    // "<primary id>unique"; only that exact, readable column is trusted as an alternate key.
    const layerId = `${descriptor.idAttribute}unique`;
    const hasLayerId = attributes.some((attribute) => asString(attribute.LogicalName) === layerId
      && asString(attribute.AttributeType) === 'Uniqueidentifier'
      && asOptionalBoolean(attribute.IsSecured) !== true && asOptionalBoolean(attribute.IsValidForRead) !== false);
    if (hasLayerId) uniqueIdAttributes = [...new Set([...uniqueIdAttributes, layerId])];
  }
  const idFields = [descriptor.idAttribute, ...uniqueIdAttributes];
  const selectedFields = [...new Set([...idFields, ...fields.map((field) => field.name)])].filter(Boolean);
  const rows = await fetchXmlQuery(`<fetch><entity name="${escapeXml(descriptor.logicalName)}">
    ${selectedFields.map((field) => `<attribute name="${escapeXml(field)}" />`).join('')}
    <filter type="or">${idFields.map((field) => buildInConditions(field, ids)).join('')}</filter>
  </entity></fetch>`);
  const matchesId = (row: Record<string, unknown>, id: string) => idFields.some((field) => referenceId(row[field]) === referenceId(id));
  const unpublishedIds = new Set<string>();
  let unpublishedError: unknown;
  const missing = ids.filter((id) => !rows.some((row) => matchesId(row, id)));
  if (missing.length > 0 && descriptor.unpublishedEntitySet) {
    try {
      const unpublished = await readUnpublishedRecords(descriptor.unpublishedEntitySet, idFields, selectedFields, missing);
      unpublished.forEach((row) => missing.forEach((id) => { if (matchesId(row, id)) unpublishedIds.add(referenceId(id)); }));
      rows.push(...unpublished);
    } catch (error) {
      if (isCollectionCancelledError(error)) throw error;
      unpublishedError = error;
    }
  }
  const lookups = [
    `primary ID (${descriptor.idAttribute})`,
    ...uniqueIdAttributes.map((field) => `solution-layer ID (${field})`),
    ...(descriptor.unpublishedEntitySet ? ['unpublished records'] : []),
  ].join(', ');
  return ids.flatMap((id): DocumentedSolutionComponent[] => {
    try {
      const matches = rows.filter((candidate) => matchesId(candidate, id));
      if (matches.length === 0) {
        const unpublishedNote = unpublishedError ? ` Unpublished records could not be checked: ${warningMessage('error', unpublishedError)}.` : '';
        throw new Error(`${descriptor.typeName} record ${id} is referenced by the solution but was not returned when searched by ${lookups}. The record may have been deleted, or the connection may not have read access to it.${unpublishedNote}`);
      }
      if (new Set(matches.map((row) => referenceId(row[descriptor.idAttribute]))).size > 1) {
        throw new Error(`${descriptor.typeName} identifier ${id} matched multiple records; the component cannot be documented unambiguously.`);
      }
      const row = matches[0];
      const properties = fields.flatMap((field) => {
        const value = field.name === 'sitemapxml' && asString(row[field.name])
          ? siteMapNavigation(asString(row[field.name]))
          : componentPropertyValue(row[`_${field.name}_value`] ?? row[field.name], row[`${field.name}@OData.Community.Display.V1.FormattedValue`]);
        return value === undefined ? [] : [{ name: field.label, value }];
      });
      return [{
        componentType, componentTypeName: descriptor.typeName, objectId: id,
        name: firstNonEmptyString(row, [descriptor.nameAttribute, 'name', 'uniquename', 'schemaname', 'entitylogicalname', 'entityname', 'parententitylogicalname', 'attributelogicalname']) || `${descriptor.typeName} ${id}`,
        entityLogicalName: descriptor.logicalName,
        properties: unpublishedIds.has(referenceId(id))
          ? [...properties, { name: 'Publication State', value: 'Unpublished (latest saved changes have not been published)' }]
          : properties,
      }];
    } catch (error) {
      onError(id, error);
      return [];
    }
  });
}

export async function readEmailTemplateRecords(
  ids: string[],
  onError: (id: string, error: unknown) => void,
): Promise<EmailTemplateDefinition[]> {
  const rows = await fetchXmlQuery(`<fetch><entity name="template">
    <attribute name="templateid" /><attribute name="title" /><attribute name="subject" />
    <attribute name="templatetypecode" /><attribute name="languagecode" />
    <filter>${buildInConditions('templateid', ids)}</filter>
  </entity></fetch>`);
  return ids.flatMap((id): EmailTemplateDefinition[] => {
    try {
      const row = rows.find((candidate) => referenceId(candidate.templateid) === referenceId(id));
      if (!row) throw new Error(`Email Template ${id} was not returned; it may be inaccessible or deleted.`);
      return [{
        name: asString(row.title) || id,
        displayName: asString(row.title) || undefined,
        subject: asString(row.subject) || undefined,
        entityLogicalName: asString(row.templatetypecode) || undefined,
        templateType: 'Email',
        languageCode: row.languagecode == null ? undefined : String(row.languagecode),
      }];
    } catch (error) {
      onError(id, error);
      return [];
    }
  });
}

export async function fetchSolutionComponentDetails(
  solutionId: string,
  entities: EntityDefinition[],
  warnings: string[],
): Promise<{
  optionSets: OptionSetDefinition[];
  emailTemplates: EmailTemplateDefinition[];
  solutionComponents: DocumentedSolutionComponent[];
  unmappedComponents: UnresolvedSolutionComponent[];
  columnEntities: EntityDefinition[];
  selectedColumnIds: Set<string>;
}> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="solutioncomponent">
        <attribute name="objectid" />
        <attribute name="componenttype" />
        <filter>
          <condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" />
        </filter>
      </entity>
    </fetch>
  `);
  const inventory = rows.flatMap((row) => {
    const componentType = asNumber(row.componenttype, -1);
    const objectId = referenceId(row.objectid);
    return componentType >= 0 && objectId && !DOCUMENTED_COMPONENT_TYPES.has(componentType)
      ? [{ componentType, objectId }]
      : [];
  });
  const components = [...new Map(inventory.map((item) => [`${item.componentType}|${item.objectId}`, item])).values()];
  const optionSets: OptionSetDefinition[] = [];
  const emailTemplates: EmailTemplateDefinition[] = [];
  const solutionComponents: DocumentedSolutionComponent[] = [];
  const unmappedComponents: UnresolvedSolutionComponent[] = [];
  const columnEntities: EntityDefinition[] = [];
  const selectedColumnIds = new Set(components.filter((component) => component.componentType === 2).map((component) => component.objectId));
  const columnParents = new Map<string, string>();
  const parentDefinitions = new Map(entities.map((entity) => [entity.logicalName.toLowerCase(), Promise.resolve(entity)]));
  for (const entity of entities) {
    for (const attribute of entity.attributes) {
      if (attribute.metadataId) columnParents.set(referenceId(attribute.metadataId), entity.logicalName);
    }
  }
  const missingColumns = [...selectedColumnIds].filter((id) => !columnParents.has(id));
  let columnLookupError: unknown;
  if (missingColumns.length > 0) {
    try {
      const candidates = await queryMetadataCollection(
        `EntityDefinitions?$select=LogicalName&$expand=Attributes($select=MetadataId,LogicalName;$filter=${encodeURIComponent(missingColumns.map((id) => `MetadataId eq ${id}`).join(' or '))})`,
      );
      for (const candidate of candidates) {
        const logicalName = asString(candidate.LogicalName);
        if (!logicalName) continue;
        for (const attribute of asArray<Record<string, unknown>>(candidate.Attributes)) {
          const id = referenceId(attribute.MetadataId);
          if (selectedColumnIds.has(id)) columnParents.set(id, logicalName);
        }
      }
    } catch (error) {
      columnLookupError = error;
    }
  }
  const descriptors = new Map<number, ComponentRecordDescriptor>(
    Object.entries(CONFIGURATION_COMPONENTS).map(([type, descriptor]) => [Number(type), descriptor]),
  );
  const extendedTypes = [...new Set(components.filter((component) => component.componentType >= 10000).map((component) => component.componentType))];
  if (extendedTypes.length > 0) {
    try {
      const metadata = await queryMetadataCollection(
        `EntityDefinitions?$select=LogicalName,DisplayName,ObjectTypeCode,PrimaryIdAttribute,PrimaryNameAttribute&$filter=${encodeURIComponent(extendedTypes.map((type) => `ObjectTypeCode eq ${type}`).join(' or '))}`,
      );
      for (const entity of metadata) {
        const type = asNumber(entity.ObjectTypeCode, -1);
        if (!extendedTypes.includes(type) || !asString(entity.LogicalName) || !asString(entity.PrimaryIdAttribute)) continue;
        descriptors.set(type, {
          logicalName: asString(entity.LogicalName), idAttribute: asString(entity.PrimaryIdAttribute),
          nameAttribute: asString(entity.PrimaryNameAttribute),
          typeName: toUkEnglish(getLabel(entity.DisplayName, asString(entity.LogicalName))) || asString(entity.LogicalName),
        });
      }
    } catch (error) {
      warnings.push(warningMessage('Extended solution-component type metadata could not be resolved', error));
    }
  }
  const fail = (component: { componentType: number; objectId: string }, error: unknown) => {
    const typeName = descriptors.get(component.componentType)?.typeName ?? solutionComponentTypeName(component.componentType);
    const message = warningMessage(`${typeName} (type ${component.componentType}) ${component.objectId} could not be documented`, error);
    unmappedComponents.push({ ...component, componentTypeName: typeName, error: message });
    warnings.push(message);
  };
  const collectIndividual = async (component: { componentType: number; objectId: string }): Promise<void> => {
    try {
      if (component.componentType === 9) {
        const metadata = await readMetadataRecord(`GlobalOptionSetDefinitions(${encodeURIComponent(component.objectId)})`);
        if (!asString(metadata.Name)) throw new Error('The choice definition has no schema name.');
        if (metadata.MetadataId && referenceId(metadata.MetadataId) !== component.objectId) throw new Error('Dataverse returned a different choice metadata ID.');
        const options = Array.isArray(metadata.Options) ? metadata.Options
          : [metadata.FalseOption, metadata.TrueOption].filter(isRecord);
        if (!Array.isArray(metadata.Options) && (!isRecord(metadata.FalseOption) || !isRecord(metadata.TrueOption))) {
          throw new Error('The complete choice options were not returned.');
        }
        if (options.some((option) => !isRecord(option) || option.Value === null || !Number.isFinite(Number(option.Value)))) {
          throw new Error('Dataverse returned an invalid choice option value.');
        }
        optionSets.push({
          metadataId: referenceId(metadata.MetadataId) || component.objectId,
          name: asString(metadata.Name), displayName: getLabel(metadata.DisplayName, asString(metadata.Name)),
          description: getLabel(metadata.Description) || undefined, isGlobal: true,
          options: options.filter(isRecord).map(optionLabel),
        });
      } else {
        let parent = [...entities, ...columnEntities].find((entity) => entity.attributes.some((attribute) => referenceId(attribute.metadataId) === component.objectId));
        if (!parent) {
          const logicalName = columnParents.get(component.objectId);
          if (!logicalName) throw columnLookupError ?? new Error('The selected column could not be matched to its parent table.');
          let definition = parentDefinitions.get(logicalName.toLowerCase());
          if (!definition) {
            definition = buildEntityDefinition(logicalName);
            parentDefinitions.set(logicalName.toLowerCase(), definition);
          }
          const entity = await definition;
          parent = { ...entity, attributes: entity.attributes.filter((attribute) => referenceId(attribute.metadataId) === component.objectId), relationships: [] };
          if (parent.attributes.length === 0) throw new Error('Dataverse did not return the selected column metadata.');
          columnEntities.push(parent);
        }
        const attribute = parent.attributes.find((item) => referenceId(item.metadataId) === component.objectId);
        if (!attribute) throw new Error('Dataverse did not return the selected column metadata.');
        solutionComponents.push({
          ...component, componentTypeName: 'Column', name: `${parent.logicalName}.${attribute.name}`,
          entityLogicalName: parent.logicalName,
          properties: [
            { name: 'Display Name', value: attribute.displayName || attribute.name },
            { name: 'Data Type', value: attribute.type },
            { name: 'Required', value: attribute.required ? 'Yes' : 'No' },
            ...(attribute.description ? [{ name: 'Description', value: attribute.description }] : []),
          ],
        });
      }
    } catch (error) {
      fail(component, error);
    }
  };
  const individualComponents = components.filter((item) => item.componentType === 9 || item.componentType === 2);
  for (let index = 0; index < individualComponents.length; index += ENTITY_METADATA_CONCURRENCY) {
    await Promise.all(individualComponents.slice(index, index + ENTITY_METADATA_CONCURRENCY).map(collectIndividual));
  }
  for (const type of [...new Set(components.filter((item) => ![2, 9].includes(item.componentType)).map((item) => item.componentType))]) {
    const group = components.filter((item) => item.componentType === type);
    if (type === 36) {
      try {
        emailTemplates.push(...await readEmailTemplateRecords(group.map((item) => item.objectId), (id, error) => fail({ componentType: type, objectId: id }, error)));
      } catch (error) {
        group.forEach((component) => fail(component, error));
      }
      continue;
    }
    const descriptor = descriptors.get(type);
    if (!descriptor) {
      group.forEach((component) => fail(component, new Error('No matching record-table metadata is available in this environment.')));
      continue;
    }
    try {
      solutionComponents.push(...await readComponentRecords(descriptor, type, group.map((item) => item.objectId), (id, error) => fail({ componentType: type, objectId: id }, error)));
    } catch (error) {
      group.forEach((component) => fail(component, error));
    }
  }
  return { optionSets, emailTemplates, solutionComponents, unmappedComponents, columnEntities, selectedColumnIds };
}
