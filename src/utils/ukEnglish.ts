const spellings: Record<string, string> = {
  organization: 'organisation', organizations: 'organisations', organizational: 'organisational',
  organize: 'organise', organized: 'organised', organizes: 'organises', organizing: 'organising',
  customization: 'customisation', customizations: 'customisations', customizable: 'customisable',
  customize: 'customise', customized: 'customised', customizes: 'customises', customizing: 'customising',
  behavior: 'behaviour', behaviors: 'behaviours', behavioral: 'behavioural',
  color: 'colour', colors: 'colours', colored: 'coloured', coloring: 'colouring',
  localization: 'localisation', localized: 'localised', localize: 'localise', localizing: 'localising',
  analyze: 'analyse', analyzed: 'analysed', analyzes: 'analyses', analyzing: 'analysing',
  optimization: 'optimisation', optimize: 'optimise', optimized: 'optimised', optimizes: 'optimises', optimizing: 'optimising',
  normalization: 'normalisation', normalize: 'normalise', normalized: 'normalised', normalizes: 'normalises', normalizing: 'normalising',
  serialization: 'serialisation', serialize: 'serialise', serialized: 'serialised', serializing: 'serialising',
  initialization: 'initialisation', initialize: 'initialise', initialized: 'initialised', initializes: 'initialises', initializing: 'initialising',
  sanitization: 'sanitisation', sanitize: 'sanitise', sanitized: 'sanitised', sanitizing: 'sanitising',
  synchronization: 'synchronisation', synchronize: 'synchronise', synchronized: 'synchronised',
  prioritization: 'prioritisation', prioritize: 'prioritise', prioritized: 'prioritised',
  summarization: 'summarisation', summarize: 'summarise', summarized: 'summarised',
  authorization: 'authorisation', authorize: 'authorise', authorized: 'authorised',
  center: 'centre', centers: 'centres', datacenter: 'datacentre', datacenters: 'datacentres',
  canceled: 'cancelled', canceling: 'cancelling', catalog: 'catalogue', catalogs: 'catalogues',
  favorite: 'favourite', favorites: 'favourites', license: 'licence', licenses: 'licences',
  artifact: 'artefact', artifacts: 'artefacts', rasterization: 'rasterisation',
  visualization: 'visualisation', visualizations: 'visualisations',
  rasterize: 'rasterise', rasterized: 'rasterised', rasterizes: 'rasterises', rasterizing: 'rasterising',
  utilization: 'utilisation', utilize: 'utilise', utilized: 'utilised', utilizing: 'utilising',
};

/** Localises tool-authored prose and display labels, never schema identifiers or source values. */
export function toUkEnglish(text: string): string {
  return text.replace(/\b[a-z]+\b/gi, (word) => {
    const replacement = spellings[word.toLowerCase()];
    if (!replacement) return word;
    if (word === word.toUpperCase()) return replacement.toUpperCase();
    return /^[A-Z]/.test(word) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
  });
}

/** Turns an API parameter key into a UK English display label without changing the API key. */
export function parameterDisplayLabel(key: string): string {
  const acronyms = new Set(['api', 'id', 'ids', 'url', 'uri', 'ip', 'lcid', 'sql', 'aad', 'crm', 'ui']);
  return toUkEnglish(key.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map((word) => acronyms.has(word.toLowerCase()) ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1))
    .join(' '));
}
