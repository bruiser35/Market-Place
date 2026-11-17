// Low effective resolution is an owner-visible warning, never a silent upscale.
export function publicationQuality(r:any){
 const issues:Array<unknown>=Array.isArray(r.issues)?r.issues:[];
 const resolutionIssue=(v:unknown)=>typeof v==='string'&&(/^Insufficient original detail:/.test(v)||v==='Insufficient original detail at the selected width and height.'||v==='Effective source resolution is below 300 DPI at the requested print size.');
 const lowDpi=Number.isFinite(r.dpi)&&r.dpi>0&&r.dpi<299.5;
 const blocked=!Number.isFinite(r.dpi)||r.dpi<=0||!(r.transparentPixels>0)||!(r.visiblePixels>0)||!Number.isFinite(r.widthMm)||r.widthMm<=0||r.widthMm>355||!Number.isFinite(r.heightMm)||r.heightMm<=0||r.heightMm>550||issues.some(v=>!resolutionIssue(v))||(!r.ready&&!issues.length);
 return {lowDpi,blocked};
}
