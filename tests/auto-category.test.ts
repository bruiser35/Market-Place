import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare} from 'miniflare';
import {autoCategory} from '../lib/auto-category';
import {readCategories} from '../lib/categories';
import type {VisualMetadata} from '../lib/bridge-contract';
test('AI categories are created, assigned and reused without duplicate customer categories',async()=>{
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("test")}}',compatibilityDate:'2026-05-01',d1Databases:['DB']});
 try{const db=await mf.getD1Database('DB') as unknown as D1Database;await db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER)');
 const artwork=()=>({category:'Typography',secondaryCategories:['Music & DJs'],themes:['Music'],subjects:['Headphones']} as VisualMetadata);
 const first=artwork();assert.deepEqual(await autoCategory(db,first),{category:'Music & DJs',created:true});assert.equal(first.category,'Music & DJs');
 const again=artwork();again.secondaryCategories=['music & djs'];assert.deepEqual(await autoCategory(db,again),{category:'Music & DJs',created:false});assert.equal((await readCategories(db)).filter(c=>c.toLowerCase()==='music & djs').length,1);
 const generic={category:'Animals',secondaryCategories:[],themes:[],subjects:['Dog']} as unknown as VisualMetadata;assert.equal((await autoCategory(db,generic)).category,'Animals');
 }finally{await mf.dispose()}
});
