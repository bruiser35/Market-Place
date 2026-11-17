import {CATEGORIES} from './catalogue';

export function approvedCategories(value:unknown):string[]{
 if(!Array.isArray(value)||!value.length||value.length>CATEGORIES.length-1||value.some(c=>typeof c!=='string'||!CATEGORIES.slice(1).includes(c)))throw new Error('Choose at least one supported artwork category.');
 return [...new Set(value)] as string[];
}
export function categorySuggestions(metadata:any):string[]{
 return [...new Set([...(metadata?.suggestedCategories||[]),metadata?.category,...(metadata?.secondaryCategories||[])])].filter((c):c is string=>CATEGORIES.slice(1).includes(c));
}
// Only explicitly approved secondary categories affect catalogue browsing.
export const CATEGORY_FILTER="(p.category=? OR EXISTS(SELECT 1 FROM artwork_metadata cm, json_each(cm.metadata_json,'$.approvedCategories') cc WHERE cm.product_id=p.id AND cc.value=?))";
