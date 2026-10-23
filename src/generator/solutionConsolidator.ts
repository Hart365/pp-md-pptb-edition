/**
 * @file solutionConsolidator.ts
 * @description Merges several parsed solutions into one "All Selected Solutions" model and
 * fills gaps in individual solutions from their peers (peer gap fill).
 */

import type { AppDefinition, ParsedSolution } from '../types/solution';
import { AppType, ProcessCategory } from '../types/solution';
import { collectMissingDependencies, missingDependenciesNotice } from './missingDependencies';

/** Removes a trailing GUID suffix that Dataverse appends to some exported names. */
export function stripTrailingGuid(text: string | undefined | null): string {
  if (!text) return '';
  return text.replace(/[\s_-]?[0-9a-f]{8}(?:[\s_-]?[0-9a-f]{4}){3}[\s_-]?[0-9a-f]{12}$/i, '').trim();
}

/** True for app types that receive a documented section (model-driven, canvas, custom page, code app, AI plugin). */
export function isDocumentedApp(app: AppDefinition): boolean {
  return [AppType.ModelDriven, AppType.Canvas, AppType.CustomPage, AppType.CodeApp, AppType.AIPlugin].includes(app.appType);
}

/** Returns the distinct non-blank strings, preserving first-seen order. */
export function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(new Set(values.filter((value): value is string => !!value && value.trim().length > 0)));
}

/** Merges items sharing a key using `mergeFn`, preserving first-seen order. */
export function mergeByKey<T>(items: T[], keyFn: (item: T) => string, mergeFn: (current: T, incoming: T) => T): T[] {
  const map = new Map<string, T>();
  items.forEach((item) => {
    const key = keyFn(item);
    const existing = map.get(key);
    map.set(key, existing ? mergeFn(existing, item) : item);
  });
  return Array.from(map.values());
}

/**
 * Merges several parsed solutions into one de-duplicated "All Selected Solutions" model.
 * The collection policy is kept only when all solutions share it; an Environment Appendix is carried through.
 */
export function consolidateSolutions(solutions: ParsedSolution[]): ParsedSolution {
  const items = solutions.filter((solution) => !!solution.metadata.uniqueName);

  const entities = mergeByKey(
    items.flatMap((solution) => solution.entities),
    (entity) => entity.logicalName.toLowerCase(),
    (current, incoming) => ({
      ...current,
      displayName: current.displayName || incoming.displayName,
      description: current.description || incoming.description,
      attributes: mergeByKey([...current.attributes, ...incoming.attributes], (attribute) => attribute.name.toLowerCase(), (first) => first),
      relationships: mergeByKey(
        [...current.relationships, ...incoming.relationships],
        (relationship) => `${relationship.name}|${relationship.type}|${relationship.referencedEntity}|${relationship.referencingEntity}|${relationship.referencingAttribute || ''}`.toLowerCase(),
        (first) => first,
      ),
    }),
  );

  const optionSets = mergeByKey(
    items.flatMap((solution) => solution.optionSets),
    (optionSet) => optionSet.name.toLowerCase(),
    (current, incoming) => ({
      ...current,
      displayName: current.displayName || incoming.displayName,
      options: mergeByKey([...current.options, ...incoming.options], (option) => String(option.value), (first) => first),
    }),
  );

  const forms = mergeByKey(items.flatMap((solution) => solution.forms), (form) => `${form.entityLogicalName}|${form.name}|${form.formType}`.toLowerCase(), (first) => first);
  const views = mergeByKey(items.flatMap((solution) => solution.views), (view) => `${view.entityLogicalName}|${view.name}|${view.viewType}`.toLowerCase(), (first) => first);

  const processes = mergeByKey(
    items.flatMap((solution) => solution.processes),
    (process) => stripTrailingGuid(process.uniqueName || process.displayName || process.name).toLowerCase(),
    (current, incoming) => ({
      ...current,
      displayName: stripTrailingGuid(current.displayName || incoming.displayName || current.name || incoming.name),
      description: current.description || incoming.description,
      category: current.category === ProcessCategory.Workflow ? incoming.category : current.category,
      primaryEntity: current.primaryEntity || incoming.primaryEntity,
      relatedEntities: uniqueStrings([...(current.relatedEntities ?? []), ...(incoming.relatedEntities ?? []), current.primaryEntity, incoming.primaryEntity]),
      triggerAttributes: uniqueStrings([...(current.triggerAttributes ?? []), ...(incoming.triggerAttributes ?? [])]),
      flowConnectors: uniqueStrings([...(current.flowConnectors ?? []), ...(incoming.flowConnectors ?? [])]),
      flowTrigger: current.flowTrigger || incoming.flowTrigger,
      triggerType: current.triggerType || incoming.triggerType,
      steps: current.steps.length >= incoming.steps.length ? current.steps : incoming.steps,
      flowDefinition: current.flowDefinition || incoming.flowDefinition,
      isActivated: current.isActivated ?? incoming.isActivated,
    }),
  );

  const apps = mergeByKey(
    items.flatMap((solution) => solution.apps).filter(isDocumentedApp),
    (app) => `${app.appType}|${stripTrailingGuid(app.uniqueName || app.name || app.displayName)}`.toLowerCase(),
    (current, incoming) => ({
      ...current,
      displayName: stripTrailingGuid(current.displayName || incoming.displayName || current.name || incoming.name),
      entities: uniqueStrings([...(current.entities ?? []), ...(incoming.entities ?? [])]),
      sitemapAreas: uniqueStrings([...(current.sitemapAreas ?? []), ...(incoming.sitemapAreas ?? [])]),
      connectors: uniqueStrings([...(current.connectors ?? []), ...(incoming.connectors ?? [])]),
      isEnabled: current.isEnabled !== false || incoming.isEnabled !== false,
      version: current.version || incoming.version,
    }),
  );

  const webResources = mergeByKey(items.flatMap((solution) => solution.webResources), (item) => (item.schemaName || item.name).toLowerCase(), (first) => first);
  const securityRoles = mergeByKey(items.flatMap((solution) => solution.securityRoles), (role) => role.name.toLowerCase(), (current, incoming) => ({ ...current, privileges: mergeByKey([...current.privileges, ...incoming.privileges], (priv) => `${priv.privilegeName}|${priv.depth}`.toLowerCase(), (first) => first) }));
  const fieldSecurityProfiles = mergeByKey(items.flatMap((solution) => solution.fieldSecurityProfiles), (profile) => profile.name.toLowerCase(), (current, incoming) => ({ ...current, permissions: mergeByKey([...current.permissions, ...incoming.permissions], (perm) => perm.attributeName.toLowerCase(), (first) => first) }));
  const connectionReferences = mergeByKey(items.flatMap((solution) => solution.connectionReferences), (cr) => cr.name.toLowerCase(), (current, incoming) => ({ ...current, displayName: current.displayName || incoming.displayName, connectorDisplayName: current.connectorDisplayName || incoming.connectorDisplayName, connectorId: current.connectorId || incoming.connectorId, connectionId: current.connectionId || incoming.connectionId }));
  const environmentVariables = mergeByKey(items.flatMap((solution) => solution.environmentVariables), (variable) => variable.schemaName.toLowerCase(), (current, incoming) => ({ ...current, displayName: current.displayName || incoming.displayName, description: current.description || incoming.description, defaultValue: current.defaultValue || incoming.defaultValue, hasCurrentValue: current.hasCurrentValue === true || incoming.hasCurrentValue === true ? true : current.hasCurrentValue ?? incoming.hasCurrentValue, currentValueError: current.currentValueError || incoming.currentValueError, currentValue: current.currentValue || incoming.currentValue }));
  const emailTemplates = mergeByKey(items.flatMap((solution) => solution.emailTemplates), (template) => `${template.name}|${template.subject || ''}`.toLowerCase(), (current, incoming) => ({ ...current, displayName: current.displayName || incoming.displayName, description: current.description || incoming.description, subject: current.subject || incoming.subject, entityLogicalName: current.entityLogicalName || incoming.entityLogicalName, templateType: current.templateType || incoming.templateType, languageCode: current.languageCode || incoming.languageCode }));
  const reports = mergeByKey(items.flatMap((solution) => solution.reports), (report) => `${report.fileName || ''}|${report.name}`.toLowerCase(), (current, incoming) => ({ ...current, displayName: current.displayName || incoming.displayName, relatedEntities: uniqueStrings([...(current.relatedEntities ?? []), ...(incoming.relatedEntities ?? [])]), category: current.category || incoming.category }));
  const dashboards = mergeByKey(items.flatMap((solution) => solution.dashboards), (dashboard) => (dashboard.name || dashboard.displayName || '').toLowerCase(), (current, incoming) => ({ ...current, displayName: current.displayName || incoming.displayName, entityLogicalName: current.entityLogicalName || incoming.entityLogicalName, dashboardType: current.dashboardType || incoming.dashboardType, components: uniqueStrings([...(current.components ?? []), ...(incoming.components ?? [])]) }));
  const pluginAssemblies = mergeByKey(items.flatMap((solution) => solution.pluginAssemblies), (assembly) => assembly.assemblyName.toLowerCase(), (current, incoming) => ({ ...current, displayName: current.displayName || incoming.displayName, version: current.version || incoming.version, culture: current.culture || incoming.culture, publicKeyToken: current.publicKeyToken || incoming.publicKeyToken, sourceType: current.sourceType || incoming.sourceType, steps: mergeByKey([...current.steps, ...incoming.steps], (step) => `${step.name}|${step.message}|${step.primaryEntity || ''}|${step.stage}|${step.mode}|${step.pluginTypeName}`.toLowerCase(), (first) => first) }));
  const agents = mergeByKey(items.flatMap((solution) => solution.agents), (agent) => agent.name.toLowerCase(), (first) => first);
  const aiModels = mergeByKey(items.flatMap((solution) => solution.aiModels), (model) => model.name.toLowerCase(), (first) => first);
  const desktopFlows = mergeByKey(items.flatMap((solution) => solution.desktopFlows), (flow) => flow.name.toLowerCase(), (first) => first);
  const dataflows = mergeByKey(items.flatMap((solution) => solution.dataflows), (flow) => flow.name.toLowerCase(), (first) => first);
  const customApis = mergeByKey(items.flatMap((solution) => solution.customApis), (api) => api.name.toLowerCase(), (first) => first);
  const offlineProfiles = mergeByKey(items.flatMap((solution) => solution.offlineProfiles), (profile) => profile.name.toLowerCase(), (first) => first);
  const dataverseCustomApis = mergeByKey(
    items.flatMap((solution) => solution.dataverseInsights?.customApis ?? []),
    (api) => (api.uniqueName || api.name).toLowerCase(),
    (first) => first,
  );
  const dataverseDependencies = mergeByKey(
    items.flatMap((solution) => solution.dataverseInsights?.dependencies ?? []),
    (dependency) => `${dependency.dependentType}|${dependency.dependentName}|${dependency.requiredType}|${dependency.requiredName}`.toLowerCase(),
    (first) => first,
  );

  return {
    metadata: {
      uniqueName: 'all_selected_solutions',
      displayName: 'All Selected Solutions',
      version: new Date().toISOString().slice(0, 10),
      publisherName: 'Multiple Publishers',
      isManaged: false,
    },
    entities,
    missingDependencies: items.every((solution) => solution.missingDependencies !== undefined)
      || items.some((solution) => (solution.missingDependencies?.length ?? 0) > 0)
      ? items.flatMap((solution) => collectMissingDependencies(solution)) : undefined,
    dependencySolutionUniqueNames: items.flatMap((solution) => solution.dependencySolutionUniqueNames ?? [solution.metadata.uniqueName]),
    missingDependenciesError: items.flatMap((solution) => {
      const notice = missingDependenciesNotice(solution);
      return notice ? [`${solution.metadata.uniqueName}: ${notice}`] : [];
    }).join('\n') || undefined,
    optionSets,
    forms,
    views,
    processes,
    apps,
    webResources,
    securityRoles,
    fieldSecurityProfiles,
    connectionReferences,
    environmentVariables,
    emailTemplates,
    reports,
    dashboards,
    pluginAssemblies,
    solutionComponents: mergeByKey(
      items.flatMap((solution) => solution.solutionComponents ?? []),
      (component) => `${component.componentType}|${component.objectId}`.toLowerCase(),
      (current, incoming) => ({
        ...current,
        properties: mergeByKey([...current.properties, ...incoming.properties], (property) => property.name, (first, next) => ({ ...first, value: first.value || next.value })),
      }),
    ),
    unmappedComponents: mergeByKey(
      items.flatMap((solution) => solution.unmappedComponents ?? []),
      (component) => `${component.componentType}|${component.objectId}`.toLowerCase(),
      (first) => first,
    ),
    agents,
    aiModels,
    desktopFlows,
    dataflows,
    customApis,
    offlineProfiles,
    dataverseInsights: (dataverseCustomApis.length > 0 || dataverseDependencies.length > 0)
      ? {
        customApis: dataverseCustomApis,
        dependencies: dataverseDependencies,
      }
      : undefined,
    collectionPolicy: items.length > 0 && items.every((solution) => solution.collectionPolicy === items[0].collectionPolicy)
      ? items[0].collectionPolicy
      : undefined,
    environmentAppendix: items.find((solution) => solution.environmentAppendix)?.environmentAppendix,
    warnings: uniqueStrings(items.flatMap((solution) => solution.warnings)),
  };
}

function mapByKey<T>(items: T[], keyFn: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [keyFn(item), item]));
}

function resolveFromMerged<T>(
  baseItems: T[],
  mergedItems: T[],
  keyFn: (item: T) => string,
): T[] {
  const mergedByKey = mapByKey(mergedItems, keyFn);
  return baseItems.map((item) => mergedByKey.get(keyFn(item)) ?? item);
}

/**
 * Fills missing values in a single solution using matching components from peer
 * solutions, without adding new top-level components that are not already
 * present in the target solution.
 */
export function fillSolutionGapsFromPeerSolutions(
  target: ParsedSolution,
  peers: ParsedSolution[],
  sharedMerged?: ParsedSolution,
): ParsedSolution {
  if (peers.length === 0) return target;

  const merged = sharedMerged ?? consolidateSolutions([target, ...peers]);

  const optionSets = resolveFromMerged(
    target.optionSets,
    merged.optionSets,
    (optionSet) => optionSet.name.toLowerCase(),
  );

  const forms = resolveFromMerged(
    target.forms,
    merged.forms,
    (form) => `${form.entityLogicalName}|${form.name}|${form.formType}`.toLowerCase(),
  );

  const views = resolveFromMerged(
    target.views,
    merged.views,
    (view) => `${view.entityLogicalName}|${view.name}|${view.viewType}`.toLowerCase(),
  );

  const processes = resolveFromMerged(
    target.processes,
    merged.processes,
    (process) => stripTrailingGuid(process.uniqueName || process.displayName || process.name).toLowerCase(),
  );

  const apps = resolveFromMerged(
    target.apps,
    merged.apps,
    (app) => `${app.appType}|${stripTrailingGuid(app.uniqueName || app.name || app.displayName)}`.toLowerCase(),
  );

  const webResources = resolveFromMerged(
    target.webResources,
    merged.webResources,
    (item) => (item.schemaName || item.name).toLowerCase(),
  );

  const securityRoles = resolveFromMerged(
    target.securityRoles,
    merged.securityRoles,
    (role) => role.name.toLowerCase(),
  );

  const fieldSecurityProfiles = resolveFromMerged(
    target.fieldSecurityProfiles,
    merged.fieldSecurityProfiles,
    (profile) => profile.name.toLowerCase(),
  );

  const connectionReferences = resolveFromMerged(
    target.connectionReferences,
    merged.connectionReferences,
    (connectionReference) => connectionReference.name.toLowerCase(),
  );

  const environmentVariables = resolveFromMerged(
    target.environmentVariables,
    merged.environmentVariables,
    (variable) => variable.schemaName.toLowerCase(),
  );

  const emailTemplates = resolveFromMerged(
    target.emailTemplates,
    merged.emailTemplates,
    (template) => `${template.name}|${template.subject || ''}`.toLowerCase(),
  );

  const reports = resolveFromMerged(
    target.reports,
    merged.reports,
    (report) => `${report.fileName || ''}|${report.name}`.toLowerCase(),
  );

  const dashboards = resolveFromMerged(
    target.dashboards,
    merged.dashboards,
    (dashboard) => (dashboard.name || dashboard.displayName || '').toLowerCase(),
  );

  const pluginAssemblies = resolveFromMerged(
    target.pluginAssemblies,
    merged.pluginAssemblies,
    (assembly) => assembly.assemblyName.toLowerCase(),
  );

  return {
    ...target,
    entities: resolveFromMerged(target.entities, merged.entities, (entity) => entity.logicalName.toLowerCase()),
    optionSets,
    forms,
    views,
    processes,
    apps,
    webResources,
    securityRoles,
    fieldSecurityProfiles,
    connectionReferences,
    environmentVariables,
    emailTemplates,
    reports,
    dashboards,
    pluginAssemblies,
    warnings: uniqueStrings([...(target.warnings ?? []), ...(merged.warnings ?? [])]),
    dataverseInsights: target.dataverseInsights ?? merged.dataverseInsights,
  };
}

const PEER_GAP_FILL_FIELDS = [
  'entities',
  'optionSets',
  'forms',
  'views',
  'processes',
  'apps',
  'webResources',
  'securityRoles',
  'fieldSecurityProfiles',
  'connectionReferences',
  'environmentVariables',
  'emailTemplates',
  'reports',
  'dashboards',
  'pluginAssemblies',
] as const;

export function didPeerGapFillAddData(target: ParsedSolution, enriched: ParsedSolution): boolean {
  return PEER_GAP_FILL_FIELDS.some((field) => (
    JSON.stringify(target[field] ?? []) !== JSON.stringify(enriched[field] ?? [])
  )) || JSON.stringify(target.dataverseInsights ?? null) !== JSON.stringify(enriched.dataverseInsights ?? null);
}
