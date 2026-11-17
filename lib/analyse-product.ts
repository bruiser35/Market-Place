import {suggestEtsyPaths} from './etsy-taxonomy';
import {readCategories} from './categories';
import {CATEGORIES} from './catalogue';
import type {Bindings} from './api';
import {bridgeHeaders,sha256,validateMetadata,validateVector,searchDocument,EMBEDDING_MODEL} from './bridge-contract';
import {inspectPng} from './png-inspection';
import {rateLimit,indexStatements,queryEmbedding,cosine} from './semantic-search';
function base64(bytes:Uint8Array){let text='';for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(text)}
export async function analyseProduct(env:Bindings,id:string,prompt:string,siteOrigin:string){
 const db=env.DB,p=await db.prepare('SELECT * FROM products WHERE id=?').bind(id).first<any>();if(!p||p.status!=='draft')throw new Error('Choose an unpublished draft to analyse.');
 if(!env.PTP_EMBEDDING_URL||!env.PRINTWEAR_IMPORT_SECRET)throw new Error('AI catalogue analysis is not connected yet. The artwork is safely saved as a draft.');
 const connection=new URL(env.PTP_EMBEDDING_URL);if(connection.origin!=='https://prompttoprint.com.au'||connection.pathname!=='/api/admin/printwear/embedding')throw new Error('The AI service connection is invalid.');
 const files=await db.prepare("SELECT * FROM assets WHERE product_id=? AND role IN ('front','back') ORDER BY role").bind(id).all<any>();if(!files.results.length||(p.type==='pair'&&files.results.length!==2))throw new Error('Save the finished PNG for every required side before analysis.');
 const availableCategories=await readCategories(db);
 const inputHash=await sha256(JSON.stringify({etsyTaxonomy:'public-2026-11-17',categories:availableCategories,files:files.results.map(f=>({side:f.role,hash:f.sha256})),prompt}));const previous=await db.prepare('SELECT * FROM artwork_metadata WHERE product_id=?').bind(id).first<any>();const old=previous?JSON.parse(previous.metadata_json):{};
 if(old.analysisInputHash===inputHash)return {ok:true,alreadyAnalysed:true,metadata:old};
 if(!await rateLimit(db,'analysis:minute',5))throw new Error('AI analysis is busy. Try again in a minute.');
 const now=Date.now(),leaseKey='analysis:'+id;const claimed=await db.prepare(`INSERT INTO bridge_rate_limits(key,window,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=bridge_rate_limits.count+1 WHERE bridge_rate_limits.window<? RETURNING count`).bind(leaseKey,now+180000,now).first<{count:number}>();if(!claimed)throw new Error('This draft is already being analysed. Retry shortly.');
 try{
  const day=Math.floor(now/86400000),limit=Math.max(1,Math.min(1000,Number(env.PRINTWEAR_ANALYSES_PER_DAY)||100));const allowance=await db.prepare(`INSERT INTO bridge_rate_limits(key,window,count) VALUES('analysis:daily',?,1) ON CONFLICT(key) DO UPDATE SET window=excluded.window,count=CASE WHEN bridge_rate_limits.window=excluded.window THEN bridge_rate_limits.count+1 ELSE 1 END WHERE bridge_rate_limits.window<>excluded.window OR bridge_rate_limits.count<? RETURNING count`).bind(day,limit).first();if(!allowance)throw new Error('The daily artwork-analysis allowance has been reached.');
  const previews:Array<{side:string;dataUrl:string}>=[],reports:Array<{id:string;report:unknown}>=[];
  for(const file of files.results){const dimensions=JSON.parse(file.report_json),object=await env.FILES.get(file.object_key);if(!object)throw new Error('A saved production PNG is missing.');if(!Number.isFinite(dimensions.widthMm)||!Number.isFinite(dimensions.heightMm)||!Number.isFinite(dimensions.dpi))throw new Error('The saved artwork needs measured print dimensions before analysis.');const png=new Uint8Array(await object.arrayBuffer());const {report,preview}=await inspectPng(png,dimensions.widthMm,dimensions.heightMm,dimensions.dpi,{watermark:false,maxEdge:512,dimensionBasis:dimensions.dimensionBasis});reports.push({id:file.id,report});previews.push({side:file.role,dataUrl:'data:image/png;base64,'+base64(preview)})}
  const path='/api/admin/printwear/analyse',payload=JSON.stringify({prompt,previews}),headers=await bridgeHeaders(env.PRINTWEAR_IMPORT_SECRET,'POST',path,await sha256(payload));
  const response=await fetch(connection.origin+path,{method:'POST',headers:{...headers,'content-type':'application/json'},body:payload,redirect:'manual',signal:AbortSignal.timeout(90000)});if(!response.ok)throw new Error('AI analysis is unavailable. Your saved draft and original files are unchanged.');const result=await response.json() as any;
  const metadata=validateMetadata(result.metadata),vector=validateVector(result.vector);if(!CATEGORIES.slice(1).includes(metadata.category))throw new Error('AI returned an unsupported category.');if(result.model!==EMBEDDING_MODEL)throw new Error('The semantic model does not match the catalogue.');
  const current=await db.prepare('SELECT status FROM products WHERE id=?').bind(id).first<any>();if(current?.status!=='draft')throw new Error('The listing changed during analysis. Reopen it before retrying.');
  const at=Math.max(Date.now(),p.updated_at+1),full={...old,...metadata,artworkId:id,sourceId:old.sourceId||`printwear-${id}`,sourceSite:old.sourceSite||siteOrigin,sourceCreatedAt:old.sourceCreatedAt||null,receivedAt:old.receivedAt||new Date(p.created_at).toISOString(),originalGenerationPrompt:old.originalGenerationPrompt||prompt,analysisBrief:prompt,dimensions:reports.map((r,i)=>({side:files.results[i].role,...r.report as object})),analysedAt:new Date(at).toISOString(),analysisInputHash:inputHash,metadataModel:result.metadataModel||'not recorded',embeddingModel:EMBEDDING_MODEL};
  delete (full as any).approvedCategories;delete (full as any).categoriesApprovedAt;(full as any).suggestedCategories=[metadata.category,...metadata.secondaryCategories];
  const custom=availableCategories.filter(c=>!CATEGORIES.includes(c));
  // The image metadata is generated by vision. Shared AI embeddings recommend
  // custom categories from that analysis; suggestions still need owner approval.
  const suggestions:string[]=[];for(let i=0;i<custom.length;i+=4){const scored=await Promise.all(custom.slice(i,i+4).map(async category=>{try{return {category,score:cosine(vector,await queryEmbedding(env,'Digital artwork category: '+category))}}catch{return {category,score:0}}}));suggestions.push(...scored.filter(r=>r.score>=.30).map(r=>r.category))}
  (full as any).suggestedCategories=[metadata.category,...metadata.secondaryCategories,...suggestions];
  (full as any).etsyListingRecommendations=await suggestEtsyPaths(env,metadata);delete (full as any).etsySelectedPath;
  const document=searchDocument(metadata);
  await db.batch([db.prepare('UPDATE products SET title=?,description=?,category=?,tags=?,quality=?,updated_at=? WHERE id=?').bind(metadata.title,metadata.description,metadata.category,[...metadata.keywords,...metadata.synonyms].join(', ').slice(0,500),'pending',at,id),db.prepare('INSERT INTO artwork_metadata(product_id,metadata_json,search_text,source_id,source_site,source_created_at,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET metadata_json=excluded.metadata_json,search_text=excluded.search_text,updated_at=excluded.updated_at').bind(id,JSON.stringify(full),document,full.sourceId,full.sourceSite,full.sourceCreatedAt,p.created_at,at),...reports.map(r=>db.prepare('UPDATE assets SET report_json=? WHERE id=?').bind(JSON.stringify(r.report),r.id)),...indexStatements(db,id,vector,await sha256(document)),db.prepare('INSERT INTO audit_log(id,actor,action,entity_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),'admin:catalogue','artwork.analysed',id,at)]);
  return {ok:true,metadata:full,draftOnly:true};
 }finally{await db.prepare('UPDATE bridge_rate_limits SET window=0 WHERE key=? AND count=?').bind(leaseKey,claimed.count).run()}
}
