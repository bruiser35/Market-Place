import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {encode} from 'fast-png';
import {handleApi,type Bindings} from '../lib/api';
import {with300Dpi} from '../lib/artwork';
let mf:Miniflare,env:Bindings;
const admin={'oai-authenticated-user-id':'owner-id','oai-authenticated-user-email':'owner@example.com'};
const buyer={'oai-authenticated-user-id':'buyer-id','oai-authenticated-user-email':'buyer@example.com'};
async function call(path:string,method='GET',data?:unknown,identity:Record<string,string>=admin,origin='https://printwear.test'){
 return handleApi(new Request('https://printwear.test/api/'+path,{method,headers:{...identity,origin,'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),env);
}
before(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['FILES']});env={DB:await mf.getD1Database('DB') as unknown as D1Database,FILES:await mf.getR2Bucket('FILES') as unknown as R2Bucket,ADMIN_EMAILS:'owner@example.com'};const sql=await readFile(new URL('../drizzle/0000_simple_sumo.sql',import.meta.url),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await env.DB.exec(statement.trim().replace(/\n/g,' '))});
after(async()=>{await mf?.dispose()});
test('admin API denies anonymous and ordinary customers',async()=>{assert.equal((await call('admin/products','GET',undefined,{})).status,403);assert.equal((await call('admin/products','GET',undefined,buyer)).status,403)});
test('cross-origin changes are rejected even for the owner',async()=>{assert.equal((await call('admin/settings','PUT',{guidelines:'evil'},admin,'https://evil.test')).status,403)});
test('PayPal is disabled and cannot create an order',async()=>{assert.equal((await call('checkout','POST',{})).status,503);const result=await env.DB.prepare('SELECT count(*) count FROM orders').first<any>();assert.equal(result.count,0)});
test('empty catalogue and keyword filters return an honest empty result',async()=>{const response=await call('products?q=4wd%20mud');assert.equal(response.status,200);assert.deepEqual((await response.json() as any).items,[])});
test('settings persist and prices are validated',async()=>{assert.equal((await call('admin/settings','PUT',{prices:{single:275,pair:550,bundle:1600},guidelines:'Original transparent artwork only.'})).status,200);const settings=await (await call('admin/settings')).json() as any;assert.equal(settings.prices.single,275);assert.equal(settings.guidelines,'Original transparent artwork only.');assert.equal((await call('admin/settings','PUT',{prices:{single:-1,pair:500,bundle:1500}})).status,400)});
test('collection planning saves a plan without starting generation',async()=>{const r=await call('admin/plans','POST',{title:'Original outdoors',brief:'Original front and back compositions',quantity:100});assert.equal(r.status,201);assert.equal((await r.json() as any).status,'planned')});
test('drafts stay off the storefront and cannot publish without validated files',async()=>{const r=await call('admin/products','POST',{title:'Private test original',category:'4WD & Adventure',type:'pair',priceCents:500});assert.equal(r.status,201);const {id}=await r.json() as any;assert.equal((await call('products/'+id)).status,404);assert.equal((await call('admin/products/'+id,'PATCH',{action:'publish',reviewed:true,ownOriginal:true})).status,400);assert.equal((await call('products/'+id)).status,404)});
test('master assets require administrator permission and are immutable',async()=>{
 const created=await call('admin/products','POST',{title:'Protected master',category:'Typography',type:'single',priceCents:250});const {id}=await created.json() as any;
 const bytes=with300Dpi(encode({width:16,height:16,channels:4,data:new Uint8Array(16*16*4).fill(255)}));
 const request=()=>new Request(`https://printwear.test/api/admin/products/${id}/assets/source_front`,{method:'PUT',headers:{...admin,origin:'https://printwear.test','content-type':'image/png'},body:bytes as unknown as BodyInit});
 const saved=await handleApi(request(),env);assert.equal(saved.status,201);const a=await saved.json() as any;
 assert.equal((await call('assets/'+a.id,'GET',undefined,{})).status,404);assert.equal((await call('assets/'+a.id,'GET',undefined,buyer)).status,404);assert.equal((await call('assets/'+a.id)).status,200);assert.equal((await handleApi(request(),env)).status,409);
});
test('buyer cannot download without a paid entitlement',async()=>{assert.equal((await call('downloads/anything','GET',undefined,buyer)).status,403);assert.equal((await call('downloads/anything','GET',undefined,{})).status,401)});
test('published previews are public but source PNG remains protected',async()=>{
 const created=await call('admin/products','POST',{title:'Preview test',category:'Typography',type:'single',priceCents:250});const {id}=await created.json() as any;
 const bytes=encode({width:16,height:16,channels:4,data:new Uint8Array(16*16*4).fill(255)});
 const saved=await handleApi(new Request(`https://printwear.test/api/admin/products/${id}/assets/preview_front`,{method:'PUT',headers:{...admin,origin:'https://printwear.test','content-type':'image/png'},body:bytes as unknown as BodyInit}),env);const asset=await saved.json() as any;
 assert.equal((await call('assets/'+asset.id,'GET',undefined,{})).status,404);
 await env.DB.prepare("UPDATE products SET status='published' WHERE id=?").bind(id).run();assert.equal((await call('assets/'+asset.id,'GET',undefined,{})).status,200);
});
