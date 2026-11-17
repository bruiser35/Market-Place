import {test} from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {encode} from 'fast-png';
import {handleApi,type Bindings} from '../lib/api';
import {sha256,sourceIdFor,EMBEDDING_MODEL,EMBEDDING_DIMENSIONS} from '../lib/bridge-contract';
import {with300Dpi} from '../lib/artwork';
test('both real bridge handlers complete a private front/back transfer, approval and shared-index search',{skip:!process.env.PTP_PROJECT_DIR},async()=>{
 const {handlePrintwear}=await import(pathToFileURL(resolve(process.env.PTP_PROJECT_DIR!,'lib/printwear-service.ts')).href);
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['FILES']});
 const secret='local-integration-test-secret-abcdefghijklmnopqrstuvwxyz';
 const env:Bindings={DB:await mf.getD1Database('DB') as unknown as D1Database,FILES:await mf.getR2Bucket('FILES') as unknown as R2Bucket,ADMIN_EMAILS:'owner@example.com',PRINTWEAR_IMPORT_SECRET:secret};
 const config={url:'https://printwear.test',secret,siteAccessToken:'private-fixture',openaiKey:'mock-key',metadataModel:'gpt-6-luna'};
 const metadata={title:'Synthetic red car fixture',description:'Synthetic test fixture for the integration, not sale artwork.',category:'Everyday Originals',secondaryCategories:[],subjects:['car'],objects:[],styles:[],primaryColours:['red'],secondaryColours:[],audience:[],ageGroup:null,occasions:[],moods:[],themes:[],keywords:['red car'],synonyms:['muscle car'],garments:['T-shirt'],personalisation:[],uncertainties:['No actual engine specification is established.'],qualityFlags:[]};
 const vector=Array.from({length:EMBEDDING_DIMENSIONS},(_,i)=>i===0?1:0),originalFetch=globalThis.fetch;let visionCalls=0;
 const router:typeof fetch=async(input,options)=>{const url=String(input);if(url.startsWith('https://api.openai.com/')){if(url.endsWith('/embeddings'))return Response.json({data:[{embedding:vector}]});visionCalls++;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(metadata)}]}]})}const r=new Request(url,options);if(url.startsWith('https://printwear.test')){assert.equal(r.headers.get('OAI-Sites-Authorization'),'Bearer private-fixture');return handleApi(r,env)}if(url.startsWith('https://prompttoprint.com.au'))return handlePrintwear(r,config,{admin:async(q:Request)=>q.headers.get('x-test-admin')==='yes',fetcher:router});throw new Error('Unexpected external request in local test')};
 try{
  for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await env.DB.exec(statement.trim().replace(/\n/g,' '))}
  globalThis.fetch=router;const files=[];for(const side of ['front','back'] as const){const size=side==='front'?500:520,data=new Uint8Array(size*size*4);for(let y=12;y<size-12;y++)for(let x=12;x<size-12;x++){const p=(y*size+x)*4;data[p]=200;data[p+1]=50;data[p+3]=255}const bytes=with300Dpi(encode({width:size,height:size,data,channels:4,depth:8}));files.push({bytes,descriptor:{side,sha256:await sha256(bytes),bytes:bytes.length,widthMm:30,heightMm:30,nativeDpi:400,name:side+'.png'}})}
  const manifest={version:1,sourceSite:'https://prompttoprint.com.au',sourceId:await sourceIdFor(files.map(f=>f.descriptor)),sourceJobId:'synthetic-job',sourceCreatedAt:null,prompt:'Synthetic fixture.',files:files.map(f=>f.descriptor),rightsConfirmed:true};
  const call=(path:string,method='POST',body:any={},headers:Record<string,string>={})=>handlePrintwear(new Request('https://prompttoprint.com.au/api/admin/printwear/'+path,{method,headers:{origin:'https://prompttoprint.com.au','x-test-admin':'yes',...headers},body:method==='GET'?undefined:body instanceof Uint8Array?body as unknown as BodyInit:JSON.stringify(body)}),config,{admin:async(q:Request)=>q.headers.get('x-test-admin')==='yes',fetcher:router});
  const payload={manifest,previews:files.map(f=>({side:f.descriptor.side,dataUrl:'data:image/jpeg;base64,QUFBQQ=='}))};let response=await call('transfer','POST',payload);assert.equal(response.status,200,await response.clone().text());let receipt=await response.json() as any;const id=receipt.importId;
  await call(`transfer/${id}/files/front`,'PUT',files[0].bytes,{'x-artwork-sha256':files[0].descriptor.sha256});
  response=await call('transfer','POST',payload);receipt=await response.json() as any;assert.equal(receipt.importId,id);assert.equal(visionCalls,1);
  response=await call(`transfer/${id}/files/back`,'PUT',files[1].bytes,{'x-artwork-sha256':files[1].descriptor.sha256});assert.equal(response.status,200);
  receipt=await (await call(`transfer/${id}/complete`)).json() as any;assert.equal(receipt.state,'complete',JSON.stringify(receipt));const productId=receipt.productId;
  assert.equal((await (await call(`transfer/${id}/complete`)).json() as any).productId,productId);
  let found=await (await handleApi(new Request('https://printwear.test/api/products?q=car'),env)).json() as any;assert.equal(found.total,0);
  const admin={origin:'https://printwear.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
  const categoryDraft=await env.DB.prepare('SELECT updated_at FROM products WHERE id=?').bind(productId).first<any>();
  const update=(payload:unknown)=>handleApi(new Request('https://printwear.test/api/admin/products/'+productId,{method:'PATCH',headers:admin,body:JSON.stringify(payload)}),env);
  const categorized=await update({action:'categories',categories:['Everyday Originals','Typography'],updatedAt:categoryDraft.updated_at});
  assert.equal(categorized.status,200);
  const {updatedAt}=await categorized.json() as any;
  assert.equal((await update({action:'publish',reviewed:true,ownOriginal:true,updatedAt:categoryDraft.updated_at})).status,409);
  response=await update({action:'publish',reviewed:true,ownOriginal:true,updatedAt});
  assert.equal(response.status,200,await response.clone().text());
  assert.equal((await (await update({action:'publish',reviewed:true,ownOriginal:true,updatedAt})).json() as any).alreadyPublished,true);
  env.PTP_EMBEDDING_URL='https://prompttoprint.com.au/api/admin/printwear/embedding';found=await (await handleApi(new Request('https://printwear.test/api/search',{method:'POST',headers:{origin:'https://printwear.test'},body:JSON.stringify({q:'Find red racing T-shirt prints'})}),env)).json() as any;assert.equal(found.mode,'semantic');assert.equal(found.items[0].id,productId);assert.equal((await env.DB.prepare('SELECT count(*) count FROM products').first<any>()).count,1);
  const asset=await env.DB.prepare("SELECT * FROM assets WHERE product_id=? AND role='front'").bind(productId).first<any>();assert.equal(await sha256(new Uint8Array(await (await env.FILES.get(asset.object_key))!.arrayBuffer())),files[0].descriptor.sha256);
 }finally{globalThis.fetch=originalFetch;await mf.dispose()}
});
