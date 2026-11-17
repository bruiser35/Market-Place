"use client";
export default function AiImageFlags({flags}:{flags?:string[]}){
 if(!flags?.length)return null;
 return <section className="notice" aria-label="AI image-check flags"><strong>AI image-check flags — review needed</strong><ul>{flags.map((flag,index)=><li key={index}>{flag}</li>)}</ul><p>These are AI observations, not changes to your artwork. Enlarge the image to check each concern. If the artwork needs fixing, clean it in Prompt to Print and import the corrected file. If a flag is incorrect, use “Edit details, categories or quality review” to correct the qualityFlags in the saved metadata after inspection.</p></section>
}
