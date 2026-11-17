import {categorySuggestions} from './category-approval';
import {validEtsyPath} from './etsy-taxonomy-data';
type Api=(path:string,options:RequestInit)=>Promise<any>;
export async function approveDraftBatch(items:any[],categories:string[],api:Api,progress?:(done:number,total:number,title:string)=>void){
 if(!items.length||items.length>20)throw new Error('Select between 1 and 20 draft designs per approval group.');
 const results:Array<{id:string;ok:boolean;error?:string}>=[];
 for(const item of items){progress?.(results.length,items.length,item.title);try{if(item.status!=='draft')throw new Error('Only unpublished drafts can be group approved.');const metadata=typeof item.metadata_json==='string'?JSON.parse(item.metadata_json):item.metadata;if(!metadata)throw new Error('AI metadata is not ready for this design.');const selected=metadata.approvedCategories?.length?metadata.approvedCategories:categorySuggestions(metadata,categories);if(!selected.length)throw new Error('Review the recommended category first.');const suggestedPath=metadata.etsySelectedPath||metadata.etsyListingRecommendations?.suggestions?.[0]?.path;await api(`admin/products/${item.id}`,{method:'PATCH',body:JSON.stringify({action:'categories',categories:selected,priceCents:item.price_cents,updatedAt:item.updated_at,...(validEtsyPath(suggestedPath)?{etsyPath:suggestedPath}:{})})});await api(`admin/products/${item.id}`,{method:'PATCH',body:JSON.stringify({action:'publish',reviewed:true,ownOriginal:true})});results.push({id:item.id,ok:true})}catch(error){results.push({id:item.id,ok:false,error:error instanceof Error?error.message:'Approval failed.'})}}
 progress?.(results.length,items.length,'Finished');return results;
}
