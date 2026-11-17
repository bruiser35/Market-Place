/// <reference lib="webworker" />
import {runProductionRepair} from './production-repair-runner';
import {preparePrintableRaster} from './printable-cleanup';
import {decode,encode,convertIndexedToRgb} from "fast-png";
import {with300Dpi,type Raster} from "./artwork";
self.onmessage=async(event:MessageEvent)=>{
 try{
 const {bytes,mime,widthMm,heightMm,removeBackground}=event.data;let raster:Raster;
 const input=new Uint8Array(bytes);const isPng=input[0]===137&&input[1]===80;
 if(isPng){if(input.length<24)throw new Error("Invalid PNG.");const header=new DataView(input.buffer);if(header.getUint32(16)*header.getUint32(20)>25_000_000)throw new Error("PNG exceeds 25 megapixels.");const png=decode(input);if(png.depth!==8&&!png.palette)throw new Error("Use an 8-bit RGB or RGBA PNG for cleanup.");const pixels=png.palette?convertIndexedToRgb(png):png.data,channels=png.palette?png.palette[0].length:png.channels;const data=new Uint8ClampedArray(png.width*png.height*4);for(let p=0;p<png.width*png.height;p++){const i=p*channels,j=p*4;data[j]=pixels[i];data[j+1]=channels<3?pixels[i]:pixels[i+1];data[j+2]=channels<3?pixels[i]:pixels[i+2];data[j+3]=channels===2||channels===4?pixels[i+channels-1]:255;if(!png.palette&&png.transparency?.length&&Array.from(png.transparency).every((v,c)=>pixels[i+c]===v))data[j+3]=0}raster={width:png.width,height:png.height,data}}
 else {const bitmap=await createImageBitmap(new Blob([bytes],{type:mime}));if(bitmap.width*bitmap.height>25_000_000){bitmap.close();throw new Error("Image exceeds 25 megapixels.")}const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext("2d");if(!ctx)throw new Error("Image processing is unavailable.");ctx.drawImage(bitmap,0,0);raster={width:bitmap.width,height:bitmap.height,data:ctx.getImageData(0,0,bitmap.width,bitmap.height).data};bitmap.close()}
 const {raster:cleaned,report}=await preparePrintableRaster(raster,widthMm,heightMm,removeBackground,async cropped=>cropped,runProductionRepair);const output=with300Dpi(encode({...cleaned,channels:4,depth:8}));const marksData=new Uint8ClampedArray(raster.width*raster.height*4);
 for(let p=0;p<raster.width*raster.height;p++)if(raster.data[p*4+3]!==cleaned.data[p*4+3]){marksData[p*4]=255;marksData[p*4+1]=28;marksData[p*4+2]=28;marksData[p*4+3]=220}
 const marks=encode({width:raster.width,height:raster.height,data:marksData,channels:4,depth:8});
 self.postMessage({bytes:output.buffer,marks:marks.buffer,report},[output.buffer,marks.buffer]);
 }catch(e){self.postMessage({error:e instanceof Error?e.message:"Artwork processing failed."})}
};
