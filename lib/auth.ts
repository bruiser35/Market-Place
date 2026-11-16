export type Identity={id:string;email:string;name:string;admin:boolean};
export function identity(request:Request,adminEmails:string):Identity|null{
 const id=request.headers.get("oai-authenticated-user-id"),email=request.headers.get("oai-authenticated-user-email");
 if(!id||!email)return null;
 let name=request.headers.get("oai-authenticated-user-full-name")||email.split("@")[0];
 if(request.headers.get("oai-authenticated-user-full-name-encoding")==="percent-encoded-utf-8")try{name=decodeURIComponent(name)}catch{}
 return {id,email,name,admin:adminEmails.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase())};
}
export function sameOrigin(request:Request){return request.headers.get("origin")===new URL(request.url).origin}
