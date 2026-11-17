import {suggestEtsyPaths} from './etsy-taxonomy';
import type {Bindings} from './api';
import {authenticateBridge,limitedBody,sha256,sourceIdFor,validateManifest,validateMetadata,validateVector,EMBEDDING_MODEL,MAX_PNG_BYTES,searchDocument,type ImportManifest} from './bridge-contract';
import {inspectPng} from './png-inspection';
import {indexStatements,rateLimit} from './semantic-search';
import {readCategories} from './categories';
import {DEFAULT_PRICES,CATEGORIES} from './catalogue';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
class ImportError extends Error{constructor(message:string,public status=400){super(message)}}
export async function receiveDesign(request:Request,env:Bindings){
 if(!await authenticateBridge(request,env.PRINTWEAR_IMPORT_SECRET||''))return json({error:'Sender authentication failed.'},401);
 const db=env.DB,path=new URL(request.url).pathname,method=request.method;let importId:string|null=null;const createdKeys:string[]=[];
 try{
  const isFile=/\/files\/(front|back)$/.test(path);const bytes=await limitedBody(request,isFile?MAX_PNG_BYTES:128*1024);if(await sha256(bytes)!==request.headers.get('x-printwear-content-sha256'))throw new ImportError('Transfer checksum mismatch.');
  const match=path.match(/^\/api\/admin\/design-imports(?:\/([a-f0-9-]{36})(?:\/(metadata|complete|files\/(front|back)))?)?$/);if(!match)return json({error:'Import route not found.'},404);
  importId=match[1]||null;const action=match[2]||'';
  if(!importId&&method==='POST'){
   const manifest=validateManifest(JSON.parse(new TextDecoder().decode(bytes)));if(await sourceIdFor(manifest.files)!==manifest.sourceId)throw new ImportError('Stable source ID does not match the artwork.');
   // Original prompt/job labels may change; identical bytes + production settings
   // are one source identity and always return the first receipt.
   const existing=await db.prepare('SELECT * FROM design_imports WHERE source_id=?').bind(manifest.sourceId).first<any>();if(existing)return receipt(db,existing);
   if(!await rateLimit(db,'import:new',24))throw new ImportError('Import rate limit reached. Try again in a minute.',429);
   const id=crypto.randomUUID(),now=Date.now();await db.prepare(`INSERT OR IGNORE INTO design_imports(id,source_id,manifest_hash,manifest_json,status,created_at,updated_at) VALUES(?,?,?,?,'receiving',?,?)`).bind(id,manifest.sourceId,await sha256(JSON.stringify(manifest)),JSON.stringify(manifest),now,now).run();const row=await db.prepare('SELECT * FROM design_imports WHERE source_id=?').bind(manifest.sourceId).first();return receipt(db,row);
  }
  const row=await db.prepare('SELECT * FROM design_imports WHERE id=?').bind(importId).first<any>();if(!row)return json({error:'Import not found.'},404);if(method==='GET')return receipt(db,row);
  if(row.status==='complete')return receipt(db,row);
  if(row.status==='processing'&&row.lease_until>Date.now())return json({importId:row.id,state:'processing',retryAfter:5},202);
  const manifest=JSON.parse(row.manifest_json) as ImportManifest;
  if(action==='metadata'&&method==='PUT'){
   if(row.metadata_json)return receipt(db,row);
   const payload=JSON.parse(new TextDecoder().decode(bytes)),metadata=validateMetadata(payload.metadata),vector=validateVector(payload.vector);if(payload.model!==EMBEDDING_MODEL||!(await readCategories(env.DB)).slice(1).includes(metadata.category))throw new ImportError('Metadata category or embedding model is invalid.');
   (metadata as any).etsyListingRecommendations=await suggestEtsyPaths(env,metadata);
   await db.prepare('UPDATE design_imports SET metadata_json=?,vector_json=?,model=?,updated_at=?,last_error=NULL WHERE id=? AND metadata_json IS NULL').bind(JSON.stringify({...metadata,metadataModel:typeof payload.metadataModel==='string'?payload.metadataModel.slice(0,80):'gpt-6-luna'}),JSON.stringify(vector),payload.model,Date.now(),row.id).run();return receipt(db,await db.prepare('SELECT * FROM design_imports WHERE id=?').bind(row.id).first());
  }
  if(isFile&&method==='PUT'){
   const side=match[3],file=manifest.files.find(f=>f.side===side);if(!file||bytes.length!==file.bytes||await sha256(bytes)!==file.sha256)throw new ImportError('File differs from the approved manifest.');
   const old=await db.prepare('SELECT id FROM design_import_files WHERE import_id=? AND side=?').bind(row.id,side).first();if(old)return receipt(db,row);
   if(!await rateLimit(db,'import:files',48))throw new ImportError('Upload rate limit reached.',429);
   const {report,preview}=await inspectPng(bytes,file.widthMm,file.heightMm,file.nativeDpi,{dimensionBasis:file.dimensionBasis}),key=`design-imports/${row.id}/${side}.png`,previewKey=`design-imports/${row.id}/${side}-preview.png`;
   await env.FILES.put(key,bytes,{httpMetadata:{contentType:'image/png'}});await env.FILES.put(previewKey,preview,{httpMetadata:{contentType:'image/png'}});
   await db.prepare('INSERT OR IGNORE INTO design_import_files(id,import_id,side,object_key,preview_key,sha256,report_json,size,preview_size) VALUES(?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),row.id,side,key,previewKey,file.sha256,JSON.stringify(report),bytes.length,preview.length).run();return receipt(db,row);
  }
  if(action==='complete'&&method==='POST'){
   if(!row.metadata_json||!row.vector_json)throw new ImportError('Metadata and semantic embedding are required before completion.',409);
   const {results:files}=await db.prepare('SELECT * FROM design_import_files WHERE import_id=?').bind(row.id).all<any>();if(files.length!==manifest.files.length)throw new ImportError('One or more artwork files are still missing.',409);
   const claimed=await db.prepare("UPDATE design_imports SET status='processing',lease_until=?,updated_at=? WHERE id=? AND status<>'complete' AND (lease_until IS NULL OR lease_until<?) RETURNING id").bind(Date.now()+180000,Date.now(),row.id,Date.now()).first();if(!claimed)return json({importId:row.id,state:'processing',retryAfter:5},202);
   const productId=crypto.randomUUID(),now=Date.now(),metadata=validateMetadata(JSON.parse(row.metadata_json)),vector=validateVector(JSON.parse(row.vector_json));let prices=DEFAULT_PRICES;
   const stored=await db.prepare("SELECT value FROM settings WHERE key='prices'").first<{value:string}>();if(stored)prices=JSON.parse(stored.value);const type=files.length===2?'pair':'single',price=type==='pair'?prices.pair:prices.single;
   const statements:D1PreparedStatement[]=[db.prepare("INSERT INTO products(id,title,description,category,type,price_cents,tags,status,quality,rights_confirmed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft','pending',0,?,?)").bind(productId,metadata.title,metadata.description,metadata.category,type,price,[...metadata.keywords,...metadata.synonyms].join(', ').slice(0,500),now,now)];
   const dimensions=files.map(f=>({side:f.side,...JSON.parse(f.report_json)}));const fullMetadata={...metadata,format:'image/png',sourceSite:manifest.sourceSite,sourceId:manifest.sourceId,sourceJobId:manifest.sourceJobId,sourceCreatedAt:manifest.sourceCreatedAt,receivedAt:new Date(now).toISOString(),originalGenerationPrompt:manifest.prompt,dimensions,metadataModel:JSON.parse(row.metadata_json).metadataModel||'gpt-6-luna',embeddingModel:EMBEDDING_MODEL};
   for(const file of files){const expected=manifest.files.find(f=>f.side===file.side)!;const report=JSON.parse(file.report_json);let master:ArrayBuffer|undefined,previewBytes:ArrayBuffer|undefined;for(const role of [`source_${file.side}`,file.side,`preview_${file.side}`]){const isPreview=role.startsWith('preview_'),objectKey=`products/${productId}/${role}/${crypto.randomUUID()}.png`;let content=isPreview?previewBytes:master;if(!content){const source=await env.FILES.get(isPreview?file.preview_key:file.object_key);if(!source)throw new ImportError('A staged file is unavailable. Retry the transfer.',503);content=await source.arrayBuffer();if(isPreview)previewBytes=content;else master=content}createdKeys.push(objectKey);await env.FILES.put(objectKey,content,{httpMetadata:{contentType:'image/png'}});statements.push(db.prepare('INSERT INTO assets(id,product_id,role,object_key,file_name,mime,size,width,height,sha256,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),productId,role,objectKey,expected.name,'image/png',isPreview?file.preview_size:file.size,isPreview?null:report.width,isPreview?null:report.height,isPreview?'watermarked-preview':file.sha256,JSON.stringify(report),now))}}
   statements.push(db.prepare('INSERT INTO artwork_metadata(product_id,metadata_json,search_text,source_id,source_site,source_job_id,source_created_at,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(productId,JSON.stringify(fullMetadata),searchDocument(metadata),manifest.sourceId,manifest.sourceSite,manifest.sourceJobId,manifest.sourceCreatedAt,now,now),...indexStatements(db,productId,vector,await sha256(searchDocument(metadata))),db.prepare("UPDATE design_imports SET status='complete',product_id=?,lease_until=NULL,last_error=NULL,updated_at=? WHERE id=?").bind(productId,now,row.id),db.prepare('INSERT INTO audit_log(id,actor,action,entity_id,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),'service:prompt-to-print','design_import.completed',productId,now));await db.batch(statements);createdKeys.length=0;return receipt(db,await db.prepare('SELECT * FROM design_imports WHERE id=?').bind(row.id).first());
  }
  return json({error:'Unsupported import action.'},405);
 }catch(e){if(createdKeys.length)await env.FILES.delete(createdKeys).catch(()=>{});const code=e instanceof ImportError?e.status:400;console.error('design_import_failed',{importId,code});if(importId)await db.prepare("UPDATE design_imports SET last_error=?,status=CASE WHEN status='complete' THEN status ELSE 'receiving' END,lease_until=NULL,updated_at=? WHERE id=?").bind('Transfer step failed; retry safely.',Date.now(),importId).run().catch(()=>{});return json({error:e instanceof Error?e.message:'Import failed.',retryable:code>=500||code===429},code)}
}
async function receipt(db:D1Database,row:any){const f=await db.prepare('SELECT side,sha256 FROM design_import_files WHERE import_id=?').bind(row.id).all();return json({importId:row.id,sourceId:row.source_id,state:row.status,productId:row.product_id||null,metadataReady:Boolean(row.metadata_json),files:f.results,draftOnly:true})}
