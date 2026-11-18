/// <reference lib="webworker" />
import {inspectFinishedArtwork} from './finished-artwork';
// Prompt to Print owns cleanup. PrintWear validates and saves its finished PNG.
self.onmessage=async(event:MessageEvent)=>{
 try{const {bytes,widthMm,heightMm}=event.data,input=new Uint8Array(bytes);const result=await inspectFinishedArtwork(input,widthMm,heightMm);self.postMessage({bytes:result.bytes.buffer,report:result.report},[result.bytes.buffer])}
 catch(e){self.postMessage({error:e instanceof Error?e.message:'The finished PNG could not be read.'})}
};
