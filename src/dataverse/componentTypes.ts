/** UK English labels for public component codes. API identifiers are unchanged; extended types use connected metadata. */
export const SOLUTION_COMPONENT_TYPE_NAMES: Record<number, string> = {
  1: 'Entity', 2: 'Attribute', 3: 'Relationship', 4: 'Attribute Picklist Value',
  5: 'Attribute Lookup Value', 6: 'View Attribute', 7: 'Localised Label',
  8: 'Relationship Extra Condition', 9: 'Option Set', 10: 'Entity Relationship',
  11: 'Entity Relationship Role', 12: 'Entity Relationship Relationships', 13: 'Managed Property', 14: 'Entity Key',
  16: 'Privilege', 17: 'PrivilegeObjectTypeCode', 18: 'Index',
  20: 'Role', 21: 'Role Privilege', 22: 'Display String', 23: 'Display String Map',
  24: 'Form', 25: 'Organisation', 26: 'Saved Query', 29: 'Workflow', 31: 'Report',
  32: 'Report Entity', 33: 'Report Category', 34: 'Report Visibility', 35: 'Attachment',
  36: 'Email Template', 37: 'Contract Template', 38: 'KB Article Template', 39: 'Mail Merge Template',
  44: 'Duplicate Rule', 45: 'Duplicate Rule Condition',
  46: 'Entity Map', 47: 'Attribute Map', 48: 'Ribbon Command', 49: 'Ribbon Context Group',
  50: 'Ribbon Customisation', 52: 'Ribbon Rule', 53: 'Ribbon Tab To Command Map', 55: 'Ribbon Diff',
  59: 'Saved Query Visualisation', 60: 'System Form', 61: 'Web Resource', 62: 'Site Map',
  63: 'Connection Role', 64: 'Complex Control', 65: 'Hierarchy Rule',
  66: 'Custom Control', 68: 'Custom Control Default Config',
  70: 'Field Security Profile', 71: 'Field Permission', 80: 'App Module',
  90: 'Plugin Type', 91: 'Plugin Assembly', 92: 'SDK Message Processing Step', 93: 'SDK Message Processing Step Image',
  95: 'Service Endpoint', 150: 'Routing Rule', 151: 'Routing Rule Item',
  152: 'SLA', 153: 'SLA Item', 154: 'Convert Rule', 155: 'Convert Rule Item',
  161: 'Mobile Offline Profile', 162: 'Mobile Offline Profile Item', 300: 'Canvas App',
  371: 'Connector', 372: 'Connector', 380: 'Environment Variable Definition', 381: 'Environment Variable Value',
  430: 'Entity Analytics Configuration', 431: 'Attribute Image Configuration', 432: 'Entity Image Configuration',
  10039: 'Connection Reference',
};

export function solutionComponentTypeName(type: number): string {
  return SOLUTION_COMPONENT_TYPE_NAMES[type] ?? `Component ${type}`;
}
