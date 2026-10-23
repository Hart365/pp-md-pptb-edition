/**
 * @file dependencyCollector.ts
 * @description Builds solution runtime dependency edges and reads authoritative installation/import prerequisites (RetrieveMissingDependencies).
 */

import type {
  ParsedSolution,
  DataverseDependencyEdge,
  MissingDependency,
} from '../types/solution';
import { dependencyComponentType } from '../generator/missingDependencies';
import {
  asNumber, asString, escapeXml,
  fetchXmlQuery, queryDataverse, warningMessage,
} from './dataverseClient';

export function collectDataverseDependencyEdgesFromSolution(
  solution: Pick<ParsedSolution, 'entities' | 'forms' | 'views' | 'apps' | 'processes' | 'connectionReferences' | 'environmentVariables' | 'pluginAssemblies'>,
): DataverseDependencyEdge[] {
  const runtimeEdges: DataverseDependencyEdge[] = [];

  solution.forms.forEach((form) => {
    if (form.entityLogicalName) {
      runtimeEdges.push({
        dependentName: form.displayName || form.name,
        dependentType: 'Form',
        requiredName: form.entityLogicalName,
        requiredType: 'Table',
      });
    }
  });

  solution.views.forEach((view) => {
    if (view.entityLogicalName) {
      runtimeEdges.push({
        dependentName: view.displayName || view.name,
        dependentType: 'View',
        requiredName: view.entityLogicalName,
        requiredType: 'Table',
      });
    }
  });

  solution.apps.forEach((app) => {
    const appName = app.displayName || app.name;
    (app.entities ?? []).forEach((entityName) => {
      runtimeEdges.push({
        dependentName: appName,
        dependentType: 'App',
        requiredName: entityName,
        requiredType: 'Table',
      });
    });

    (app.connectors ?? []).forEach((connectorName) => {
      runtimeEdges.push({
        dependentName: appName,
        dependentType: 'App',
        requiredName: connectorName,
        requiredType: 'Connector',
      });
    });
  });

  const connectionRefCandidates = solution.connectionReferences
    .flatMap((reference) => [reference.name, reference.displayName])
    .filter((value): value is string => !!value);
  const envVarCandidates = solution.environmentVariables
    .flatMap((envVar) => [envVar.schemaName, envVar.displayName])
    .filter((value): value is string => !!value);

  solution.processes.forEach((process) => {
    const processName = process.displayName || process.name;
    const relatedTables = [process.primaryEntity, ...(process.relatedEntities ?? [])].filter((value): value is string => !!value);

    relatedTables.forEach((tableName) => {
      runtimeEdges.push({
        dependentName: processName,
        dependentType: 'Process',
        requiredName: tableName,
        requiredType: 'Table',
      });
    });

    const usedRefs = process.flowConnectionReferences?.length
      ? process.flowConnectionReferences
      : [];
    usedRefs.forEach((referenceName) => {
      runtimeEdges.push({
        dependentName: processName,
        dependentType: 'Process',
        requiredName: referenceName,
        requiredType: 'Connection Reference',
      });
    });

    const usedEnvVars = process.flowEnvironmentVariables?.length
      ? process.flowEnvironmentVariables
      : [];
    usedEnvVars.forEach((envVarName) => {
      runtimeEdges.push({
        dependentName: processName,
        dependentType: 'Process',
        requiredName: envVarName,
        requiredType: 'Environment Variable',
      });
    });

    if (process.flowDefinition && (process.flowConnectionReferences?.length ?? 0) === 0) {
      const flowText = JSON.stringify(process.flowDefinition).toLowerCase();
      connectionRefCandidates.filter((candidate) => flowText.includes(candidate.toLowerCase())).forEach((candidate) => {
        runtimeEdges.push({
          dependentName: processName,
          dependentType: 'Process',
          requiredName: candidate,
          requiredType: 'Connection Reference',
        });
      });

      envVarCandidates.filter((candidate) => flowText.includes(candidate.toLowerCase())).forEach((candidate) => {
        runtimeEdges.push({
          dependentName: processName,
          dependentType: 'Process',
          requiredName: candidate,
          requiredType: 'Environment Variable',
        });
      });
    }
  });

  solution.pluginAssemblies.forEach((assembly) => {
    assembly.steps.forEach((step) => {
      if (!step.primaryEntity) return;
      runtimeEdges.push({
        dependentName: `${assembly.assemblyName} :: ${step.name}`,
        dependentType: 'Plugin Step',
        requiredName: step.primaryEntity,
        requiredType: 'Table',
      });
    });
  });

  const solutionTables = new Set(solution.entities.map((entity) => entity.logicalName.toLowerCase()));
  const scopedEdges = runtimeEdges.filter((edge) => (
    edge.requiredType !== 'Table' || solutionTables.has(edge.requiredName.toLowerCase())
  ));

  return Array.from(new Map(
    scopedEdges.map((edge) => [`${edge.dependentType}|${edge.dependentName}|${edge.requiredType}|${edge.requiredName}`.toLowerCase(), edge]),
  ).values());
}

export interface DependencyComponentLabel {
  name: string;
  table?: string;
}

/** Reads only import prerequisites for the named solution, never the environment-wide runtime graph. */
export async function fetchMissingDependencies(solutionUniqueName: string, warnings: string[]): Promise<MissingDependency[]> {
  if (!solutionUniqueName.trim()) throw new Error('A solution unique name is required to retrieve import dependencies.');
  const literal = encodeURIComponent(solutionUniqueName.replace(/'/g, "''"));
  const rows = await queryDataverse(`RetrieveMissingDependencies(SolutionUniqueName='${literal}')`);
  const labels = new Map<string, Promise<DependencyComponentLabel>>();
  const resolve = (type: number, id: string, parentId: string): Promise<DependencyComponentLabel> => {
    const key = `${type}|${id.toLowerCase()}|${parentId.toLowerCase()}`;
    const existing = labels.get(key);
    if (existing) return existing;
    const promise = (async (): Promise<DependencyComponentLabel> => {
      let table: string | undefined;
      try {
        if (type === 1) {
          const metadata = await window.dataverseAPI.getEntityMetadata(id, false, ['LogicalName']);
          if (!metadata.LogicalName) throw new Error('Dataverse did not return the table logical name.');
          return { name: metadata.LogicalName, table: metadata.LogicalName };
        }
        if (type === 2 && parentId && parentId !== '00000000-0000-0000-0000-000000000000') {
          const parent = await resolve(1, parentId, '');
          if (!parent.table) return { name: id };
          table = parent.table;
          const response = await window.dataverseAPI.getEntityRelatedMetadata(parent.table, 'Attributes', ['MetadataId', 'LogicalName']);
          const attribute = response.value.find((item) => asString(item.MetadataId).toLowerCase() === id.toLowerCase());
          if (!attribute?.LogicalName) throw new Error('Dataverse did not return the column logical name.');
          return { name: `${parent.table}.${asString(attribute.LogicalName)}`, table: parent.table };
        }
        const recordTypes: Record<number, { entity: string; id: string; name: string; table?: string }> = {
          20: { entity: 'role', id: 'roleid', name: 'name' },
          24: { entity: 'systemform', id: 'formid', name: 'name', table: 'objecttypecode' },
          26: { entity: 'savedquery', id: 'savedqueryid', name: 'name', table: 'returnedtypecode' },
          29: { entity: 'workflow', id: 'workflowid', name: 'name', table: 'primaryentity' },
          31: { entity: 'report', id: 'reportid', name: 'name' },
          60: { entity: 'systemform', id: 'formid', name: 'name', table: 'objecttypecode' },
          61: { entity: 'webresource', id: 'webresourceid', name: 'name' },
          80: { entity: 'appmodule', id: 'appmoduleid', name: 'uniquename' },
          90: { entity: 'plugintype', id: 'plugintypeid', name: 'typename' },
          91: { entity: 'pluginassembly', id: 'pluginassemblyid', name: 'name' },
          92: { entity: 'sdkmessageprocessingstep', id: 'sdkmessageprocessingstepid', name: 'name' },
          300: { entity: 'canvasapp', id: 'canvasappid', name: 'name' },
          380: { entity: 'environmentvariabledefinition', id: 'environmentvariabledefinitionid', name: 'schemaname' },
          10039: { entity: 'connectionreference', id: 'connectionreferenceid', name: 'connectionreferencelogicalname' },
        };
        const recordType = recordTypes[type];
        if (!recordType) {
          const parent = [3, 10, 14].includes(type) && parentId && parentId !== '00000000-0000-0000-0000-000000000000'
            ? await resolve(1, parentId, '') : undefined;
          return { name: id, table: parent?.table };
        }
        const records = await fetchXmlQuery(`<fetch><entity name="${recordType.entity}">
          <attribute name="${recordType.name}" />
          ${recordType.table ? `<attribute name="${recordType.table}" />` : ''}
          <filter><condition attribute="${recordType.id}" operator="eq" value="${escapeXml(id)}" /></filter>
        </entity></fetch>`);
        const record = records[0];
        if (!record || !asString(record[recordType.name])) throw new Error('Dataverse did not return the component name.');
        return { name: asString(record[recordType.name]), table: recordType.table ? asString(record[recordType.table]) || undefined : undefined };
      } catch (error) {
        warnings.push(warningMessage(`Import dependency label for ${dependencyComponentType(type)} ${id} could not be resolved; the component ID is retained`, error));
        return { name: id, table };
      }
    })();
    labels.set(key, promise);
    return promise;
  };
  const dependencies: MissingDependency[] = [];
  for (const row of rows) {
    const dependentId = asString(row.dependentcomponentobjectid);
    const requiredId = asString(row.requiredcomponentobjectid);
    const dependentType = asNumber(row.dependentcomponenttype, -1);
    const requiredType = asNumber(row.requiredcomponenttype, -1);
    if (!dependentId || !requiredId || dependentType < 0 || requiredType < 0) {
      throw new Error('Dataverse returned an invalid RetrieveMissingDependencies record; import dependency results are incomplete.');
    }
    const dependent = await resolve(dependentType, dependentId, asString(row.dependentcomponentparentid));
    const required = await resolve(requiredType, requiredId, asString(row.requiredcomponentparentid));
    dependencies.push({
      dependentName: dependent.name, dependentType: dependencyComponentType(dependentType), dependentId,
      requiredName: required.name, requiredType: dependencyComponentType(requiredType), requiredId,
      tableLogicalNames: dependent.table ? [dependent.table] : [], solutionUniqueName,
    });
  }
  return dependencies;
}
