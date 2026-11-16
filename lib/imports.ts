import {Unzip,UnzipInflate} from "fflate";
export async function unpackFiles(files:File[]):Promise<{files:File[];errors:string[]}>{
 const output:File[]=[],errors:string[]=[];let expanded=0;
 for(const file of files){
  if(file.size>64*1024*1024){errors.push(`${file.name}: file exceeds 64 MB.`);continue}
  if(/\.zip$/i.test(file.name)){
   const before=output.length;
   try{await new Promise<void>(async(resolve,reject)=>{
    let failed=false,count=0;const fail=(e:Error)=>{if(!failed){failed=true;reject(e)}};
    const unzip=new Unzip(entry=>{
     if(failed)return;const name=entry.name;if(name.endsWith("/"))return;
     if(++count>40){fail(new Error("ZIP contains more than 40 files."));return}
     if(name.split(/[\\/]/).includes("..")||/^[/\\]/.test(name)||!/^\S/.test(name)){errors.push(`${name}: unsafe archive path.`);return}
     if(!/\.(png|jpe?g|webp)$/i.test(name)){errors.push(`${name}: unsupported file; use PNG, JPEG or WebP.`);return}
     let size=0;const chunks:Uint8Array[]=[];
     entry.ondata=(err,data,final)=>{if(failed)return;if(err){fail(err);return}size+=data.length;expanded+=data.length;if(size>32*1024*1024||expanded>128*1024*1024){entry.terminate();fail(new Error("ZIP expands beyond the 32 MB/file or 128 MB total limit."));return}chunks.push(data.slice());if(final)output.push(new File(chunks as BlobPart[],name,{type:/\.png$/i.test(name)?"image/png":/\.webp$/i.test(name)?"image/webp":"image/jpeg"}))};
     entry.start();
    });unzip.register(UnzipInflate);
    try{const buffer=new Uint8Array(await file.arrayBuffer());if(buffer.length<22||buffer[0]!==80||buffer[1]!==75)throw new Error("Invalid or damaged ZIP archive.");for(let i=0;i<buffer.length&&!failed;i+=65536)unzip.push(buffer.subarray(i,i+65536),i+65536>=buffer.length);if(!failed)resolve()}catch(e){fail(e as Error)}
   });if(output.length===before)errors.push(`${file.name}: no supported images were found.`)}catch(e){output.splice(before);errors.push(`${file.name}: ${e instanceof Error?e.message:"ZIP cannot be read."}`)}
  }else if(/\.(png|jpe?g|webp)$/i.test(file.name))output.push(file);else errors.push(`${file.name}: unsupported file; use PNG, JPEG, WebP or ZIP.`)
 }
 if(output.length>20){errors.push("Import at most 20 images per batch. Split this archive and retry.");return {files:[],errors}}
 return {files:output,errors};
}
