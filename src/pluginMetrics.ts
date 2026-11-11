/** Classify only explicit, namespaced metric keys. Labels and project names are
 * intentionally ignored. Unknown/custom keys require an explicit mapping and
 * remain compatible with either plugin for backwards compatibility. */
export function knownMetricPlugin(metricKey:string):'seo'|'instagram'|null {
 const key=metricKey.toLowerCase();
 if (/^(?:instagram|ig)[_.:-]/.test(key)) return 'instagram';
 if (/^(?:seo|openseo|search_console|google_search_console|gsc)[_.:-]/.test(key)
   || /^ga4[_.:-]organic(?:[_.:-]|$)/.test(key)) return 'seo';
 return null;
}
export function metricAllowedForPlugin(plugin:'seo'|'instagram',metric:{key:string}):boolean {
 const known=knownMetricPlugin(metric.key);
 return known===null||known===plugin;
}
