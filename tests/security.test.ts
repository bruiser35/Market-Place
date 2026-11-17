import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
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
before(async()=>{mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-01',d1Databases:['DB'],r2Buckets:['FILES']});env={DB:await mf.getD1Database('DB') as unknown as D1Database,FILES:await mf.getR2Bucket('FILES') as unknown as R2Bucket,ADMIN_EMAILS:'owner@example.com'};for(const file of (await readdir(new URL('../drizzle/',import.meta.url))).filter(f=>f.endsWith('.sql')).sort()){const sql=await readFile(new URL('../drizzle/'+file,import.meta.url),'utf8');for(const statement of sql.split('--> statement-breakpoint'))if(statement.trim())await env.DB.exec(statement.trim().replace(/\n/g,' '))}});
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

test('custom categories persist, reject duplicates, and are available only for owner assignment',async()=>{
 assert.equal((await call('admin/categories','POST',{name:'Motorsport'},buyer)).status,403);
 assert.equal((await call('admin/categories','POST',{name:'Motorsport'},admin,'https://evil.test')).status,403);
 const created=await call('admin/categories','POST',{name:'Motorsport'});assert.equal(created.status,201);assert.ok((await created.json() as any).categories.includes('Motorsport'));
 assert.equal((await call('admin/categories','POST',{name:' motorsport '})).status,400);
 assert.equal((await call('admin/categories','POST',{name:' '})).status,400);
 const publicSettings=await (await call('settings','GET',undefined,{})).json() as any;assert.ok(publicSettings.categories.includes('Motorsport'));
 const product=await call('admin/products','POST',{title:'Custom category original',category:'Motorsport',type:'single',priceCents:250});assert.equal(product.status,201);
 assert.equal((await call('admin/products','POST',{title:'Invalid category',category:'Not saved',type:'single',priceCents:250})).status,400);
});

test('Delete rejects customers and stale review, moves only drafts to private trash and hides them from catalogue',async()=>{
 const made=await call('admin/products','POST',{title:'Rejected draft',category:'Animals',type:'single',priceCents:250}),{id}=await made.json() as any;const row=await env.DB.prepare('SELECT updated_at FROM products WHERE id=?').bind(id).first<any>();
 assert.equal((await call('admin/products/'+id,'PATCH',{action:'delete',updatedAt:row.updated_at},buyer)).status,403);
 assert.equal((await call('admin/products/'+id,'PATCH',{action:'delete',updatedAt:0})).status,409);
 const deleted=await call('admin/products/'+id,'PATCH',{action:'delete',updatedAt:row.updated_at});assert.equal(deleted.status,200);assert.equal((await deleted.json() as any).filesRetained,true);
 assert.ok(!(await (await call('admin/products')).json() as any).items.some((p:any)=>p.id===id));assert.equal((await call('products/'+id)).status,404);
 const status=await env.DB.prepare('SELECT status FROM products WHERE id=?').bind(id).first<any>();assert.equal(status.status,'deleted');
});

test('admin pagination and search surface artwork beyond the newest 200 listings',async()=>{
 const query="INSERT INTO products(id,title,description,category,type,price_cents,tags,status,quality,rights_confirmed,created_at,updated_at) VALUES(?,?,'','Typography','single',250,'','draft','pending',0,1,?)";
 try{
  for(let offset=0;offset<204;offset+=20){
   await env.DB.batch(Array.from({length:Math.min(204-offset,20)},(_,i)=>{
    const index=offset+i;
    return env.DB.prepare(query).bind('pagination-test-'+index,index?'Batch fixture '+index:'Batch fixture oldest design',index);
   }));
  }
  const first=await (await call('admin/products?page=1&status=draft&q=batch%20fixture')).json() as any;
  const last=await (await call('admin/products?page=6&status=draft&q=batch%20fixture')).json() as any;
  assert.equal(first.total,204);
  assert.equal(first.items.length,40);
  assert.equal(last.items.length,4);
  assert.equal(last.items.at(-1).id,'pagination-test-0');
  assert.equal((await call('admin/products?page=6&status=draft', 'GET', undefined, buyer)).status,403);
 }finally{await env.DB.prepare("DELETE FROM products WHERE id LIKE 'pagination-test-%'").run()}
});
test('owner can explicitly accept exact AI warnings; stale review and customer acceptance are rejected',async()=>{
 const created=await call('admin/products','POST',{title:'Warning review fixture',category:'Typography',type:'single',priceCents:250});const {id}=await created.json() as any;
 const flags=['Crown is close to the top edge; inspect the original.'];
 const metadata={qualityFlags:flags,categoriesApprovedAt:new Date().toISOString()};
 await env.DB.prepare('INSERT INTO artwork_metadata(product_id,metadata_json,received_at,updated_at) VALUES(?,?,?,?)').bind(id,JSON.stringify(metadata),1,1).run();
 const report={ready:true,dpi:300,widthMm:100,heightMm:100,visiblePixels:100,transparentPixels:100,issues:[]};
 for(const role of ['front','source_front','preview_front'])await env.DB.prepare('INSERT INTO assets(id,product_id,role,object_key,file_name,mime,size,sha256,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,role,id+'/'+role,'fixture.png','image/png',100,'fixture',JSON.stringify(report),1).run();
 const snapshot=await (await call('admin/products/'+id)).json() as any;
 const approval={action:'publish',reviewed:true,ownOriginal:true,acceptAiWarnings:true,acceptedAiFlags:flags,updatedAt:snapshot.product.updated_at};
 assert.equal((await call('admin/products/'+id,'PATCH',approval,buyer)).status,403);
 assert.equal((await call('admin/products/'+id,'PATCH',{...approval,updatedAt:0})).status,409);
 assert.equal((await call('admin/products/'+id,'PATCH',{...approval,acceptedAiFlags:['different flag']})).status,400);
 const edge='Artwork touches the canvas edge. Check for clipping and add transparent margins.';
 await env.DB.prepare("UPDATE assets SET report_json=? WHERE product_id=? AND role='front'").bind(JSON.stringify({...report,ready:false,issues:[edge]}),id).run();
 assert.equal((await call('admin/products/'+id,'PATCH',approval)).status,400);
 assert.equal((await call('admin/products/'+id,'PATCH',{...approval,acceptProductionWarnings:true,acceptedProductionWarnings:['wrong']})).status,400);
 assert.equal((await call('admin/products/'+id,'PATCH',{...approval,acceptProductionWarnings:true,acceptedProductionWarnings:['front: '+edge]})).status,200);
 const saved=await (await call('admin/products/'+id)).json() as any;
 assert.equal(saved.product.status,'published');assert.deepEqual(saved.metadata.qualityFlags,flags);assert.deepEqual(saved.metadata.aiWarningAcceptance.flags,flags);assert.deepEqual(saved.metadata.productionWarningAcceptance.warnings,['front: '+edge]);
});
test('owner can move and trash published artwork; customers and stale edits are denied',async()=>{
 const created=await call('admin/products','POST',{title:'Movable fixture',category:'Animals',type:'single',priceCents:250}),{id}=await created.json() as any;
 await env.DB.prepare("UPDATE products SET status='published' WHERE id=?").bind(id).run();
 await env.DB.prepare('INSERT INTO artwork_metadata(product_id,metadata_json,received_at,updated_at) VALUES(?,?,1,1)').bind(id,JSON.stringify({category:'Animals',approvedCategories:['Animals','Typography']})).run();
 const snapshot=await (await call('admin/products/'+id)).json() as any;
 const move={action:'move',category:'Typography',updatedAt:snapshot.product.updated_at};
 assert.equal((await call('admin/products/'+id,'PATCH',move,buyer)).status,403);
 assert.equal((await call('admin/products/'+id,'PATCH',{...move,updatedAt:0})).status,409);
 assert.equal((await call('admin/products/'+id,'PATCH',move)).status,200);
 const moved=await (await call('admin/products/'+id)).json() as any;
 assert.equal(moved.product.status,'published');assert.equal(moved.product.category,'Typography');assert.deepEqual(moved.metadata.approvedCategories,['Typography']);
 assert.equal((await call('admin/products/'+id,'PATCH',{action:'delete',updatedAt:moved.product.updated_at})).status,200);
 assert.equal((await call('products/'+id)).status,404);
 assert.ok(await env.DB.prepare('SELECT product_id FROM artwork_metadata WHERE product_id=?').bind(id).first());
});
test('removing an image from admin hides only the admin row and preserves its customer listing',async()=>{
 const made=await call('admin/products','POST',{title:'Admin removal fixture',category:'Animals',type:'single',priceCents:250}),{id}=await made.json() as any;
 await env.DB.prepare("UPDATE products SET status='published' WHERE id=?").bind(id).run();
 const snapshot=await (await call('admin/products/'+id)).json() as any;
 const payload={action:'hide-admin',updatedAt:snapshot.product.updated_at};
 assert.equal((await call('admin/products/'+id,'PATCH',payload,buyer)).status,403);
 assert.equal((await call('admin/products/'+id,'PATCH',payload)).status,200);
 const listing=await (await call('products/'+id)).json() as any;assert.equal(listing.product.id,id);
 const adminRows=await (await call('admin/products?ids='+id)).json() as any;assert.equal(adminRows.items.length,0);
 assert.equal((await env.DB.prepare('SELECT status FROM products WHERE id=?').bind(id).first<any>()).status,'published');
});
test('remove from one category preserves other customer listings and rejects removing the last category',async()=>{
 const made=await call('admin/products','POST',{title:'Multiple category fixture',category:'Animals',type:'single',priceCents:250}),{id}=await made.json() as any;
 await env.DB.prepare("UPDATE products SET status='published' WHERE id=?").bind(id).run();
 await env.DB.prepare('INSERT INTO artwork_metadata(product_id,metadata_json,received_at,updated_at) VALUES(?,?,1,1)').bind(id,JSON.stringify({category:'Animals',approvedCategories:['Animals','Typography'],qualityFlags:[]})).run();
 const snapshot=await (await call('admin/products/'+id)).json() as any;
 const payload={action:'remove-category',category:'Animals',updatedAt:snapshot.product.updated_at};
 assert.equal((await call('admin/products/'+id,'PATCH',payload,buyer)).status,403);
 assert.equal((await call('admin/products/'+id,'PATCH',{...payload,updatedAt:0})).status,409);
 assert.equal((await call('admin/products/'+id,'PATCH',payload)).status,200);
 const remaining=await (await call('admin/products/'+id)).json() as any;
 assert.equal(remaining.product.status,'published');assert.equal(remaining.product.category,'Typography');assert.deepEqual(remaining.metadata.approvedCategories,['Typography']);
 assert.equal((await call('products/'+id)).status,200);
 assert.equal((await call('admin/products/'+id,'PATCH',{...payload,category:'Typography',updatedAt:remaining.product.updated_at})).status,400);
});
