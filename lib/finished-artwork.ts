import {inspectPng} from './png-inspection';
import type {Quality} from './artwork';
// Intake only: inspect the PTP-finished PNG, then return the exact original bytes.
// No cleanup, cropping, alpha edits, resampling or PNG metadata rewrite here.
export async function inspectFinishedArtwork(bytes:Uint8Array,widthMm:number,heightMm?:number):Promise<{bytes:Uint8Array;report:Quality}>{
 if(bytes.length>32*1024*1024)throw new Error('The finished PNG exceeds 32 MB.');
 if(!Number.isFinite(widthMm)||widthMm<=0||widthMm>355)throw new Error('Choose a print canvas width from 1 to 355 mm.');
 if(bytes.length<24||![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b))throw new Error('Clean this image in Prompt to Print first, then upload its finished transparent PNG. ZIP files containing finished PNGs are supported.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),width=view.getUint32(16),height=view.getUint32(20),targetHeight=heightMm??height*widthMm/width;
 if(!Number.isFinite(targetHeight)||targetHeight<=0||targetHeight>550)throw new Error('Choose a print canvas height from 1 to 550 mm.');
 const nativeDpi=Math.min(width*25.4/widthMm,height*25.4/targetHeight);
 const {report}=await inspectPng(bytes,widthMm,targetHeight,nativeDpi,{watermark:false,maxEdge:1,dimensionBasis:'canvas'});
 return {bytes,report:{...report,changedPixels:0,removedBackdrop:false,version:'ptp-finished-png-intake-v1',dimensionBasis:'canvas'}};
}
