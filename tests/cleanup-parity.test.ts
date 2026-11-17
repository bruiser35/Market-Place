import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {cleanRaster} from '../lib/artwork';

test('cleanup pixels and removal counts match the real Prompt to Print repair across small and standard profiles',{skip:!process.env.PTP_PROJECT_DIR},async()=>{
 const {repairArtwork}=await import(pathToFileURL(resolve(process.env.PTP_PROJECT_DIR!,'app/artwork-processing.ts')).href);
 const prior={document:(globalThis as any).document,Image:(globalThis as any).Image,ImageData:(globalThis as any).ImageData,fetch:globalThis.fetch};
 const w=300,h=200;let original:Uint8ClampedArray,saved=new Map<string,Uint8ClampedArray>(),seq=0;
 (globalThis as any).Image=class{naturalWidth=w;naturalHeight=h;onload?:()=>void;set src(_v:string){queueMicrotask(()=>this.onload?.())}};
 (globalThis as any).ImageData=class{constructor(public data:Uint8ClampedArray,public width:number,public height:number){}};
 (globalThis as any).document={createElement(){const c:any={width:0,height:0,data:null};const ctx={drawImage(){c.data=original.slice()},getImageData(){return {data:c.data}},putImageData(p:any){c.data=p.data.slice()},createImageData(width:number,height:number){return {data:new Uint8ClampedArray(width*height*4)}}};c.getContext=()=>ctx;c.toDataURL=()=>{const id='capture:'+seq++;saved.set(id,c.data.slice());return id};return c}};
 globalThis.fetch=async()=>{throw Error('Local cleanup must not make network requests')};
 try{
  for(const mm of [48,60,60.1,120]){
   original=new Uint8ClampedArray(w*h*4);const put=(x:number,y:number,alpha=255)=>original.set([210,30,60,alpha],(y*w+x)*4);
   for(let y=60;y<140;y++)for(let x=80;x<220;x++)put(x,y);
   // Remote specks, nearby punctuation, a nub, a curve and transparent holes.
   put(10,10);put(78,64);put(120,59);
   for(let y=80;y<90;y++)for(let x=100;x<110;x++)original.fill(0,(y*w+x)*4,(y*w+x)*4+4);
   for(const [i,a] of [35,60,95,96,120,159,160,200,255].entries())put(100+i,100,a);
   const source={width:w,height:h,data:original},before=original.slice(),expected=await repairArtwork('fixture',mm,h*mm/w),actual=cleanRaster(source,mm,false);
   assert.deepEqual(actual.raster.data,saved.get(expected.repaired),`pixel parity at ${mm} mm`);
   assert.equal(actual.report.cleanup?.haze,expected.haze);assert.equal(actual.report.cleanup?.specks,expected.specks);assert.equal(actual.report.cleanup?.edges,expected.edges);assert.deepEqual(source.data,before);
   assert.equal(actual.report.cleanup?.haloThreshold,mm<=60?96:160);
   saved.clear();
  }
 }finally{Object.assign(globalThis,prior)}
});

test('vendored production repair function stays verbatim equal to inspected PTP source',{skip:!process.env.PTP_PROJECT_DIR},async()=>{const source=await readFile(resolve(process.env.PTP_PROJECT_DIR!,'app/artwork-processing.ts'),'utf8'),vendored=await readFile(new URL('../lib/ptp-production-repair.ts',import.meta.url),'utf8');const body=source.slice(source.indexOf('export async function repairArtwork('),source.indexOf('export async function applyGarmentColourKnockout('));assert.equal(vendored.slice(vendored.indexOf('export async function repairArtwork(')),body)});
