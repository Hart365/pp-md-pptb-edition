import type { ParsedSolution } from '../types/solution';
import { heading, mdEscape } from './markdownFormatting';

/** Returns a separate report, or nothing when no collection diagnostics exist. */
export function generateDiagnosticsMarkdown(solution: ParsedSolution): string {
  const sections: string[] = [];
  const add = (title: string, messages: string[]) => {
    if (messages.length > 0) {
      sections.push([heading(2, title), '', ...[...new Set(messages)].map((message) => `- ${mdEscape(message)}`), ''].join('\n'));
    }
  };
  add('Parse Warnings', solution.warnings);
  add('Component Collection Issues', (solution.unmappedComponents ?? []).map((component) =>
    `${component.componentTypeName || 'Unknown'} (${component.componentType}), ${component.objectId}: ${component.error || 'No detailed collector is available'}`));
  add('Environment Variable Collection Issues', solution.environmentVariables
    .filter((variable) => variable.currentValueError)
    .map((variable) => `${variable.schemaName || variable.name}: ${variable.currentValueError}`));
  add('Dependency Collection Issues', solution.missingDependenciesError ? [solution.missingDependenciesError] : []);
  const appendix = solution.environmentAppendix;
  if (appendix) {
    add('Environment Collection Issues', [
      ...appendix.warnings,
      ...(appendix.powerPlatformStatus ? [appendix.powerPlatformStatus] : []),
      ...appendix.counts.flatMap((count) => [count.note, count.custom?.note]
        .filter((note): note is string => Boolean(note))
        .map((note) => `${count.category} / ${count.label}: ${note}`)),
    ]);
  }
  if (sections.length === 0) return '';
  return [
    heading(1, `${solution.metadata.displayName || solution.metadata.uniqueName}: Diagnostics`),
    '',
    '_Parse warnings, collection errors, and issues are kept here, outside the solution documentation._',
    '',
    ...sections,
  ].join('\n');
}
