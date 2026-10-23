/**
 * @file solutionService.ts
 * @description Read-only Dataverse solution access for connected-mode documentation generation.
 */

import type {
  AgentDefinition,
  AIModelDefinition,
  AppDefinition,
  CustomAPIDefinition,
  DashboardDefinition,
  DataflowDefinition,
  DesktopFlowDefinition,
  EntityDefinition,
  EnvironmentVariableDefinition,
  FieldSecurityProfileDefinition,
  FormDefinition,
  OfflineProfileDefinition,
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
  SolutionCollectionPolicy,
} from '../types/solution';
import {
  AppType,
  ProcessCategory,
  WebResourceType,
} from '../types/solution';
import {
  asBoolean, asNumber, asString, buildInConditions, escapeXml,
  fetchXmlQuery, fetchXmlQueryForIds, firstNonEmptyString, isCollectionCancelledError, queryDataverse, queryDataverseWithFallback, referenceId,
  solutionComponentLink, throwIfDataverseCollectionCancelled, warningMessage,
} from './dataverseClient';
import { fetchSolutionComponentDetails } from './componentCollectors';
import { ENTITY_METADATA_CONCURRENCY, buildEntityDefinition, getEntityLogicalNamesForSolution } from './entityCollector';
import { collectDataverseDependencyEdgesFromSolution, fetchMissingDependencies } from './dependencyCollector';

// Re-exported so existing imports of the orchestrator module remain stable after the module split.
export { asOptionalBoolean, DataverseCollectionCancelledError, isCollectionCancelledError, withDataverseAbortSignal } from './dataverseClient';
export { normalizeOwnershipType, buildEntityDefinition } from './entityCollector';
export { fetchSolutionComponentDetails } from './componentCollectors';
export { collectDataverseDependencyEdgesFromSolution, fetchMissingDependencies } from './dependencyCollector';

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
async function fetchForms(solutionId: string): Promise<FormDefinition[]> {
  const rows = await fetchXmlQuery(`
    <fetch>
      <entity name="systemform">
        <attribute name="name" />
        <attribute name="description" />
        <attribute name="objecttypecode" />
        <attribute name="type" />
        <attribute name="formxml" />
        ${solutionComponentLink(solutionId, 'formid', [24, 60])}
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
        ${solutionComponentLink(solutionId, 'savedqueryid', [26])}
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
              <value>80</value>
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

      if (componentType === 80) {
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
  const componentRows = await fetchXmlQuery(`
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
        <attribute name="clientdata" />
        ${solutionComponentLink(solutionId, 'workflowid', [29])}
      </entity>
    </fetch>
  `);
  // Legacy actions can be solution-owned records without a workflow component.
  const solutionRows = await fetchXmlQuery(`
    <fetch>
      <entity name="workflow">
        <attribute name="workflowid" /><attribute name="name" /><attribute name="description" />
        <attribute name="uniquename" /><attribute name="category" /><attribute name="primaryentity" />
        <attribute name="statecode" /><attribute name="scope" /><attribute name="ondemand" />
        <attribute name="triggeroncreate" /><attribute name="triggerondelete" />
        <attribute name="triggeronupdateattributelist" /><attribute name="clientdata" />
        <filter><condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" /></filter>
      </entity>
    </fetch>
  `);
  const rows = Array.from(new Map(
    [...componentRows, ...solutionRows].map((row) => [asString(row.workflowid) || asString(row.uniquename), row]),
  ).values());

  return rows.map((row): ProcessDefinition => {
    const triggerAttributes = asString(row.triggeronupdateattributelist)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);

    const clientData = asString(row.clientdata);
    let flowDefinition: object | undefined;
    try {
      flowDefinition = clientData ? JSON.parse(clientData) as object : undefined;
    } catch {
      // Client data is optional and varies by workflow category.
    }

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
      flowDefinition,
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
      ? buildInConditions('appmoduleidunique', componentIds.modelDrivenIds)
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
              <attribute name="appmoduleidunique" />
              <attribute name="componenttype" />
              <attribute name="objectid" />
              <filter type="and">
                ${buildInConditions('appmoduleidunique', appModuleIds)}
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
            const appModuleId = asString(row.appmoduleidunique);
            const logicalName = metadataIdToLogicalName.get(asString(row.objectid));
            if (!appModuleId || !logicalName) return;

            if (!appEntityMap.has(appModuleId)) {
              appEntityMap.set(appModuleId, new Set<string>());
            }
            appEntityMap.get(appModuleId)!.add(logicalName);
          });
        }
      } catch {
        // Some Dataverse hosts do not expose the app-component intersection.
        // Preserve the app inventory without emitting a non-actionable warning.
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
        ${solutionComponentLink(solutionId, 'webresourceid', [61])}
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
          ${solutionComponentLink(solutionId, 'roleid', [20])}
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
      const roleFilters = roleIds.map((roleId) => `roleid eq ${roleId}`).join(' or ');
      const rolePrivilegeRows = await queryDataverse(
        `roleprivilegescollection?$select=roleid,privilegeid,privilegedepthmask&$filter=${encodeURIComponent(roleFilters)}`,
      );

      const privilegeIds = Array.from(new Set(
        rolePrivilegeRows.map((row) => asString(row.privilegeid)).filter(Boolean),
      ));

      let privilegeNameById = new Map<string, string>();
      if (privilegeIds.length > 0) {
        const privilegeFilters = privilegeIds.map((privilegeId) => `privilegeid eq ${privilegeId}`).join(' or ');
        const privilegeRows = await queryDataverse(
          `privileges?$select=privilegeid,name&$filter=${encodeURIComponent(privilegeFilters)}`,
        );

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
    } catch {
      // Role privilege intersections are not exposed as FetchXML entities by
      // every host. Keep the role inventory when detailed privileges cannot load.
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
          ${solutionComponentLink(solutionId, 'fieldsecurityprofileid', [70])}
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
  const columns = 'connectionreferenceid,connectionreferencelogicalname,connectionreferencedisplayname,connectionid,connectorid';
  const solutionRows = await queryDataverse(
    `connectionreferences?$select=${columns}&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
  ).catch(() => fetchXmlQuery(`
      <fetch><entity name="connectionreference">
        <attribute name="connectionreferenceid" /><attribute name="connectionreferencelogicalname" />
        <attribute name="connectionreferencedisplayname" /><attribute name="connectionid" /><attribute name="connectorid" />
        <filter><condition attribute="solutionid" operator="eq" value="${escapeXml(solutionId)}" /></filter>
      </entity></fetch>
    `));
  let componentRows: Record<string, unknown>[] = [];
  try {
    componentRows = await fetchXmlQuery(`
      <fetch>
        <entity name="connectionreference">
          <attribute name="connectionreferenceid" />
          <attribute name="connectionreferencelogicalname" />
          <attribute name="connectionreferencedisplayname" />
          <attribute name="connectionid" />
          <attribute name="connectorid" />
          ${solutionComponentLink(solutionId, 'connectionreferenceid', [371, 372])}
        </entity>
      </fetch>
    `);
  } catch {
    // The solution-owned query is the documented fallback for this component.
  }
  const rows = Array.from(new Map(
    [...solutionRows, ...componentRows].map((row) => [asString(row.connectionreferenceid), row]),
  ).values());

  return rows.map((row): ConnectionReferenceDefinition => ({
    name: firstNonEmptyString(row, ['connectionreferencedisplayname', 'connectionreferencelogicalname']) || asString(row.connectionreferenceid),
    displayName: firstNonEmptyString(row, ['connectionreferencedisplayname']) || undefined,
    connectorId: asString(row.connectorid),
    connectionId: asString(row.connectionid) || undefined,
  }));
}

export async function fetchEnvironmentVariables(solutionId: string, warnings: string[]): Promise<EnvironmentVariableDefinition[]> {
  let definitions: Record<string, unknown>[];
  try {
    definitions = await fetchXmlQuery(`
      <fetch>
        <entity name="environmentvariabledefinition">
          <attribute name="environmentvariabledefinitionid" />
          <attribute name="displayname" />
          <attribute name="description" />
          <attribute name="schemaname" />
          <attribute name="type" />
          <attribute name="defaultvalue" />
          ${solutionComponentLink(solutionId, 'environmentvariabledefinitionid', [380])}
        </entity>
      </fetch>
    `);
  } catch (error) {
    warnings.push(warningMessage('Environment variable definitions could not be read', error));
    return [];
  }

  const definitionIds = definitions.map((row) => referenceId(row.environmentvariabledefinitionid)).filter(Boolean);
  const definitionsWithValues = new Set<string>();
  let currentValueError: string | undefined;

  if (definitionIds.length > 0) {
    try {
      const valueRows = await fetchXmlQuery(`
        <fetch>
          <entity name="environmentvariablevalue">
            <attribute name="environmentvariablevalueid" />
            <attribute name="environmentvariabledefinitionid" />
            <filter type="and">
              ${buildInConditions('environmentvariabledefinitionid', definitionIds)}
              <condition attribute="value" operator="not-null" />
            </filter>
          </entity>
        </fetch>
      `);
      for (const row of valueRows) {
        const definitionId = referenceId(row._environmentvariabledefinitionid_value ?? row.environmentvariabledefinitionid);
        if (!definitionId) throw new Error('A current-value record was returned without its definition lookup.');
        definitionsWithValues.add(definitionId);
      }
    } catch (error) {
      currentValueError = warningMessage('Environment variable current-value presence could not be checked', error);
      warnings.push(currentValueError);
    }
  }

  return definitions.map((row): EnvironmentVariableDefinition => {
    const id = referenceId(row.environmentvariabledefinitionid);
    if (!id) warnings.push('Environment variable current-value presence is unknown because its definition ID was not returned.');
    const variableTypes: Record<number, string> = {
      100000000: 'String', 100000001: 'Number', 100000002: 'Boolean',
      100000003: 'JSON', 100000004: 'Data Source', 100000005: 'Secret',
    };
    return {
      name: asString(row.displayname) || asString(row.schemaname),
      displayName: asString(row.displayname) || undefined,
      description: asString(row.description) || undefined,
      type: variableTypes[asNumber(row.type, -1)] ?? (asString(row.type) || 'Unknown'),
      defaultValue: asString(row.defaultvalue) || undefined,
      hasCurrentValue: definitionsWithValues.has(id) ? true : currentValueError || !id ? undefined : false,
      currentValueError: currentValueError ?? (!id ? 'The environment variable definition ID was not returned.' : undefined),
      // Connected documentation reports presence only; never render a live value.
      currentValue: undefined,
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
          ${solutionComponentLink(solutionId, 'reportid', [31])}
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
          ${solutionComponentLink(solutionId, 'formid', [60])}
          <filter>
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

/**
 * Reads plug-in assemblies in the solution with their types and steps using three set-based queries
 * (assemblies, plug-in types, steps) rather than per-assembly round trips.
 */
export async function fetchPluginAssemblies(solutionId: string, warnings: string[]): Promise<PluginAssemblyDefinition[]> {
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
          ${solutionComponentLink(solutionId, 'pluginassemblyid', [91])}
        </entity>
      </fetch>
    `);

    // Read plug-in types and steps for every assembly in set-based batches instead of per assembly.
    const assemblyIds = assemblyRows.map((assembly) => asString(assembly.pluginassemblyid)).filter(Boolean);
    const pluginTypeRows = await fetchXmlQueryForIds(assemblyIds, (inCondition) => `
      <fetch>
        <entity name="plugintype">
          <attribute name="plugintypeid" />
          <attribute name="typename" />
          <attribute name="pluginassemblyid" />
          <filter>${inCondition}</filter>
        </entity>
      </fetch>
    `, 'pluginassemblyid');

    const pluginTypeNameById = new Map(pluginTypeRows.map((row) => [referenceId(row.plugintypeid), asString(row.typename)]));
    const assemblyIdByPluginTypeId = new Map(pluginTypeRows.map((row) => [
      referenceId(row.plugintypeid),
      referenceId(row._pluginassemblyid_value ?? row.pluginassemblyid),
    ]));
    const stepRows = await fetchXmlQueryForIds([...pluginTypeNameById.keys()], (inCondition) => `
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
          <filter>${inCondition}</filter>
        </entity>
      </fetch>
    `, 'eventhandler');

    const stepsByAssemblyId = new Map<string, PluginStepDefinition[]>();
    for (const row of stepRows) {
      const pluginTypeId = referenceId(row._eventhandler_value ?? row.eventhandler);
      const assemblyId = assemblyIdByPluginTypeId.get(pluginTypeId);
      if (!assemblyId) continue;
      const steps = stepsByAssemblyId.get(assemblyId) ?? [];
      steps.push({
        name: asString(row.name),
        message: asString(row['message.name']) || 'Unknown',
        primaryEntity: asString(row['filter.primaryobjecttypecode']) || undefined,
        stage: asNumber(row.stage),
        mode: asNumber(row.mode),
        pluginTypeName: pluginTypeNameById.get(pluginTypeId) ?? 'Unknown',
        filteringAttributes: asString(row.filteringattributes) || undefined,
        description: asString(row.description) || undefined,
      });
      stepsByAssemblyId.set(assemblyId, steps);
    }

    const assemblies: PluginAssemblyDefinition[] = assemblyRows.map((assembly) => ({
      name: asString(assembly.name),
      displayName: asString(assembly.name),
      assemblyName: asString(assembly.name),
      version: asString(assembly.version) || undefined,
      culture: asString(assembly.culture) || undefined,
      publicKeyToken: asString(assembly.publickeytoken) || undefined,
      isolationMode: asNumber(assembly.isolationmode),
      sourceType: asString(assembly.sourcetype) || undefined,
      steps: stepsByAssemblyId.get(referenceId(assembly.pluginassemblyid)) ?? [],
    }));

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

export async function fetchModernDataverseArtifacts(
  solutionId: string,
  warnings: string[] = [],
): Promise<{
  agents: AgentDefinition[];
  aiModels: AIModelDefinition[];
  desktopFlows: DesktopFlowDefinition[];
  dataflows: DataflowDefinition[];
  customApis: CustomAPIDefinition[];
  offlineProfiles: OfflineProfileDefinition[];
}> {
  const [agents, aiModels, desktopFlows, dataflows, customApiRows, offlineProfiles] = await Promise.all([
    queryDataverseWithFallback([
      `botcomponents?$select=botcomponentid,name,description,botcomponenttype,language&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
      `botcomponents?$select=botcomponentid,name,description,language&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
    ], 'Copilot Studio agents could not be read', warnings, false).then((rows) => rows.map((row) => ({
      name: asString(row.name) || asString(row.displayname) || asString(row.botcomponentid),
      displayName: asString(row.displayname) || asString(row.name) || asString(row.botcomponentid),
      description: asString(row.description) || undefined,
      sourcePath: asString(row.botcomponentid) || 'botcomponent',
      agentType: asString(row.botcomponenttype) || undefined,
      language: asString(row.language) || undefined,
    } satisfies AgentDefinition))),
    queryDataverseWithFallback([
      `aimodels?$select=aimodelid,name,description,provider,version&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
      `aimodeldefinitions?$select=aimodeldefinitionid,name,description,provider,version&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
    ], 'AI model artefacts could not be read', warnings, false).then((rows) => rows.map((row) => ({
      name: asString(row.name) || asString(row.displayname) || asString(row.aimodelid),
      displayName: asString(row.displayname) || asString(row.name) || asString(row.aimodelid),
      description: asString(row.description) || undefined,
      sourcePath: asString(row.aimodelid) || asString(row.aimodeldefinitionid) || 'aimodel',
      provider: asString(row.provider) || undefined,
      version: asString(row.version) || undefined,
    } satisfies AIModelDefinition))),
    queryDataverseWithFallback([
      `desktopflows?$select=desktopflowid,name,description,isenabled,stepcount&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
      `uiflows?$select=uiflowid,name,description,isenabled,stepcount&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
    ], 'Desktop flow artefacts could not be read', warnings, false).then((rows) => rows.map((row) => ({
      name: asString(row.name) || asString(row.displayname) || asString(row.desktopflowid) || asString(row.uiflowid),
      displayName: asString(row.displayname) || asString(row.name) || asString(row.desktopflowid) || asString(row.uiflowid),
      description: asString(row.description) || undefined,
      sourcePath: asString(row.desktopflowid) || asString(row.uiflowid) || 'desktopflow',
      isEnabled: asBoolean(row.isenabled),
      stepCount: asNumber(row.stepcount),
    } satisfies DesktopFlowDefinition))),
    queryDataverseWithFallback([
      `dataflows?$select=dataflowid,name,description,refreshmode&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
      `dataflowdefinitions?$select=dataflowdefinitionid,name,description,refreshmode&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
    ], 'Dataflow artefacts could not be read', warnings, false).then((rows) => rows.map((row) => ({
      name: asString(row.name) || asString(row.displayname) || asString(row.dataflowid) || asString(row.dataflowdefinitionid),
      displayName: asString(row.displayname) || asString(row.name) || asString(row.dataflowid) || asString(row.dataflowdefinitionid),
      description: asString(row.description) || undefined,
      sourcePath: asString(row.dataflowid) || asString(row.dataflowdefinitionid) || 'dataflow',
      refreshMode: asString(row.refreshmode) || undefined,
    } satisfies DataflowDefinition))),
    fetchCustomApis(solutionId, warnings).then((rows) => rows.map((row) => ({
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      sourcePath: row.uniqueName || row.name,
      boundEntityLogicalName: undefined,
      isFunction: row.isFunction,
    } satisfies CustomAPIDefinition))),
    queryDataverseWithFallback([
      `mobileofflineprofiles?$select=mobileofflineprofileid,name,description,profiletype&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
      `offlineprofiles?$select=offlineprofileid,name,description,profiletype&$filter=${encodeURIComponent(`_solutionid_value eq ${solutionId}`)}`,
    ], 'Offline profile artefacts could not be read', warnings, false).then((rows) => rows.map((row) => ({
      name: asString(row.name) || asString(row.displayname) || asString(row.mobileofflineprofileid) || asString(row.offlineprofileid),
      displayName: asString(row.displayname) || asString(row.name) || asString(row.mobileofflineprofileid) || asString(row.offlineprofileid),
      description: asString(row.description) || undefined,
      sourcePath: asString(row.mobileofflineprofileid) || asString(row.offlineprofileid) || 'offlineprofile',
      profileType: asString(row.profiletype) || undefined,
    } satisfies OfflineProfileDefinition))),
  ]);

  return { agents, aiModels, desktopFlows, dataflows, customApis: customApiRows, offlineProfiles };
}

export async function buildParsedSolutionFromDataverse(
  solutionId: string,
  onProgress?: (update: DataverseProgressUpdate) => void,
  collectionPolicy: SolutionCollectionPolicy = 'solutionOnly',
): Promise<ParsedSolution> {
  const warnings: string[] = [];
  const update = (message: string, percent: number) => onProgress?.({ message, percent });

  // Collection policy is informational, not a parse issue — it is carried on
  // `collectionPolicy` and rendered as a header note by the Markdown generator
  // instead of being pushed into `warnings` (which renders under "Parse Warnings").

  update('Reading solution metadata...', 5);
  const metadata = await getSolutionMetadata(solutionId);

  update('Reading Dataverse entities and metadata...', 15);
  const entityLogicalNames = await getEntityLogicalNamesForSolution(solutionId);
  const entityResults: Array<EntityDefinition | undefined> = Array.from({ length: entityLogicalNames.length });
  let completedEntities = 0;
  let nextEntityIndex = 0;
  const entityWorkers = Array.from(
    { length: Math.min(ENTITY_METADATA_CONCURRENCY, entityLogicalNames.length) },
    async () => {
      while (nextEntityIndex < entityLogicalNames.length) {
        const index = nextEntityIndex++;
        const logicalName = entityLogicalNames[index];
        try {
          entityResults[index] = await buildEntityDefinition(logicalName);
        } catch (error) {
          if (isCollectionCancelledError(error)) throw error;
          warnings.push(warningMessage(`Entity metadata for ${logicalName} could not be read`, error));
        } finally {
          completedEntities += 1;
          const progress = 15 + Math.round((completedEntities / Math.max(entityLogicalNames.length, 1)) * 25);
          update(`Reading table metadata (${completedEntities}/${Math.max(entityLogicalNames.length, 1)})...`, progress);
        }
      }
    },
  );
  await Promise.all(entityWorkers);
  throwIfDataverseCollectionCancelled();
  const entities = entityResults.filter((entity): entity is EntityDefinition => entity !== undefined);

  update('Reading solution components...', 45);
  const [forms, views, processes, customApis, apps, webResources, securityRoles, fieldSecurityProfiles, connectionReferences, environmentVariables, reports, dashboards, pluginAssemblies, modernArtifacts, additionalComponents] = await Promise.all([
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
    fetchModernDataverseArtifacts(solutionId, warnings),
    fetchSolutionComponentDetails(solutionId, entities, warnings).catch((error) => {
      warnings.push(warningMessage('Additional solution component inventory could not be read', error));
      return { optionSets: [], emailTemplates: [], solutionComponents: [], unmappedComponents: [], columnEntities: [], selectedColumnIds: new Set<string>() };
    }),
  ]);
  // Collectors convert failures into warnings, so surface cancellation explicitly here.
  throwIfDataverseCollectionCancelled();

  // Prevent platform entities, such as systemuser, from expanding into the
  // environment-wide graph when they are included as relationship context.
  const entitiesByName = new Map(entities.map((entity) => [entity.logicalName.toLowerCase(), entity]));
  for (const columnEntity of additionalComponents.columnEntities) {
    const existing = entitiesByName.get(columnEntity.logicalName.toLowerCase());
    entitiesByName.set(columnEntity.logicalName.toLowerCase(), existing ? {
      ...existing,
      attributes: [...new Map([...existing.attributes, ...columnEntity.attributes].map((attribute) => [attribute.name, attribute])).values()],
    } : columnEntity);
  }
  const selectedEntityNames = new Set(entitiesByName.keys());
  const scopedEntities = [...entitiesByName.values()].map((entity) => ({
    ...entity,
    attributes: entity.isCustom ? entity.attributes : entity.attributes.filter((attribute) => additionalComponents.selectedColumnIds.has(referenceId(attribute.metadataId))),
    relationships: entity.relationships.filter((relationship) =>
      selectedEntityNames.has(relationship.referencedEntity.toLowerCase())
      && selectedEntityNames.has(relationship.referencingEntity.toLowerCase())),
  }));

  const dataverseDependencies = collectDataverseDependencyEdgesFromSolution({
    entities: scopedEntities,
    forms,
    views,
    apps,
    processes,
    connectionReferences,
    environmentVariables,
    pluginAssemblies,
  });

  update('Preparing markdown source model...', 95);
  const parsed: ParsedSolution = {
    collectionPolicy,
    unmappedComponents: additionalComponents.unmappedComponents,
    solutionComponents: additionalComponents.solutionComponents,
    metadata,
    entities: scopedEntities,
    optionSets: additionalComponents.optionSets,
    forms,
    views,
    processes,
    apps,
    webResources,
    securityRoles,
    fieldSecurityProfiles,
    connectionReferences,
    environmentVariables,
    emailTemplates: additionalComponents.emailTemplates,
    reports,
    dashboards,
    pluginAssemblies,
    agents: modernArtifacts.agents,
    aiModels: modernArtifacts.aiModels,
    desktopFlows: modernArtifacts.desktopFlows,
    dataflows: modernArtifacts.dataflows,
    customApis: modernArtifacts.customApis,
    offlineProfiles: modernArtifacts.offlineProfiles,
    dataverseInsights: customApis.length > 0 || dataverseDependencies.length > 0 ? {
      customApis,
      dependencies: dataverseDependencies,
    } : undefined,
    warnings,
  };
  try {
    update('Reading solution installation/import prerequisites...', 97);
    parsed.missingDependencies = await fetchMissingDependencies(metadata.uniqueName, warnings);
  } catch (error) {
    if (isCollectionCancelledError(error)) throw error;
    parsed.missingDependenciesError = warningMessage(`Installation/import dependencies for solution ${metadata.uniqueName || solutionId} could not be retrieved`, error);
    warnings.push(parsed.missingDependenciesError);
  }
  throwIfDataverseCollectionCancelled();
  return parsed;
}
