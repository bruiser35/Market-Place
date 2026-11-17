import handler from "vinext/server/app-router-entry";
export default {async fetch(request:Request, env:Parameters<typeof handler.fetch>[1], ctx:Parameters<typeof handler.fetch>[2]){
  const response=await handler.fetch(request,env,ctx);
  const secured=new Response(response.body,response);
  secured.headers.set("X-Content-Type-Options","nosniff");
  secured.headers.set("Referrer-Policy","strict-origin-when-cross-origin");
  secured.headers.set("Permissions-Policy","camera=(), microphone=(self), geolocation=()");
  if(new URL(request.url).pathname.startsWith("/api/"))secured.headers.set("Cache-Control","private, no-store");
  return secured;
}};
