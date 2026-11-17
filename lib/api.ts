import {readCategories,addCategory} from './categories';
import {validEtsyPath,ETSY_TAXONOMY} from './etsy-taxonomy-data';
import {inspectPng} from './png-inspection';
import {publicationQuality} from './publication-quality';
import {identity,sameOrigin} from "./auth";
import {CATEGORIES,DEFAULT_GUIDELINES,DEFAULT_PRICES,cleanText,parsePrice,validId} from "./catalogue";
import {receiveDesign} from './design-imports';
import {semanticResults,rateLimit,indexProduct,indexStatements,queryEmbedding} from './semantic-search';
import {validateMetadata,searchDocument,sha256} from './bridge-contract';
import {analyseProduct} from './analyse-product';
import {approvedCategories,categorySuggestions,CATEGORY_FILTER} from './category-approval';
export type Bindings={DB:D1Database;FILES:R2Bucket;ADMIN_EMAILS?:string;PRINTWEAR_IMPORT_SECRET?:string;PTP_EMBEDDING_URL?:string;PRINTWEAR_METADATA_MODEL?:string;PRINTWEAR_AI_REQUESTS_PER_DAY?:string;PRINTWEAR_ANALYSES_PER_DAY?:string};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
const error=(message:string,status=400)=>json({error:message},status);
const uuid=()=>crypto.randomUUID();
async function body(request:Request){if(Number(request.headers.get("content-length")||0)>32000)throw new Error("Request is too large.");const text=await request.text();if(text.length>32000)throw new Error("Request is too large.");return JSON.parse(text)}
export async function handleApi(request:Request,env:Bindings):Promise<Response>{
 const url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,""),method=request.method;
 const user=identity(request,env.ADMIN_EMAILS||"");
 const db=env.DB;
 if(path==='admin/design-imports'||path.startsWith('admin/design-imports/'))return receiveDesign(request,env);
 if(!["GET","HEAD"].includes(method)&&!sameOrigin(request))return error("This request must come from PrintWear.",403);
 if(path==="session"&&method==="GET")return json({user,paymentsEnabled:false,searchMode:env.PTP_EMBEDDING_URL?'semantic':'catalogue'});
 if(path==="health"&&method==="GET"){try{await db.prepare("SELECT key FROM settings LIMIT 1").first();return json({status:"ok",database:true,storage:!!env.FILES,paymentsEnabled:false})}catch{return error("Database setup is not complete.",503)}}
 if(path==="checkout")return error("PayPal is not connected yet. No payment has been taken.",503);
 if(path.startsWith("admin/")&&!user?.admin)return error("Administrator access is required.",403);
 const log=(action:string,id?:string)=>db.prepare("INSERT INTO audit_log(id,actor,action,entity_id,created_at) VALUES(?,?,?,?,?)").bind(uuid(),user!.id,action,id||null,Date.now());
 const settings=async()=>{const rows=await db.prepare("SELECT key,value FROM settings").all<{key:string;value:string}>();const stored=Object.fromEntries(rows.results.map(r=>[r.key,r.value]));return {categories:stored.categories?JSON.parse(stored.categories):CATEGORIES,prices:stored.prices?JSON.parse(stored.prices):DEFAULT_PRICES,guidelines:stored.guidelines||DEFAULT_GUIDELINES}};
 try{
 if(path==="settings"&&method==="GET"){const s=await settings();return json({categories:s.categories,prices:s.prices,currency:"AUD",paymentsEnabled:false})}
 if(path==='admin/categories'&&method==='POST'){const b=await body(request),categories=await addCategory(db,b.name);await log('category.created').run();return json({categories},201)}
 if(path==="admin/settings"){
  if(method==="GET")return json(await settings());
  if(method==="PUT"){const b=await body(request);const pairs:Array<[string,string]>=[];if(b.prices){const prices={single:parsePrice(b.prices.single),pair:parsePrice(b.prices.pair),bundle:parsePrice(b.prices.bundle)};pairs.push(["prices",JSON.stringify(prices)])}if(b.guidelines!==undefined){const text=cleanText(b.guidelines,12000);if(!text)throw new Error("Guidelines cannot be empty.");pairs.push(["guidelines",text])}if(!pairs.length)throw new Error("Choose settings to update.");await db.batch([...pairs.map(([k,v])=>db.prepare("INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(k,v,Date.now())),log("settings.updated")]);return json({ok:true})}
 }
 if((path==="products"&&method==="GET")||(path==='search'&&method==='POST')){
  const input=method==='POST'?await body(request):Object.fromEntries(url.searchParams);const params=new URLSearchParams(Object.entries(input).filter(([,v])=>typeof v==='string'||typeof v==='number').map(([k,v])=>[k,String(v)]));
  const q=(params.get("q")||"").trim().slice(0,300),category=params.get("category")||"All artwork",type=params.get("type")||"all",page=Math.floor(Math.max(1,Math.min(10000,Number(params.get("page"))||1)));
  const words=q.toLowerCase().replace(/[.,!?]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['t-shirt','t-shirts','tee','tees','digital','image','images','print','show','find','want','with','some','design','designs','artwork','prints','looking','please','shirt','that','the','and','for'].includes(w)).slice(0,8).map(w=>w.slice(0,40));
  const clauses=["p.status='published'"];const args:unknown[]=[];
  if(category!=="All artwork"){clauses.push(CATEGORY_FILTER);args.push(category,category)}if(type!=="all"){clauses.push("p.type=?");args.push(type)}
  let semantic:Array<{id:string;score:number}>=[],mode='keyword',searchNotice:string|null=null;
  if(path==='search'&&q&&env.PTP_EMBEDDING_URL){
   const key=await sha256(user?.id||request.headers.get('cf-connecting-ip')||'anonymous');
   if(!await rateLimit(db,'search:'+key.slice(0,20),20)||!await rateLimit(db,'search:global',60))return error('Search is busy. Try again in a minute.',429);
   try{semantic=await semanticResults(env,q,{category,type})||[];mode='semantic'}catch{searchNotice='AI search is temporarily unavailable. Showing keyword matches.'}
  }
  const text="lower(p.title||' '||p.description||' '||p.tags||' '||coalesce((SELECT search_text FROM artwork_metadata m WHERE m.product_id=p.id),''))";
  const matches:string[]=[];for(const word of words){matches.push(`${text} LIKE ? ESCAPE '\\'`);args.push('%'+word.replace(/[\\%_]/g,"\\$&")+'%')}
  if(semantic.length){matches.push(`p.id IN (${semantic.map(()=>'?').join(',')})`);args.push(...semantic.map(r=>r.id))}
  if(matches.length)clauses.push('('+matches.join(' OR ')+')');
  const where=clauses.join(" AND ");const select=`SELECT p.*,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_front') preview_front,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_back') preview_back FROM products p WHERE ${where}`;
  const sort=params.get('sort'),rank=semantic.length?'CASE p.id '+semantic.map(r=>`WHEN '${r.id}' THEN ${Number(r.score).toFixed(6)}`).join(' ')+' ELSE 0 END DESC,':'';const order=sort==='low'?'p.price_cents ASC,p.updated_at DESC':sort==='high'?'p.price_cents DESC,p.updated_at DESC':rank+'p.updated_at DESC';
  const [items,total]=await Promise.all([db.prepare(select+` ORDER BY ${order} LIMIT 24 OFFSET ?`).bind(...args,(page-1)*24).all(),db.prepare(`SELECT count(*) count FROM products p WHERE ${where}`).bind(...args).first<{count:number}>()]);return json({items:items.results,total:total?.count||0,page,mode,notice:searchNotice})
 }
 const productMatch=path.match(/^products\/([a-zA-Z0-9-]+)$/);
 if(productMatch&&method==="GET"){const row=await db.prepare("SELECT * FROM products WHERE id=? AND status='published'").bind(productMatch[1]).first();if(!row)return error("Artwork not found.",404);const a=await db.prepare("SELECT id,role,width,height FROM assets WHERE product_id=? AND role LIKE 'preview_%'").bind(productMatch[1]).all();return json({product:row,assets:a.results})}
 if(path==="admin/summary"&&method==="GET"){
 const [p,a,o,plans]=await Promise.all([db.prepare("SELECT status,count(*) count FROM products GROUP BY status").all(),db.prepare("SELECT count(*) count,coalesce(sum(size),0) bytes FROM assets").first(),db.prepare("SELECT count(*) count,coalesce(sum(total_cents),0) revenue FROM orders WHERE status='paid'").first(),db.prepare("SELECT * FROM collection_plans ORDER BY created_at DESC LIMIT 20").all()]);return json({products:p.results,assets:a,orders:o,plans:plans.results,paymentsEnabled:false})}
 if(path==="admin/products"){
  if(method==="GET"){const ids=(url.searchParams.get('ids')||'').split(',').filter(Boolean);if(ids.length>100||ids.some(id=>!validId(id)))throw new Error('Choose up to 100 valid product IDs for batch review.');const query="SELECT p.*,(SELECT metadata_json FROM artwork_metadata m WHERE m.product_id=p.id) metadata_json,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_front') preview_front,(SELECT id FROM assets a WHERE a.product_id=p.id AND a.role='preview_back') preview_back FROM products p WHERE p.status<>'deleted'"+(ids.length?' AND p.id IN ('+ids.map(()=>'?').join(',')+')':'')+" ORDER BY updated_at DESC LIMIT 200";const rows=await db.prepare(query).bind(...ids).all();return json({items:rows.results})}
  if(method==="POST"){const b=await body(request),title=cleanText(b.title,150),category=cleanText(b.category,80),type=cleanText(b.type,10);if(!title||!(await readCategories(db)).slice(1).includes(category)||!["single","pair","bundle"].includes(type))throw new Error("Choose a title, category and product format.");const id=uuid(),now=Date.now();await db.batch([db.prepare("INSERT INTO products(id,title,description,category,type,price_cents,tags,status,quality,rights_confirmed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'draft','pending',0,?,?)").bind(id,title,cleanText(b.description,2500),category,type,parsePrice(b.priceCents),cleanText(b.tags,500),now,now),log("product.created",id)]);return json({id},201)}
 }
 const adminProduct=path.match(/^admin\/products\/([a-zA-Z0-9-]+)$/);
 const analysisMatch=path.match(/^admin\/products\/([a-zA-Z0-9-]+)\/analyse$/);
 if(analysisMatch&&method==='POST'){const b=await body(request);return json(await analyseProduct(env,analysisMatch[1],cleanText(b.prompt,8000),url.origin))}
 if(adminProduct){const id=adminProduct[1],p=await db.prepare("SELECT * FROM products WHERE id=?").bind(id).first<any>();if(!p)return error("Draft not found.",404);
  if(method==="GET"){const a=await db.prepare("SELECT * FROM assets WHERE product_id=? ORDER BY role").bind(id).all();const m=await db.prepare('SELECT metadata_json FROM artwork_metadata WHERE product_id=?').bind(id).first<{metadata_json:string}>();return json({product:p,assets:a.results,metadata:m?JSON.parse(m.metadata_json):null})}
  if(method==="PATCH"){const b=await body(request);if(b.action==="archive"){await db.batch([db.prepare("UPDATE products SET status='archived',updated_at=? WHERE id=?").bind(Date.now(),id),log("product.archived",id)]);return json({ok:true})}
   if(b.action==='delete'){
    if(p.status!=='draft')return error('Only unpublished drafts can be deleted here.',409);
    const removed=await db.batch([db.prepare("UPDATE products SET status='deleted',updated_at=? WHERE id=? AND status='draft' AND updated_at=? AND NOT EXISTS(SELECT 1 FROM bridge_rate_limits WHERE key=? AND window>?)").bind(Math.max(Date.now(),p.updated_at+1),id,b.updatedAt,'analysis:'+id,Date.now()),log('product.trash_requested',id)]);if(!removed[0].meta.changes)return error('The draft changed or analysis is still running. Reopen it before deleting.',409);return json({ok:true,trashed:true,filesRetained:true});
   }
   if(b.action==='categories'){
    if(p.status!=='draft')return error('Only unpublished drafts can be categorised.',409);
    const selected=approvedCategories(b.categories,await readCategories(db));
    const active=await db.prepare('SELECT window FROM bridge_rate_limits WHERE key=?').bind('analysis:'+id).first<{window:number}>();if(active&&active.window>Date.now())return error('Wait for artwork analysis to finish.',409);
    if(b.updatedAt!==p.updated_at)return error('The draft changed. Reopen it before approving categories.',409);
    const row=await db.prepare('SELECT metadata_json FROM artwork_metadata WHERE product_id=?').bind(id).first<{metadata_json:string}>();if(!row)throw new Error('Analyse this artwork before approving categories.');
    if(b.etsyPath!==undefined&&b.etsyPath!==''&&!validEtsyPath(b.etsyPath))throw new Error('Choose a category from the verified Etsy list.');
    const old=JSON.parse(row.metadata_json),now=Math.max(Date.now(),p.updated_at+1);
    const metadata={...old,...(b.etsyPath===undefined?{}:{etsySelectedPath:b.etsyPath||null,etsyTaxonomySource:ETSY_TAXONOMY.source,etsyTaxonomyCheckedAt:ETSY_TAXONOMY.retrievedAt}),suggestedCategories:categorySuggestions(old,await readCategories(db)),category:selected[0],secondaryCategories:selected.slice(1),approvedCategories:selected,categoriesApprovedAt:new Date(now).toISOString()};
    const changes=await db.batch([db.prepare("UPDATE products SET category=?,price_cents=?,updated_at=? WHERE id=? AND status='draft' AND updated_at=? AND NOT EXISTS(SELECT 1 FROM bridge_rate_limits WHERE key=? AND window>?)").bind(selected[0],b.priceCents===undefined?p.price_cents:parsePrice(b.priceCents),now,id,p.updated_at,'analysis:'+id,Date.now()),db.prepare('UPDATE artwork_metadata SET metadata_json=?,search_text=?,updated_at=? WHERE product_id=? AND EXISTS(SELECT 1 FROM products WHERE id=? AND updated_at=?)').bind(JSON.stringify(metadata),searchDocument(metadata),now,id,id,now),log('categories.approved',id)]);
    if(!changes[0].meta.changes)return error('The draft changed. Reopen it before approving categories.',409);
    return json({ok:true,categories:selected,draftOnly:true});
   }
   if(b.action==='metadata'){
    const active=await db.prepare('SELECT window FROM bridge_rate_limits WHERE key=?').bind('analysis:'+id).first<{window:number}>();if(active&&active.window>Date.now())return error('Wait for artwork analysis to finish.',409);
    if(p.status!=='draft')return error('Only unpublished drafts can be edited.',409);
    const supplied=validateMetadata(b.metadata);if(!(await readCategories(db)).slice(1).includes(supplied.category))throw new Error('Choose an existing main category.');
    const previous=await db.prepare('SELECT metadata_json FROM artwork_metadata WHERE product_id=?').bind(id).first<{metadata_json:string}>();const old=previous?JSON.parse(previous.metadata_json):{};
    const allowed=['title','description','category','secondaryCategories','subjects','objects','styles','primaryColours','secondaryColours','audience','ageGroup','occasions','moods','themes','keywords','synonyms','garments','personalisation','uncertainties','qualityFlags'];const metadata={...old,...Object.fromEntries(allowed.map(k=>[k,(supplied as any)[k]]))};
    if(metadata.category!==old.category||JSON.stringify(metadata.secondaryCategories)!==JSON.stringify(old.secondaryCategories)){delete metadata.approvedCategories;delete metadata.categoriesApprovedAt;}
    const document=searchDocument(metadata),vector=await queryEmbedding(env,document),now=Date.now();
    await db.batch([db.prepare('UPDATE products SET title=?,description=?,category=?,tags=?,price_cents=?,updated_at=? WHERE id=?').bind(metadata.title,metadata.description,metadata.category,[...metadata.keywords,...metadata.synonyms].join(', ').slice(0,500),b.priceCents===undefined?p.price_cents:parsePrice(b.priceCents),now,id),db.prepare('INSERT INTO artwork_metadata(product_id,metadata_json,search_text,received_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET metadata_json=excluded.metadata_json,search_text=excluded.search_text,updated_at=excluded.updated_at').bind(id,JSON.stringify(metadata),document,now,now),...indexStatements(db,id,vector,await sha256(document)),log('metadata.updated',id)]);return json({ok:true});
   }
   if(b.action==="publish"){
    const active=await db.prepare('SELECT window FROM bridge_rate_limits WHERE key=?').bind('analysis:'+id).first<{window:number}>();if(active&&active.window>Date.now())return error('Wait for artwork analysis to finish before approval.',409);
    if(!b.reviewed||!b.ownOriginal)throw new Error("Confirm visual review and original artwork ownership.");
    const {results:a}=await db.prepare("SELECT role,width,height,report_json FROM assets WHERE product_id=?").bind(id).all<any>();
    const sides=p.type==="pair"?["front","back"]:p.type==="single"?a.some(x=>x.role==="front")?["front"]:["back"]:[];
    if(!sides.length)throw new Error("Bundle publication will be enabled with the first verified bundle.");
    let lowDpi=false;for(const side of sides){const file=a.find(x=>x.role===side),preview=a.find(x=>x.role===`preview_${side}`),source=a.find(x=>x.role===`source_${side}`);if(!file||!preview||!source)throw new Error(`Missing ${side} master, cleaned PNG or preview.`);const r=JSON.parse(file.report_json);const checked=publicationQuality(r);if(checked.blocked)throw new Error(`The ${side} artwork needs quality review. Low DPI alone does not block approval.`);lowDpi ||= checked.lowDpi}
    const attached=await db.prepare('SELECT metadata_json FROM artwork_metadata WHERE product_id=?').bind(id).first<{metadata_json:string}>();if(attached&&!JSON.parse(attached.metadata_json).categoriesApprovedAt)throw new Error('Approve the artwork category checkboxes before catalogue publication.');if(attached&&JSON.parse(attached.metadata_json).qualityFlags?.length)throw new Error('Review and resolve the AI image-check flags before approval.');if(env.PTP_EMBEDDING_URL){if(!attached)throw new Error('Run AI Catalogue analysis and review the saved metadata before approval.');await indexProduct(env,p,JSON.parse(attached.metadata_json))}
    if(p.status==='published')return json({ok:true,alreadyPublished:true});
    const approvedAt=Math.max(Date.now(),p.updated_at+1);const committed=await db.batch([db.prepare("UPDATE products SET status='published',quality=?,rights_confirmed=1,updated_at=? WHERE id=? AND status='draft' AND updated_at=? AND NOT EXISTS(SELECT 1 FROM bridge_rate_limits WHERE key=? AND window>?)").bind(lowDpi?'approved_low_dpi':'approved',approvedAt,id,p.updated_at,'analysis:'+id,Date.now()),log("product.approval_requested",id)]);if(!committed[0].meta.changes)return error('The draft changed during review. Reopen it before approving.',409);await log(lowDpi?'product.approved_low_dpi':'product.approved',id).run();return json({ok:true,lowDpiWarning:lowDpi})
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
  if(url.searchParams.get('transparent')==='1'&&row.role.startsWith('preview_')){
   const side=row.role.slice('preview_'.length);if(!['front','back'].includes(side))return error('Preview not found.',404);
   const production=await db.prepare('SELECT object_key,sha256,report_json FROM assets WHERE product_id=? AND role=?').bind(row.product_id,side).first<any>();if(!production)return error('Cleaned artwork preview is unavailable.',404);
   const small=url.searchParams.get('detail')==='small',edge=small?320:1440;const key=`display-previews/transparent-area-v2/${production.sha256}-${edge}.png`;let cached=await env.FILES.get(key);
   if(!cached){const master=await env.FILES.get(production.object_key);if(!master)return error('Cleaned artwork preview is unavailable.',404);const dimensions=JSON.parse(production.report_json);const {preview}=await inspectPng(new Uint8Array(await master.arrayBuffer()),dimensions.widthMm,dimensions.heightMm,dimensions.dpi,{maxEdge:edge,transparentBackground:true,watermarkOpacity:small?.18:.45,dimensionBasis:dimensions.dimensionBasis});await env.FILES.put(key,preview,{httpMetadata:{contentType:'image/png'}});cached=await env.FILES.get(key)}
   if(!cached)return error('Preview could not be generated.',503);return new Response(cached.body,{headers:{'content-type':'image/png','cache-control':publicPreview?'public, max-age=3600':'private, no-store','x-content-type-options':'nosniff'}});
  }
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
