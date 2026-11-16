import {identity,sameOrigin} from "./auth";
import {CATEGORIES,DEFAULT_GUIDELINES,DEFAULT_PRICES,cleanText,parsePrice,validId} from "./catalogue";
export type Bindings={DB:D1Database;FILES:R2Bucket;ADMIN_EMAILS?:string};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
const error=(message:string,status=400)=>json({error:message},status);
const uuid=()=>crypto.randomUUID();
async function body(request:Request){if(Number(request.headers.get("content-length")||0)>32000)throw new Error("Request is too large.");const text=await request.text();if(text.length>32000)throw new Error("Request is too large.");return JSON.parse(text)}
export async function handleApi(request:Request,env:Bindings):Promise<Response>{
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,""),method=request.method;
 const user=identity(request,env.ADMIN_EMAILS||"");
 const db=env.DB;
 if(!["GET","HEAD"].includes(method)&&!sameOrigin(request))return error("This request must come from PrintWear.",403);
 if(path==="session"&&method==="GET")return json({user,paymentsEnabled:false,searchMode:"catalogue"});
 if(path==="health"&&method==="GET"){try{await db.prepare("SELECT key FROM settings LIMIT 1").first();return json({status:"ok",database:true,storage:!!env.FILES,paymentsEnabled:false})}catch{return error("Database setup is not complete.",503)}}
 if(path==="checkout")return error("PayPal is not connected yet. No payment has been taken.",503);
 if(path.startsWith("admin/")&&!user?.admin)return error("Administrator access is required.",403);
 const log=(action:string,id?:string)=>db.prepare("INSERT INTO audit_log(id,actor,action,entity_id,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user!.id,action,id||null,Date.now());
 const settings=async()=>{const rows=await db.prepare("SELECT key,value FROM settings").all<{key:string;value:string}>();const stored=Object.fromEntries(rows.results.map(r=>[r.key,r.value]));return {prices:stored.prices?JSON.parse(stored.prices):DEFAULT_PRICES,guidelines:stored.guidelines||DEFAULT_GUIDELINES}};
 try{
 if(path==="settings"&&method==="GET"){const s=await settings();return json({prices:s.prices,currency:"AUD",paymentsEnabled:false})}
 if(path==="admin/settings"){
  if(method==="GET")return json(await settings());
  if(method==="PUT"){const b=await body(request);const pairs:Array<[string,string]>=[];if(b.prices){const prices={single:parsePrice(b.prices.single),pair:parsePrice(b.prices.pair),bundle:parsePrice(b.prices.bundle)};pairs.push(["prices",JSON.stringify(prices)])}if(b.guidelines!==undefined){const text=cleanText(b.guidelines,12000);if(!text)throw new Error("Guidelines cannot be empty.");pairs.push(["guidelines",text])}if(!pairs.length)throw new Error("Choose settings to update.");await db.batch([...pairs.map(([k,v])=>db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(k,v,Date.now())),log("settings.updated")]);return json({ok:true})}
 }
 if(path==="products"&&method==="GET"){
  const q=(url.searchParams.get("q")||"").trim().slice(0,120),category=url.searchParams.get("category")||"All artwork",type=url.searchParams.get("type")||"all",page=Math.max(1,Math.min(10000,Number(url.searchParams.get("page"))||1));
  const words=q.toLowerCase().split(/\s+/).filter(w=>w.length>2&&!['want','with','some','design','designs','looking','please','shirt','that','the','and','for'].includes(w)).slice(0,8).map(w=>w.slice(0,40));
  const clauses=["p.status='published'"];const args:unknown[]=[];
  if(category!=="All artwork"){clauses.push("p.category=?");args.push(category)}if(type!=="all"){clauses.push("p.type=?");args.push(type)}
  for(const word of words){clauses.push("lower(p.title||' '||p.description||' '||p.tags) LIKE ? ESCAPE '\\'");args.push('%'+word.replace(/[\\%_]/g,"\\$&")+'%')}
  const where=clauses.join(" AND ");const select=`SELECT p.*,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_front') preview_front,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_back') preview_back FROM products p WHERE ${where}`;
  const sort=url.searchParams.get('sort');const order=sort==='low'?'p.price_cents ASC,p.updated_at DESC':sort==='high'?'p.price_cents DESC,p.updated_at DESC':'p.updated_at DESC';
  const [items,total]=await Promise.all([db.prepare(select+` ORDER BY ${order} LIMIT 24 OFFSET ?`).bind(...args,Math.floor((page-1)*24)).all(),db.prepare(`SELECT count(*) count FROM products p WHERE ${where}`).bind(...args).first<{count:number}>()]);return json({items:items.results,total:total?.count||0,page})
 }
 const productMatch=path.match(/^products\/([a-zA-Z0-9-]+)$/);
 if(productMatch&&method==="GET"){const row=await db.prepare("SELECT * FROM products WHERE id=? AND status='published'").bind(productMatch[1]).first();if(!row)return error("Artwork not found.",404);const a=await db.prepare("SELECT id,role,width,height FROM assets WHERE product_id=? AND role LIKE 'preview_%'").bind(productMatch[1]).all();return json({product:row,assets:a.results})}
 if(path==="admin/summary"&&method==="GET"){
 const [p,a,o,plans]=await Promise.all([db.prepare("SELECT status,count(*) count FROM products GROUP BY status").all(),db.prepare("SELECT count(*) count,coalesce(sum(size),0) bytes FROM assets").first(),db.prepare("SELECT count(*) count,coalesce(sum(total_cents),0) revenue FROM orders WHERE status='paid'").first(),db.prepare("SELECT * FROM collection_plans ORDER BY created_at DESC LIMIT 20").all()]);return json({products:p.results,assets:a,orders:o,plans:plans.results,paymentsEnabled:false})}
 if(path==="admin/products"){
  if(method==="GET"){const rows=await db.prepare("SELECT p.*,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_front') preview_front,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_back') preview_back FROM products p ORDER BY updated_at DESC LIMIT 200").all();return json({items:rows.results})}
  if(method==="POST"){const b=await body(request),title=cleanText(b.title,150),category=cleanText(b.category,80),type=cleanText(b.type,10);if(!title||!CATEGORIES.slice(1).includes(category)||!["single","pair","bundle"].includes(type))throw new Error("Choose a title, category and product format.");const id=uuid(),now=Date.now();await db.batch([db.prepare("INSERT INTO products(id,title,description,category,type,price_cents,tags,status,quality,rights_confirmed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft','pending',0,?,?)").bind(id,title,cleanText(b.description,2500),category,type,parsePrice(b.priceCents),cleanText(b.tags,500),now,now),log("product.created",id)]);return json({id},201)}
 }
 const adminProduct=path.match(/^admin\/products\/([a-zA-Z0-9-]+)$/);
 if(adminProduct){const id=adminProduct[1],p=await db.prepare("SELECT * FROM products WHERE id=?").bind(id).first<any>();if(!p)return error("Draft not found.",404);
  if(method==="GET"){const a=await db.prepare("SELECT * FROM assets WHERE product_id=? ORDER BY role").bind(id).all();return json({product:p,assets:a.results})}
  if(method==="PATCH"){const b=await body(request);if(b.action==="archive"){await db.batch([db.prepare("UPDATE products SET status='archived',updated_at=? WHERE id=?").bind(Date.now(),id),log("product.archived",id)]);return json({ok:true})}
   if(b.action==="publish"){
    if(!b.reviewed||!b.ownOriginal)throw new Error("Confirm visual review and original artwork ownership.");
    const {results:a}=await db.prepare("SELECT role,width,height,report_json FROM assets WHERE product_id=?").bind(id).all<any>();
    const sides=p.type==="pair"?["front","back"]:p.type==="single"?a.some(x=>x.role==="front")?["front"]:["back"]:[];
    if(!sides.length)throw new Error("Bundle publication will be enabled with the first verified bundle.");
    for(const side of sides){const file=a.find(x=>x.role===side),preview=a.find(x=>x.role===`preview_${side}`),source=a.find(x=>x.role===`source_${side}`);if(!file||!preview||!source)throw new Error(`Missing ${side} master, cleaned PNG or preview.`);const r=JSON.parse(file.report_json);if(!r.ready||r.dpi<299.5||r.transparentPixels<=0||r.visiblePixels<=0||r.widthMm>355)throw new Error(`The ${side} artwork needs quality review or more resolution.`)}
    await db.batch([db.prepare("UPDATE products SET status='published',quality='approved',rights_confirmed=1,updated_at=? WHERE id=?").bind(Date.now(),id),log("product.approved",id)]);return json({ok:true})
   }return error("Unknown catalogue action.")
  }
 }
 const assetUpload=path.match(/^admin\/products\/([a-zA-Z0-9-]+)\/assets\/([a-z_]+)$/);
 if(assetUpload&&method==="PUT"){
  const [,id,role]=assetUpload;if(!["front","back","source_front","source_back","preview_front","preview_back"].includes(role))throw new Error("Invalid artwork role.");
  const p=await db.prepare("SELECT status FROM products WHERE id=?").bind(id).first<{status:string}>();if(!p||p.status!=="draft")return error("Files can only be added to an unpublished draft.",409);
  if(Number(request.headers.get("content-length")||0)>32*1024*1024)return error("File exceeds 32 MB.",413);
  const bytes=new Uint8Array(await request.arrayBuffer());if(!bytes.length||bytes.length>32*1024*1024)return error("File is empty or exceeds 32 MB.",413);
  const png=[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);const mime=request.headers.get("content-type")||"application/octet-stream";
  const isSource=role.startsWith("source_");if(!isSource&&!png)throw new Error("Customer artwork and previews must be PNG.");
  if(isSource&&!png&&!['image/jpeg','image/webp'].includes(mime))throw new Error("Source must be PNG, JPEG or WebP.");
  let width:number|null=null,height:number|null=null;
  if(png){if(bytes.length<33)throw new Error("Invalid PNG.");const view=new DataView(bytes.buffer);width=view.getUint32(16);height=view.getUint32(20);if(width<1||height<1||width*height>25_000_000||width>16000||height>16000)throw new Error("Image dimensions exceed the 25 megapixel limit.");if(!isSource&&!role.startsWith("preview_")&&![4,6].includes(bytes[25]))throw new Error("The cleaned PNG needs an alpha channel.")}
  let report:Record<string,any>={};try{report=JSON.parse(request.headers.get("x-artwork-report")||"{}")}catch{throw new Error("Invalid quality report.")}
  if(!isSource&&!role.startsWith("preview_")&&(report.width!==width||report.height!==height))throw new Error("Quality report dimensions do not match the PNG.");
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(x=>x.toString(16).padStart(2,"0")).join("");
  const assetId=uuid(),key=`products/${id}/${role}/${assetId}`;
  const existing=await db.prepare("SELECT id FROM assets WHERE product_id=? AND role=?").bind(id,role).first();if(existing)return error("This artwork slot is already saved. Create a new draft to keep versions intact.",409);
  await env.FILES.put(key,bytes,{httpMetadata:{contentType:png?"image/png":mime}});
  try{await db.batch([db.prepare("INSERT INTO assets(id,product_id,role,object_key,file_name,mime,size,width,height,sha256,report_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").bind(assetId,id,role,key,cleanText(request.headers.get("x-file-name"),160)||`${role}.png`,png?"image/png":mime,bytes.length,width,height,sha,JSON.stringify(report).slice(0,6000),Date.now()),log("asset.saved",id)])}catch(e){await env.FILES.delete(key);throw e}return json({id:assetId},201)
 }
 if(path==="admin/plans"){
  if(method==="POST"){const b=await body(request),title=cleanText(b.title,120),brief=cleanText(b.brief,5000),quantity=Number(b.quantity);if(!title||!brief||!Number.isInteger(quantity)||quantity<1||quantity>1000)throw new Error("Add a collection name, instructions and quantity from 1–1,000.");const id=uuid();await db.batch([db.prepare("INSERT INTO collection_plans(id,title,brief,quantity,status,created_at) VALUES(?,?,?,?,'planned',?)").bind(id,title,brief,quantity,Date.now()),log("collection.planned",id)]);return json({id,status:"planned"},201)}
 }
 const assetGet=path.match(/^assets\/([a-zA-Z0-9-]+)$/);
 if(assetGet&&method==="GET"){
  const row=await db.prepare("SELECT a.*,p.status FROM assets a JOIN products p ON p.id=a.product_id WHERE a.id=?").bind(assetGet[1]).first<any>();if(!row)return error("File not found.",404);
  const publicPreview=row.role.startsWith("preview_")&&row.status==="published";
  if(!publicPreview&&!user?.admin)return error("File not found.",404);
  const object=await env.FILES.get(row.object_key);if(!object)return error("File not found.",404);return new Response(object.body,{headers:{"content-type":row.mime,"cache-control":publicPreview?"public, max-age=3600":"private, no-store","x-content-type-options":"nosniff"}})
 }
 if(path==="account/orders"&&method==="GET"){if(!user)return error("Sign in to view your purchases.",401);const rows=await db.prepare("SELECT id,status,total_cents,currency,created_at,paid_at FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100").bind(user.id).all();return json({items:rows.results})}
 if(path==="favourites"){
  if(!user)return error("Sign in to save favourites.",401);
  if(method==="GET"){const rows=await db.prepare("SELECT p.*,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_front') preview_front,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_back') preview_back FROM favourites f JOIN products p ON p.id=f.product_id WHERE f.user_id=? AND p.status='published'").bind(user.id).all();return json({items:rows.results})}
  if(method==="POST"||method==="DELETE"){const b=await body(request);if(!validId(b.productId||""))throw new Error("Invalid artwork.");if(method==="POST"){const p=await db.prepare("SELECT id FROM products WHERE id=? AND status='published'").bind(b.productId).first();if(!p)return error("Artwork not found.",404);await db.prepare("INSERT OR IGNORE INTO favourites(id,user_id,product_id) VALUES(?,?,?)").bind(uuid(),user.id,b.productId).run()}else await db.prepare("DELETE FROM favourites WHERE user_id=? AND product_id=?").bind(user.id,b.productId).run();return json({ok:true})}
 }
 if(path.startsWith("downloads/")){if(!user)return error("Sign in to access purchases.",401);return error("No paid download entitlement is available. Checkout is not connected yet.",403)}
 return error("This route is not available.",404);
 }catch(e){console.error("printwear_api",{path,error:e instanceof Error?e.message:"unknown"});return error(e instanceof Error?e.message:"This action could not be completed.",400)}
}
