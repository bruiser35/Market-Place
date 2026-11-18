// Shared protocol v1. The sender carries an identical copy; secrets never enter browser code.
export const EMBEDDING_MODEL='text-embedding-3-small';
export const EMBEDDING_DIMENSIONS=256;
export const MAX_PNG_BYTES=24*1024*1024;
export const MAX_PIXELS=25_000_000;
export type ImportFile={dimensionBasis?:'canvas'|'visible';side:'front'|'back';sha256:string;bytes:number;widthMm:number;heightMm:number;nativeDpi:number;name:string};
export type ImportManifest={version:1;sourceSite:'https://prompttoprint.com.au';sourceId:string;sourceJobId:string;sourceCreatedAt:string|null;prompt:string;files:ImportFile[];rightsConfirmed:true};
export type VisualMetadata={title:string;description:string;category:string;secondaryCategories:string[];subjects:string[];objects:string[];styles:string[];primaryColours:string[];secondaryColours:string[];audience:string[];ageGroup:string|null;occasions:string[];moods:string[];themes:string[];keywords:string[];synonyms:string[];garments:string[];personalisation:string[];uncertainties:string[];qualityFlags:string[]};
export async function sha256(data:Uint8Array|string){const bytes=typeof data==='string'?new TextEncoder().encode(data):data;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function sourceIdFor(files:ImportFile[]){return 'ptp-'+await sha256(JSON.stringify([...files].sort((a,b)=>a.side.localeCompare(b.side)).map(({side,sha256,widthMm,heightMm,nativeDpi,dimensionBasis})=>({side,sha256,widthMm,heightMm,nativeDpi,...(dimensionBasis?{dimensionBasis}:{})}))))}
export function validateManifest(input:any):ImportManifest{
 if(input?.version!==1||input.sourceSite!=='https://prompttoprint.com.au'||input.rightsConfirmed!==true||!/^ptp-[a-f0-9]{64}$/.test(input.sourceId)||typeof input.sourceJobId!=='string'||input.sourceJobId.length>120||typeof input.prompt!=='string'||input.prompt.length>8000||!Array.isArray(input.files)||input.files.length<1||input.files.length>2)throw new Error('Invalid artwork manifest.');
 const seen=new Set();for(const f of input.files){if((f.dimensionBasis!==undefined&&!['canvas','visible'].includes(f.dimensionBasis))||!['front','back'].includes(f.side)||seen.has(f.side)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isInteger(f.bytes)||f.bytes<33||f.bytes>MAX_PNG_BYTES||!Number.isFinite(f.widthMm)||f.widthMm<1||f.widthMm>355||!Number.isFinite(f.heightMm)||f.heightMm<1||f.heightMm>550||!Number.isFinite(f.nativeDpi)||f.nativeDpi<=0||f.nativeDpi>10000||typeof f.name!=='string'||f.name.length>160)throw new Error('Invalid PNG size, dimensions, side or checksum.');seen.add(f.side)}
 if(input.sourceCreatedAt!==null&&(!/^\d{4}-\d{2}-\d{2}T/.test(input.sourceCreatedAt)||!Number.isFinite(Date.parse(input.sourceCreatedAt))))throw new Error('Invalid source creation date.');return input;
}
const arrays=['secondaryCategories','subjects','objects','styles','primaryColours','secondaryColours','audience','occasions','moods','themes','keywords','synonyms','garments','personalisation','uncertainties','qualityFlags'] as const;
export function validateMetadata(m:any):VisualMetadata{
 for(const k of ['title','description','category'])if(typeof m?.[k]!=='string'||!m[k].trim()||m[k].length>(k==='description'?2500:160))throw new Error('Missing or invalid artwork metadata.');
 for(const k of arrays)if(!Array.isArray(m[k])||m[k].length>40||m[k].some((v:unknown)=>typeof v!=='string'||v.length>180))throw new Error('Invalid structured metadata.');
 if(m.ageGroup!==null&&(typeof m.ageGroup!=='string'||m.ageGroup.length>100))throw new Error('Invalid age group.');return m;
}
export function validateVector(vector:unknown):number[]{if(!Array.isArray(vector)||vector.length!==EMBEDDING_DIMENSIONS||vector.some(v=>typeof v!=='number'||!Number.isFinite(v))||!vector.some(v=>v!==0))throw new Error('Invalid semantic embedding.');return vector}
export function searchDocument(m:VisualMetadata){return [m.title,m.description,m.category,...arrays.filter(k=>k!=='uncertainties'&&k!=='qualityFlags').flatMap(k=>m[k]),m.ageGroup||''].join('\n').slice(0,12000)}
export function safeEqual(a:string,b:string){let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0}
export async function bridgeHeaders(secret:string,method:string,path:string,digest:string,now=Date.now()){
 if(secret.length<32)throw new Error('The artwork bridge secret is not configured.');const timestamp=String(Math.floor(now/1000));const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${timestamp}\n${method}\n${path}\n${digest}`)))].map(v=>v.toString(16).padStart(2,'0')).join('');return {'x-printwear-timestamp':timestamp,'x-printwear-content-sha256':digest,'x-printwear-signature':signature};
}
export async function authenticateBridge(request:Request,secret:string,now=Date.now()){
 const timestamp=request.headers.get('x-printwear-timestamp')||'',digest=request.headers.get('x-printwear-content-sha256')||'',signature=request.headers.get('x-printwear-signature')||'';
 if(secret.length<32||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||!/^[a-f0-9]{64}$/.test(digest)||!/^[a-f0-9]{64}$/.test(signature))return false;
 const expected=await bridgeHeaders(secret,request.method,new URL(request.url).pathname,digest,Number(timestamp)*1000);return safeEqual(expected['x-printwear-signature'],signature);
}
export async function limitedBody(request:Request,limit:number){if(Number(request.headers.get('content-length')||0)>limit)throw new Error('Request exceeds the upload limit.');if(!request.body)return new Uint8Array();const reader=request.body.getReader(),chunks:Uint8Array[]=[];let count=0;try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>limit){await reader.cancel();throw new Error('Request exceeds the upload limit.')}chunks.push(value)}}finally{reader.releaseLock()}const data=new Uint8Array(count);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length}return data}
