import {encode} from 'fast-png';
import {repairArtwork} from './ptp-production-repair';
import {inspectArtwork,type Raster} from './artwork';
// Browser-worker adapter for the unchanged production routine. Canvas operations
// remain real OffscreenCanvas operations, including alpha premultiplication.
export async function runProductionRepair(r:Raster,widthMm:number,heightMm:number){
 const encoded=encode({...r,channels:4,depth:8}),bitmap=await createImageBitmap(new Blob([encoded as BlobPart],{type:'image/png'}));
 const saved=new Map<string,Raster>();let sequence=0;
 const scope=globalThis as any,previous={Image:scope.Image,document:scope.document};
 class WorkerImage{naturalWidth=r.width;naturalHeight=r.height;native=bitmap;onload?:()=>void;set src(_value:string){queueMicrotask(()=>this.onload?.())}}
 class WorkerCanvas{native=new OffscreenCanvas(1,1);get width(){return this.native.width}set width(v:number){this.native.width=v}get height(){return this.native.height}set height(v:number){this.native.height=v}
  getContext(){const ctx=this.native.getContext('2d',{willReadFrequently:true})!;return new Proxy(ctx,{get(target,key){if(key==='drawImage')return (image:any,...args:any[]) => (target.drawImage as any)(image.native||image,...args);const value=(target as any)[key];return typeof value==='function'?value.bind(target):value},set(target,key,value){(target as any)[key]=value;return true}})}
  toDataURL(){const image=this.native.getContext('2d')!.getImageData(0,0,this.width,this.height),key='production-repair:'+sequence++;saved.set(key,{width:this.width,height:this.height,data:image.data});return key}
 }
 scope.Image=WorkerImage;scope.document={createElement:()=>new WorkerCanvas()};
 try{const result=await repairArtwork('worker-source',widthMm,heightMm),raster=saved.get(result.repaired);if(!raster)throw new Error('Production cleanup did not return repaired pixels.');const report=inspectArtwork(raster,widthMm,result.haze+result.specks+result.edges,false,heightMm),small=widthMm<=60&&heightMm<=60;report.cleanup={profile:small?'Prompt to Print · small artwork':'Prompt to Print · standard artwork',haloThreshold:small?96:160,speckLimitMm:small?1.25:.8,haze:result.haze,specks:result.specks,edges:result.edges,backdrop:0};return {raster,report}}finally{scope.Image=previous.Image;scope.document=previous.document;bitmap.close()}
}
