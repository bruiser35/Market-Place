import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encode,decode} from 'fast-png';
import {with300Dpi} from '../lib/artwork';
import {inspectFinishedArtwork} from '../lib/finished-artwork';
import {inspectPng} from '../lib/png-inspection';
test('PTP-finished intake preserves the exact PNG bytes, white outlines and intentional alpha',async()=>{
 const width=128,height=128,data=new Uint8Array(width*height*4);for(let y=20;y<108;y++)for(let x=20;x<108;x++)data.set(x===20||x===107||y===20||y===107?[255,255,255,255]:[20,30,40,255],(y*width+x)*4);data.set([255,255,255,120],(40*width+19)*4);
 const bytes=with300Dpi(encode({width,height,data,channels:4,depth:8})),before=bytes.slice(),result=await inspectFinishedArtwork(bytes,width*25.4/300);
 assert.deepEqual(result.bytes,before);assert.equal(result.report.changedPixels,0);assert.equal(result.report.dimensionBasis,'canvas');assert.equal(result.report.dpi,300);assert.equal(result.report.heightMm,width*25.4/300);assert.deepEqual(decode(result.bytes).data,data);
});
test('area-filtered transparent previews retain a one-pixel white outline that point sampling misses',async()=>{
 const width=1000,height=1000,data=new Uint8Array(width*height*4);for(let y=200;y<800;y++)for(let x=500;x<=700;x++)data.set(x===500||x===700?[255,255,255,255]:[0,0,0,255],(y*width+x)*4);
 const bytes=with300Dpi(encode({width,height,data,channels:4,depth:8})),before=bytes.slice();const result=await inspectPng(bytes,80,80,317,{watermark:false,maxEdge:100,transparentBackground:true,dimensionBasis:'canvas'}),out=decode(result.preview),edge=(50*100+50)*4;
 assert.ok(out.data[edge]>0&&out.data[edge]<255,'the thin white outline contributes to the reduced pixel');assert.equal(out.data[edge+3],255);assert.equal(out.data[(50*100+49)*4+3],0);assert.deepEqual(bytes,before,'preview generation never modifies the production PNG');
});
test('non-PNG uploads are directed to Prompt to Print instead of being reprocessed locally',async()=>{await assert.rejects(()=>inspectFinishedArtwork(new Uint8Array([255,216,255]),300),/Prompt to Print first/)});
