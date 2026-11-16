"use client";
import {useEffect,useRef} from 'react';
export function useDialog(open:boolean,onClose:()=>void){
 const close=useRef(onClose);close.current=onClose;
 useEffect(()=>{if(!open)return;const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
 const selector='button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
 const timer=setTimeout(()=>document.querySelector('[role="dialog"]')?.querySelector<HTMLElement>(selector)?.focus(),0);
 const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){close.current();return}if(e.key!=='Tab')return;const dialog=document.querySelector('[role="dialog"]');const nodes=dialog?Array.from(dialog.querySelectorAll<HTMLElement>(selector)).filter(n=>n.offsetParent!==null):[];if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}};
 document.addEventListener('keydown',key);return()=>{clearTimeout(timer);document.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus()};
 },[open]);
}
