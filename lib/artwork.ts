import {borderBlemishes} from "./border-blemishes";
export type Raster={width:number;height:number;data:Uint8ClampedArray};
export type Quality={width:number;height:number;visibleWidth:number;visibleHeight:number;widthMm:number;heightMm:number;dpi:number;transparentPixels:number;visiblePixels:number;changedPixels:number;removedBackdrop:boolean;issues:string[];ready:boolean;version:string;cleanup?:{profile:string;haloThreshold:number;speckLimitMm:number;haze:number;specks:number;edges:number;backdrop:number}};
export function inspectArtwork(r:Raster,widthMm:number,changedPixels=0,removedBackdrop=false,physicalHeightMm?:number):Quality{
 let left=r.width,top=r.height,right=-1,bottom=-1,transparentPixels=0,visiblePixels=0;
 for(let p=0;p<r.width*r.height;p++){const a=r.data[p*4+3];if(a===0)transparentPixels++;if(a>0){visiblePixels++;const x=p%r.width,y=Math.floor(p/r.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y)}}
 const visibleWidth=right<0?0:right-left+1,visibleHeight=bottom<0?0:bottom-top+1,heightMm=physicalHeightMm??(visibleWidth?visibleHeight*widthMm/visibleWidth:0),dpi=Math.min(visibleWidth*25.4/widthMm,heightMm>0?visibleHeight*25.4/heightMm:0);
 const issues:string[]=[];
 if(!Number.isFinite(widthMm)||widthMm<=0||widthMm>355)issues.push("Choose a print width between 1 and 355 mm.");
 if(!visiblePixels)issues.push("No visible artwork remains. Restore and review the source.");
 if(transparentPixels<r.width*r.height*.005)issues.push("No clear transparent background. Background removal needs review.");
 if(dpi<299.5)issues.push(`Insufficient original detail: ${Math.round(dpi)} DPI at ${widthMm} mm. Use a larger source or a smaller print size.`);
 if(visiblePixels&&(left<2||top<2||right>=r.width-2||bottom>=r.height-2))issues.push("Artwork touches the canvas edge. Check for clipping and add transparent margins.");
 if(heightMm>550)issues.push("Artwork exceeds the 550 mm garment print length.");
 return {width:r.width,height:r.height,visibleWidth,visibleHeight,widthMm,heightMm,dpi,transparentPixels,visiblePixels,changedPixels,removedBackdrop,issues,ready:issues.length===0,version:"ptp-repair-profile-v2"};
}
// Based on Prompt to Print's physical-size speck, faint-alpha and edge-blemish
// processing. All changes are alpha-only or clear RGB on fully removed pixels.
export function cleanRaster(source:Raster,widthMm:number,removeBackground=true,printedHeightMm=hypotheticalHeight(source,widthMm)):{raster:Raster;report:Quality}{
 const {width:w,height:h}=source,n=w*h;if(w<1||h<1||n>25_000_000||source.data.length!==n*4)throw new Error("Image exceeds the 25 megapixel limit or is invalid.");
 const data=new Uint8ClampedArray(source.data),alpha=new Uint8ClampedArray(n);let removedBackdrop=false;
 if(removeBackground){const corners=[0,w-1,(h-1)*w,n-1],first=corners[0]*4;const colour=[data[first],data[first+1],data[first+2]];
  const close=(p:number)=>data[p*4+3]>240&&Math.max(...colour.map((c,k)=>Math.abs(c-data[p*4+k])))<=18;
  // Only an opaque, uniform edge-connected backdrop. Never globally key black.
  if(corners.every(close)){
   const seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
   const add=(p:number)=>{if(!seen[p]&&close(p)){seen[p]=1;queue[tail++]=p}};
   for(let x=0;x<w;x++){add(x);add((h-1)*w+x)}for(let y=0;y<h;y++){add(y*w);add(y*w+w-1)}
   while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);data[p*4+3]=0;if(x)add(p-1);if(x<w-1)add(p+1);if(y)add(p-w);if(y<h-1)add(p+w)}
   removedBackdrop=tail>0;
  }
 }
 for(let p=0;p<n;p++)alpha[p]=data[p*4+3];
 const labels=new Int32Array(n),queue=new Int32Array(n);type Component={id:number;count:number;left:number;right:number;top:number;bottom:number};const components:Component[]=[];
 for(let seed=0;seed<n;seed++){
  if(labels[seed]||alpha[seed]<36)continue;const id=components.length+1,c:Component={id,count:0,left:w,right:0,top:h,bottom:0};let head=0,tail=1;queue[0]=seed;labels[seed]=id;
  while(head<tail){const p=queue[head++],x=p%w,y=Math.floor(p/w);c.count++;c.left=Math.min(c.left,x);c.right=Math.max(c.right,x);c.top=Math.min(c.top,y);c.bottom=Math.max(c.bottom,y);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const next=ny*w+nx;if(!labels[next]&&alpha[next]>=36){labels[next]=id;queue[tail++]=next}}}
  components.push(c);
 }
 const removed=new Set<number>();
 // Same physical-size profiles as Prompt to Print repairArtwork at 51b2cf0.
 // The production artwork keeps its native pixels; these are cleanup thresholds,
 // not an upscaler or a guarantee that intentional translucency can be inferred.
 const smallArtwork=widthMm<=60&&printedHeightMm<=60;
 const mmPerPixel=widthMm/w,yMmPerPixel=printedHeightMm/h,tolerance=smallArtwork?1.25:.8,haloThreshold=smallArtwork?96:160;
 const main=components.reduce<Component|null>((largest,c)=>!largest||c.count>largest.count?c:largest,null);
 if(components.length<=2000)for(const c of components){
  if(c===main)continue;
  if((c.right-c.left+1)*mmPerPixel>=tolerance||(c.bottom-c.top+1)*yMmPerPixel>=tolerance)continue;
  let gap=Infinity;for(const other of components){if(other.count<=c.count)continue;gap=Math.min(gap,Math.hypot(Math.max(0,c.left-other.right-1,other.left-c.right-1)*mmPerPixel,Math.max(0,c.top-other.bottom-1,other.top-c.bottom-1)*yMmPerPixel))}
  if(Number.isFinite(gap)&&gap>tolerance)removed.add(c.id);
 }
 const marks=borderBlemishes(alpha,w,h,widthMm,printedHeightMm);let changed=0,haze=0,specks=0,edges=0,backdrop=0;
 for(let p=0;p<n;p++){
  const before=data[p*4+3];
  if(before>0){if(removed.has(labels[p])){data[p*4+3]=0;specks++}else if(marks[p]){data[p*4+3]=0;edges++}else if(before<haloThreshold){data[p*4+3]=0;haze++}}
  if(source.data[p*4+3]>0&&before===0)backdrop++;
  if(data[p*4+3]!==source.data[p*4+3])changed++;
  if(data[p*4+3]===0){data[p*4]=0;data[p*4+1]=0;data[p*4+2]=0}
 }
 const raster={width:w,height:h,data},report=inspectArtwork(raster,widthMm,changed,removedBackdrop);
 report.cleanup={profile:smallArtwork?'Prompt to Print · small artwork':'Prompt to Print · standard artwork',haloThreshold,speckLimitMm:tolerance,haze,specks,edges,backdrop};
 if(components.length>2000){report.issues.push("Very noisy source: too many detached details for reliable automatic cleanup.");report.ready=false}
 return {raster,report};
}
export function crc32(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
export function with300Dpi(png:Uint8Array){
 const type=new TextEncoder().encode("pHYs"),payload=new Uint8Array(9),v=new DataView(payload.buffer);v.setUint32(0,11811);v.setUint32(4,11811);payload[8]=1;
 const chunk=new Uint8Array(21),cv=new DataView(chunk.buffer);cv.setUint32(0,9);chunk.set(type,4);chunk.set(payload,8);cv.setUint32(17,crc32(chunk.subarray(4,17)));
 const pieces:Uint8Array[]=[png.subarray(0,8)];let offset=8,inserted=false;
 while(offset+12<=png.length){const len=new DataView(png.buffer,png.byteOffset+offset,4).getUint32(0);if(offset+12+len>png.length)throw new Error("Invalid PNG chunks.");const tag=String.fromCharCode(...png.subarray(offset+4,offset+8));if(tag!=="pHYs")pieces.push(png.subarray(offset,offset+len+12));if(tag==="IHDR"){pieces.push(chunk);inserted=true}offset+=len+12}
 if(!inserted)throw new Error("PNG header missing.");const result=new Uint8Array(pieces.reduce((n,p)=>n+p.length,0));let pos=0;for(const p of pieces){result.set(p,pos);pos+=p.length}return result;
}

function hypotheticalHeight(source:Raster,widthMm:number){return source.height*widthMm/source.width}
