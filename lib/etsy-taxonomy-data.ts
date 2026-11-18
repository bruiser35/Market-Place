import taxonomy from './etsy-categories.json';
export const ETSY_TAXONOMY=taxonomy;
const paths=new Set(taxonomy.paths);
export function validEtsyPath(value:unknown):value is string{return typeof value==='string'&&paths.has(value)}
