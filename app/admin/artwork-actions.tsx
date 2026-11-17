"use client";
import {useState} from 'react';
import {api} from '@/lib/client';
export default function ArtworkActions({id,title,categories,onChanged,disabled=false}:{id:string;title:string;categories:string[];onChanged:()=>void;disabled?:boolean}){
 const [destination,setDestination]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function change(action:'move'|'delete'){
  setBusy(true);setError('');try{const snapshot=await api(`admin/products/${id}`);await api(`admin/products/${id}`,{method:'PATCH',body:JSON.stringify({action,updatedAt:snapshot.product.updated_at,...(action==='move'?{category:destination}:{})})});onChanged()}catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 return <div className="artwork-admin-actions"><details><summary>Manage artwork</summary><p>Admin only · {title}</p><label>Move to category<select className="field" aria-label={`Move ${title} to category`} value={destination} disabled={busy||disabled} onChange={e=>setDestination(e.target.value)}><option value="">Choose category</option>{categories.filter(c=>c!=='All artwork').map(c=><option key={c}>{c}</option>)}</select></label><button type="button" className="button secondary" disabled={busy||disabled||!destination} onClick={()=>void change('move')}>Move image</button><details><summary>Delete image</summary><p>Remove this listing from the catalogue. Its original files and purchase history are retained in private trash.</p><button type="button" className="button secondary" disabled={busy||disabled} onClick={()=>void change('delete')}>Delete from catalogue</button></details></details>{error&&<p className="error-message" role="alert">{error}</p>}</div>
}
