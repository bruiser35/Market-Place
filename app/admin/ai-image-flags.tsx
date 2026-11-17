"use client";
export default function AiImageFlags({flags}:{flags?:string[]}){
 if(!flags?.length)return null;
 return <section className="notice" aria-label="AI image-check flags"><strong>AI image-check flags — review needed</strong><ul>{flags.map((flag,index)=><li key={index}>{flag}</li>)}</ul><p>These are AI observations, not changes to your artwork. Enlarge the image to check each concern. If the artwork needs fixing, clean it in Prompt to Print and import the corrected file. If the artwork is correct after inspection, choose “Accept warning & approve”. Your acceptance is recorded and these AI observations remain in the artwork history.</p></section>
}
