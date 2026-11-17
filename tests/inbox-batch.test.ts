import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Miniflare} from 'miniflare';
import {encode} from 'fast-png';
import {handleApi,type Bindings} from '../lib/api';
import {with300Dpi} from '../lib/artwork';
import {EMBEDDING_MODEL,sha256} from '../lib/bridge-contract';
import {approveDraftBatch} from '../lib/batch-approval';
test('saved inbox authenticates, checkpoints paired files, resumes transfers and supports partial group approval',{skip:!process.env.PTP_PROJECT_DIR},async()=>{
 const ptp=process.env.PTP_PROJECT_DIR!,{handlePrintwearInbox}=await import(pathToFileURL(resolve(ptp,'lib/printwear-inbox.ts')).href),{inboxDesignKey}=await import(pathToFileURL(resolve(ptp,'lib/printwear-inbox-names.ts')).href);
 assert.equal(inboxDesignKey('01_Ridge_Runner_Front_150mm_300dpi_Cleaned.png'),inboxDesignKey('01_Ridge_Runner_Rear_300mm_300dpi_Cleaned.png'));
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("fixture")}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['FILES']});const originalFetch=globalThis.fetch;
 try{
  const env:Bindings={DB:await mf.getD1Database('DB') as unknown as D1Database,FILES:await mf.getR2Bucket('FILES') as unknown as R2Bucket,ADMIN_EMAILS:'owner@example.com',PRINTWEAR_IMPORT_SECRET:'fixture-secret-abcdefghijklmnopqrstuvwxyz-12345'};
  for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8');for(const s of sql.split('--> statement-breakpoint'))if(s.trim())await env.DB.exec(s.trim().replace(/\n/g,' '))}
  const migration=(await readdir(resolve(ptp,'drizzle'))).find(f=>f.startsWith('0007_')&&f.endsWith('.sql'))!;for(const s of (await readFile(resolve(ptp,'drizzle',migration),'utf8')).split('--> statement-breakpoint'))if(s.trim())await env.DB.exec(s.trim().replace(/\n/g,' '));
  const metadata={title:'Inbox pair fixture',description:'Synthetic batch transfer artwork.',category:'Animals',secondaryCategories:['Typography'],subjects:['animal'],objects:[],styles:[],primaryColours:[],secondaryColours:[],audience:[],ageGroup:null,occasions:[],moods:[],themes:[],keywords:['animal'],synonyms:[],garments:[],personalisation:[],uncertainties:[],qualityFlags:[]},vector=Array.from({length:256},(_,i)=>i===0?1:0);let visions=0;
  const router:typeof fetch=async(input,options)=>{const url=String(input);if(url.startsWith('https://api.openai.com/')){if(url.endsWith('/embeddings'))return Response.json({data:[{embedding:vector}]});visions++;return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(metadata)}]}]})}if(url.startsWith('https://printwear.test'))return handleApi(new Request(url,options),env);throw Error('Unexpected test network call '+url)};globalThis.fetch=router;
  const deps={admin:async(r:Request)=>r.headers.get('x-inbox-test-admin')==='yes',bridge:{url:'https://printwear.test',secret:env.PRINTWEAR_IMPORT_SECRET,openaiKey:'fixture-key',siteAccessToken:'fixture'},fetcher:router};
  const headers={'x-inbox-test-admin':'yes',origin:'https://ptp.test'};
  const inbox=(path='',method='GET',body?:BodyInit,extra:Record<string,string>={})=>handlePrintwearInbox(new Request('https://ptp.test/api/admin/printwear-inbox'+path,{method,headers:{...headers,...extra},body}),env,deps);
  assert.equal((await handlePrintwearInbox(new Request('https://ptp.test/api/admin/printwear-inbox'),env,deps)).status,403);
  const data=new Uint8Array(400*400*4);for(let y=10;y<390;y++)for(let x=10;x<390;x++)data.set([230,40,60,255],(y*400+x)*4);const png=with300Dpi(encode({width:400,height:400,data,channels:4,depth:8})),batch='batch-fixture';const records:any[]=[];
  for(const side of ['front','back']){const upload=await inbox('','POST',png as unknown as BodyInit,{'x-batch-id':batch,'x-batch-name':'Saved fixture batch','x-file-name':side+'.png','x-design-key':'paired-original','x-artwork-side':side,'x-width-mm':'30','x-height-mm':'30'});assert.equal(upload.status,201,await upload.clone().text());records.push((await upload.json() as any).item)}
  assert.equal((await inbox('','POST',png as unknown as BodyInit,{origin:'https://evil.test'})).status,403);
  const savedSource=await inbox('/'+records[0].id+'/file?kind=source');assert.equal(await sha256(new Uint8Array(await savedSource.arrayBuffer())),await sha256(png));
  const finish=async(row:any)=>{const response=await inbox('/'+row.id+'/finished','PUT',png as unknown as BodyInit,{'x-record-revision':String(row.revision),'x-width-mm':'30','x-height-mm':'30','x-cleanup-report':JSON.stringify({sourceSha256:row.source_sha256,haze:0,specks:0,edges:0,bytes:0,nativeDpi:1})});assert.equal(response.status,200,await response.clone().text());return (await response.json() as any).item};
  const front=await finish(records[0]);assert.equal(JSON.parse(front.report_json).bytes,png.length);assert.ok(JSON.parse(front.report_json).nativeDpi>300);assert.equal((await inbox('/'+records[0].id+'/finished','PUT',png as unknown as BodyInit,{'x-record-revision':'1','x-width-mm':'30','x-height-mm':'30'})).status,409);
  const send=()=>inbox('/'+front.id+'/send','POST',JSON.stringify({ownOriginal:true,previews:[{side:'front',dataUrl:'data:image/jpeg;base64,QUFBQQ=='},{side:'back',dataUrl:'data:image/jpeg;base64,QUFBQQ=='}]}),{'content-type':'application/json'});
  assert.equal((await send()).status,400,'incomplete pairs cannot be sent');await finish(records[1]);const response=await send();assert.equal(response.status,200,await response.clone().text());const receipt=await response.json() as any;assert.ok(receipt.productId);assert.equal((await (await send()).json() as any).productId,receipt.productId);assert.equal(visions,1,'retries do not repeat image analysis');
  const listed=await (await inbox('?batch='+batch)).json() as any;assert.ok(listed.items.every((r:any)=>r.status==='sent'&&r.product_id===receipt.productId));
  const owner={origin:'https://printwear.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com'};
  const call=async(path:string,options:RequestInit={})=>{const r=await handleApi(new Request('https://printwear.test/api/'+path,{...options,headers:owner}),env);const d=await r.json() as any;if(!r.ok)throw Error(d.error);return d};
  const invalid=await call('admin/products',{method:'POST',body:JSON.stringify({title:'Missing assets fixture',category:'Animals',type:'single',priceCents:250})});
  const products=await call('admin/products?ids='+receipt.productId+','+invalid.id);assert.equal(products.items.length,2);const results=await approveDraftBatch(products.items,['All artwork','Animals','Typography'],call);assert.equal(results.filter(r=>r.ok).length,1);assert.ok(results.some(r=>!r.ok&&r.id===invalid.id));
  assert.equal((await env.DB.prepare('SELECT status FROM products WHERE id=?').bind(receipt.productId).first<any>()).status,'published');assert.equal((await env.DB.prepare('SELECT status FROM products WHERE id=?').bind(invalid.id).first<any>()).status,'draft');
  const finished=await env.DB.prepare("SELECT object_key FROM assets WHERE product_id=? AND role='front'").bind(receipt.productId).first<any>();assert.equal(await sha256(new Uint8Array(await (await env.FILES.get(finished.object_key))!.arrayBuffer())),await sha256(png),'receiver keeps finished bytes unchanged');
 }finally{globalThis.fetch=originalFetch;await mf.dispose()}
});
