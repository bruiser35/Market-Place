import {encode} from 'fast-png';
import {MAX_PIXELS} from './bridge-contract';
import {crc32} from './artwork';
export type PngReport={width:number;height:number;visibleWidth:number;visibleHeight:number;transparentPixels:number;visiblePixels:number;dpi:number;widthMm:number;heightMm:number;metadataDpi:number|null;ready:boolean;issues:string[];version:string;dimensionBasis?:'canvas'|'visible'};
const FONT:Record<string,string>={P:'11110100011000111110100001000010000',R:'11110100011000111110101001001010001',I:'11111001000010000100001000010011111',N:'10001110011010110011100011000110001',T:'11111001000010000100001000010000100',W:'10001100011000110101101011101110001',E:'11111100001000011110100001000011111',A:'01110100011000111111100011000110001'};
// Scanline decoding keeps only two rows, a small thumbnail and compressed input.
// No full-resolution RGBA allocation inside the 128 MB Worker isolate.
export async function inspectPng(bytes:Uint8Array,widthMm:number,heightMm:number,nativeDpi:number,options:{watermark?:boolean;maxEdge?:number;transparentBackground?:boolean;dimensionBasis?:'canvas'|'visible';watermarkOpacity?:number}={}){
 if(![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))throw new Error('Artwork must be a real PNG.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=8,width=0,height=0,channels=0,metadataDpi:number|null=null,ended=false;const idats:Uint8Array[]=[];
 while(offset+12<=bytes.length){const length=view.getUint32(offset);if(length>bytes.length-offset-12)throw new Error('Truncated PNG.');const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8)),data=bytes.subarray(offset+8,offset+8+length);if(crc32(bytes.subarray(offset+4,offset+8+length))!==view.getUint32(offset+8+length))throw new Error('PNG checksum failed.');
  if(type==='IHDR'){if(offset!==8||length!==13)throw new Error('Invalid PNG header.');width=view.getUint32(offset+8);height=view.getUint32(offset+12);const depth=data[8],colour=data[9];channels=colour===6?4:colour===4?2:0;if(!width||!height||width>16000||height>16000||width*height>MAX_PIXELS||depth!==8||!channels||data[10]!==0||data[11]!==0||data[12]!==0)throw new Error('Use a non-interlaced 8-bit PNG with an alpha channel, up to 25 megapixels.');}
  else if(type==='IDAT')idats.push(data);
  else if(type==='pHYs'&&length===9&&data[8]===1)metadataDpi=Math.min(view.getUint32(offset+8),view.getUint32(offset+12))*.0254;
  else if(type==='acTL')throw new Error('Animated PNG is not a production file.');
  else if(type==='IEND'){ended=true;offset+=12;break}
  else if(type[0]===type[0].toUpperCase()&&!['PLTE'].includes(type))throw new Error('Unsupported critical PNG chunk.');
  offset+=length+12;
 }
 if(!ended||offset!==bytes.length||!width||!idats.length)throw new Error('Invalid or incomplete PNG.');
 const rowBytes=width*channels,scanBytes=rowBytes+1;let row=new Uint8Array(scanBytes),previous=new Uint8Array(rowBytes),fill=0,y=0,left=width,right=-1,top=height,bottom=-1,transparentPixels=0,visiblePixels=0;
 const scale=Math.min(1,(options.maxEdge||720)/Math.max(width,height)),tw=Math.max(1,Math.round(width*scale)),th=Math.max(1,Math.round(height*scale)),thumbnail=new Uint8Array(tw*th*4);
 // Area coverage in premultiplied RGBA. Single-point sampling can entirely miss
 // a thin white text outline when reducing a large production PNG.
 // Keep at most two output rows, never a full floating-point image in the Worker.
 const xScale=width/tw,yScale=height/th,area=xScale*yScale,activeRows=new Map<number,Float64Array>();
 const sampleRow=(decoded:Uint8Array,sourceY:number)=>{
  const horizontal=new Float64Array(tw*4);
  for(let tx=0;tx<tw;tx++){const start=tx*xScale,end=(tx+1)*xScale,to=tx*4;for(let sx=Math.floor(start);sx<Math.min(width,Math.ceil(end));sx++){const weight=Math.min(end,sx+1)-Math.max(start,sx),from=sx*channels,a=decoded[from+channels-1],grey=channels===2;horizontal[to]+=decoded[from]*a*weight;horizontal[to+1]+=decoded[from+(grey?0:1)]*a*weight;horizontal[to+2]+=decoded[from+(grey?0:2)]*a*weight;horizontal[to+3]+=a*weight}}
  const first=Math.floor(sourceY/yScale),last=Math.min(th-1,Math.ceil((sourceY+1)/yScale)-1);
  for(let ty=first;ty<=last;ty++){const weight=Math.min(sourceY+1,(ty+1)*yScale)-Math.max(sourceY,ty*yScale);let sum=activeRows.get(ty);if(!sum){sum=new Float64Array(tw*4);activeRows.set(ty,sum)}for(let i=0;i<horizontal.length;i++)sum[i]+=horizontal[i]*weight;
   if(sourceY+1+1e-9>=(ty+1)*yScale){for(let tx=0;tx<tw;tx++){const from=tx*4,to=(ty*tw+tx)*4,alpha=sum[from+3]/area,a=alpha/255;for(let c=0;c<3;c++){const rgb=sum[from+3]>0?sum[from+c]/sum[from+3]:0;thumbnail[to+c]=options.transparentBackground?(alpha>=.5?Math.round(rgb):0):Math.round(rgb*a+[233,236,223][c]*(1-a))}thumbnail[to+3]=options.transparentBackground?Math.round(alpha):255}activeRows.delete(ty)}
  }
 };
 const compressed=new ReadableStream<Uint8Array>({start(controller){for(const chunk of idats)controller.enqueue(chunk);controller.close()}});const reader=compressed.pipeThrough(new DecompressionStream('deflate') as unknown as TransformStream<Uint8Array,Uint8Array>).getReader();
 const paeth=(a:number,b:number,c:number)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c};
 try{while(true){const {done,value}=await reader.read();if(done)break;let i=0;while(i<value.length){if(y>=height)throw new Error('PNG has excessive decompressed data.');const take=Math.min(scanBytes-fill,value.length-i);row.set(value.subarray(i,i+take),fill);fill+=take;i+=take;if(fill!==scanBytes)continue;const filter=row[0];if(filter>4)throw new Error('Invalid PNG filter.');const decoded=row.subarray(1);for(let b=0;b<rowBytes;b++){const a=b>=channels?decoded[b-channels]:0,above=previous[b],c=b>=channels?previous[b-channels]:0;decoded[b]=(decoded[b]+(filter===1?a:filter===2?above:filter===3?Math.floor((a+above)/2):filter===4?paeth(a,above,c):0))&255}
   for(let x=0;x<width;x++){const alpha=decoded[x*channels+channels-1];if(alpha===0)transparentPixels++;else{visiblePixels++;left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}
   sampleRow(decoded,y);
   previous=new Uint8Array(decoded);row=new Uint8Array(scanBytes);fill=0;y++;
  }}if(y!==height||fill)throw new Error('Incomplete PNG pixel data.');}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const visibleWidth=right<0?0:right-left+1,visibleHeight=bottom<0?0:bottom-top+1,dpi=Math.min((options.dimensionBasis==='canvas'?width:visibleWidth)*25.4/widthMm,(options.dimensionBasis==='canvas'?height:visibleHeight)*25.4/heightMm,nativeDpi),issues:string[]=[];
 if(!visiblePixels)issues.push('No visible artwork.');if(transparentPixels<width*height*.005)issues.push('No clear transparent background.');if(visiblePixels&&(left<2||top<2||right>=width-2||bottom>=height-2))issues.push('Artwork touches the canvas edge.');if(dpi<299.5)issues.push('Effective source resolution is below 300 DPI at the requested print size.');if(metadataDpi===null||Math.abs(metadataDpi-300)>1)issues.push('PNG resolution metadata is not 300 DPI.');
 const report:PngReport={width,height,visibleWidth,visibleHeight,transparentPixels,visiblePixels,dpi,widthMm,heightMm,metadataDpi,ready:!issues.length,issues,version:'server-png-scanline-v1',dimensionBasis:options.dimensionBasis||'visible'};
 // Burn repeated PRINTWEAR text into the low-resolution preview, not the master.
 if(options.watermark!==false){const unit=Math.max(1,Math.round(tw/250));for(let by=15;by<th;by+=70*unit)for(let bx=-40;bx<tw;bx+=175*unit){let at=bx;for(const char of 'PRINTWEAR'){const glyph=FONT[char]||'';for(let gy=0;gy<7;gy++)for(let gx=0;gx<5;gx++)if(glyph[gy*5+gx]==='1')for(let dy=0;dy<unit;dy++)for(let dx=0;dx<unit;dx++){const x=at+gx*unit+dx,yy=by+gy*unit+dy;if(x<0||x>=tw||yy>=th)continue;const p=(yy*tw+x)*4;if(options.transparentBackground&&!thumbnail[p+3])continue;for(let c=0;c<3;c++)thumbnail[p+c]=Math.round(thumbnail[p+c]*(1-(options.watermarkOpacity??.45))+255*(options.watermarkOpacity??.45))}at+=6*unit}}}
 return {report,preview:encode({width:tw,height:th,data:thumbnail,channels:4,depth:8})};
}
