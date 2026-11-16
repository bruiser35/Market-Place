import {env} from "cloudflare:workers";
import {handleApi,type Bindings} from "@/lib/api";
export const runtime="edge";
export const dynamic="force-dynamic";
const handle=(request:Request)=>handleApi(request,env as unknown as Bindings);
export {handle as GET,handle as POST,handle as PUT,handle as PATCH,handle as DELETE};
