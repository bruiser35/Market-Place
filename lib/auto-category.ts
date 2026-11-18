import {readCategories,addCategory} from './categories';
import type {VisualMetadata} from './bridge-contract';
// Use the vision model's explicit subject/category labels, never the file name or title.
export async function autoCategory(db:D1Database,metadata:VisualMetadata){
 const available=await readCategories(db);
 const candidates=[...metadata.secondaryCategories,...(['Everyday Originals','Typography'].includes(metadata.category)?[...metadata.themes,...metadata.subjects]:[])];
 const label=candidates.map(value=>value.trim().replace(/\s+/g,' ')).find(value=>value.length>=2&&value.length<=60&&value.split(' ').length<=6&&/[\p{L}]/u.test(value)&&!/[<>\n\r]/.test(value)&&value.toLowerCase()!=='all artwork'&&value!==metadata.category);
 if(!label)return {category:metadata.category,created:false};
 let category=available.slice(1).find(value=>value.toLowerCase()===label.toLowerCase()),created=false;
 if(!category){
  if(available.length>=51)return {category:metadata.category,created:false};
  try{await addCategory(db,label);category=label;created=true}catch(error){category=(await readCategories(db)).slice(1).find(value=>value.toLowerCase()===label.toLowerCase());if(!category)throw error}
 }
 const previous=metadata.category;metadata.category=category;metadata.secondaryCategories=[...new Set([previous,...metadata.secondaryCategories])].filter(value=>value!==category);
 (metadata as any).suggestedCategories=[category,...metadata.secondaryCategories];
 (metadata as any).automaticCategory={name:category,created,source:'AI visual metadata',assignedAt:new Date().toISOString()};
 return {category,created};
}
