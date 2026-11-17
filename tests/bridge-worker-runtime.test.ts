import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {encode} from 'fast-png';
import {with300Dpi} from '../lib/artwork';
import {inspectPng} from '../lib/png-inspection';

// Execute fetch() inside actual workerd isolates. Node/global fetch mocks miss
// edge-only failures such as Cloudflare's unsupported redirect:"error" value.
test('actual Worker runtime fills a saved draft through both AI bridge workers',{skip:!process.env.PTP_PROJECT_DIR},async()=>{
 const root=resolve('.'),ptp=process.env.PTP_PROJECT_DIR!,secret='worker-runtime-fixture-secret-abcdefghijklmnopqrstuvwxyz';
 const bundle=async(contents:string,resolveDir:string)=>(await build({stdin:{contents,resolveDir,loader:'ts'},bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'})).outputFiles[0].text;
 const pw=await bundle(`import {handleApi} from './lib/api';export default {fetch:handleApi}`,root);
 const bridge=await bundle(`import {handlePrintwear} from './lib/printwear-service';export default {fetch(request,env){return handlePrintwear(request,{secret:env.SECRET,openaiKey:'fixture-key',metadataModel:'fixture-model'},{admin:async()=>false})}}`,ptp);
 const metadata={title:'Runtime AI fixture title',description:'Runtime-generated fixture description.',category:'Animals',secondaryCategories:['Christmas'],subjects:['animal'],objects:[],styles:[],primaryColours:['red'],secondaryColours:[],audience:[],ageGroup:null,occasions:[],moods:[],themes:[],keywords:['animal'],synonyms:[],garments:[],personalisation:[],uncertainties:[],qualityFlags:[]};const vector=Array.from({length:256},(_,i)=>i===0?1:0);
 const ai=`const metadata=${JSON.stringify(metadata)},vector=${JSON.stringify(vector)};export default {fetch(request){if(new URL(request.url).pathname==='/v1/responses')return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(metadata)}]}]});return Response.json({data:[{embedding:vector}]})}}`;
 const mf=new Miniflare({workers:[{name:'printwear',modules:true,script:pw,compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['FILES'],bindings:{ADMIN_EMAILS:'owner@example.com',PRINTWEAR_IMPORT_SECRET:secret,PTP_EMBEDDING_URL:'https://prompttoprint.com.au/api/admin/printwear/embedding'},outboundService:'ptp'},{name:'ptp',modules:true,script:bridge,compatibilityDate:'2026-05-01',bindings:{SECRET:secret},outboundService:'ai'},{name:'ai',modules:true,script:ai,compatibilityDate:'2026-05-01'}]});
 try{
  const db=await mf.getD1Database('DB','printwear');for(const file of (await readdir(resolve(root,'drizzle'))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(resolve(root,'drizzle',file),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await db.exec(statement.trim().replace(/\n/g,' '))}
  const headers={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.com',origin:'https://printwear.test','content-type':'application/json'};
  const call=(path:string,method='GET',value?:unknown)=>mf.dispatchFetch('https://printwear.test/api/'+path,{method,headers,body:value===undefined?undefined:JSON.stringify(value)});
  const made=await call('admin/products','POST',{title:'Before analysis',category:'Animals',type:'single',priceCents:275});assert.equal(made.status,201);const {id}=await made.json() as any;
  const size=400,data=new Uint8Array(size*size*4);for(let y=10;y<390;y++)for(let x=10;x<390;x++)data.set([210,30,60,255],(y*size+x)*4);const bytes=with300Dpi(encode({width:size,height:size,data,channels:4,depth:8})),report=(await inspectPng(bytes,30,30,400)).report;
  for(const role of ['source_front','front','preview_front']){const uploaded=await mf.dispatchFetch(`https://printwear.test/api/admin/products/${id}/assets/${role}`,{method:'PUT',headers:{...headers,'content-type':'image/png','x-artwork-report':JSON.stringify(report)},body:bytes});assert.equal(uploaded.status,201,await uploaded.clone().text())}
  assert.equal((await call('admin/categories','POST',{name:'Runtime custom'})).status,201);
  const analysed=await call(`admin/products/${id}/analyse`,'POST',{prompt:''});assert.equal(analysed.status,200,await analysed.clone().text());const saved=await (await call(`admin/products/${id}`)).json() as any;assert.equal(saved.product.title,metadata.title);assert.equal(saved.product.description,metadata.description);assert.equal(saved.product.price_cents,275);assert.ok(saved.metadata.keywords.includes('animal'));assert.equal(saved.product.status,'draft');assert.equal(saved.metadata.etsyListingRecommendations.method,'ai-semantic');assert.equal(saved.metadata.etsyListingRecommendations.suggestions.length,3);
  const search=await call('search','POST',{q:'animal'});assert.equal(search.status,200);
 }finally{await mf.dispose()}
});
