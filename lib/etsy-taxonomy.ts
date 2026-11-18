import taxonomy from './etsy-categories.json';
import type {VisualMetadata} from './bridge-contract';
import type {Bindings} from './api';
import {queryEmbedding,cosine} from './semantic-search';
export {ETSY_TAXONOMY,validEtsyPath} from './etsy-taxonomy-data';
// Product type controls eligibility: a digital PNG depicting a car is not a car,
// a shirt, a knitting pattern or an embroidery machine file for sale.
export const DIGITAL_ART_PATHS=taxonomy.paths.filter(path=>path.endsWith(' > Clip Art & Image Files')||path.endsWith(' > Digital Prints')||path.endsWith(' > Drawing & Illustration > Digital'));
export async function suggestEtsyPaths(env:Bindings,m:VisualMetadata){
 const query=`Product for sale: original downloadable PNG artwork and clip art image file for DTF printing. Not a physical garment or finished transfer. Visual description: ${m.title}. ${m.description}. ${m.styles.join(', ')}.`;
 try{
  const imageVector=await queryEmbedding(env,query);
  const rows=await Promise.all(DIGITAL_ART_PATHS.map(async path=>({path,score:cosine(imageVector,await queryEmbedding(env,'Etsy listing category: '+path)),reason:'Digital artwork category matched to the analysed design.'})));
  return {suggestions:rows.sort((a,b)=>b.score-a.score).map(r=>({...r,score:Math.round(r.score*1000)/1000})),method:'ai-semantic',source:taxonomy.source,checkedAt:taxonomy.retrievedAt};
 }catch{return {suggestions:DIGITAL_ART_PATHS.slice().sort((a,b)=>Number(b.endsWith('Clip Art & Image Files'))-Number(a.endsWith('Clip Art & Image Files'))).map(path=>({path,score:null,reason:'Suggested from the digital PNG product type; AI matching is temporarily unavailable.'})),method:'product-type-fallback',source:taxonomy.source,checkedAt:taxonomy.retrievedAt}}
}
