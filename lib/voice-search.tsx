"use client";
import {useEffect,useRef,useState} from 'react';
import {Mic,Square} from 'lucide-react';
type Recognition={lang:string;interimResults:boolean;continuous:boolean;onresult:((event:any)=>void)|null;onerror:((event:any)=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
export default function VoiceSearch({onSearch}:{onSearch:(text:string)=>void}){
 const [available,setAvailable]=useState(false),[listening,setListening]=useState(false),[notice,setNotice]=useState(''),[consent,setConsent]=useState(false);const recognition=useRef<Recognition|null>(null);
 useEffect(()=>{setAvailable(Boolean((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition));return()=>recognition.current?.abort()},[]);
 function start(){if(!consent){setNotice('Voice input uses your browser’s speech service and may process audio online. Select “Allow voice input” to continue. You can always type instead.');return}const Constructor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;if(!Constructor)return;
  const r:Recognition=new Constructor();recognition.current=r;r.lang='en-AU';r.interimResults=false;r.continuous=false;
  r.onresult=e=>{const text=String(e.results?.[0]?.[0]?.transcript||'').trim();if(text){setNotice(`Searching for “${text}”`);onSearch(text)}};
  r.onerror=e=>{setNotice(e.error==='not-allowed'?'Microphone access was not allowed. Please type your search.':'Voice input is unavailable right now. Please type your search.');setListening(false)};r.onend=()=>setListening(false);
  try{r.start();setListening(true);setNotice('Listening… describe the artwork you want.')}catch{setNotice('Voice input could not start. Please type your search.')}
 }
 return <div className="voice-search"><button type="button" className="text-link" disabled={!available} aria-label={listening?'Stop voice search':'Search by voice'} onClick={()=>listening?recognition.current?.stop():start()}>{listening?<Square size={14}/>:<Mic size={15}/>} {listening?'Stop listening':available?'Describe it by voice':'Voice unavailable in this browser'}</button>{available&&<label><input type="checkbox" checked={consent} onChange={e=>{setConsent(e.target.checked);if(!e.target.checked)recognition.current?.abort()}}/>Allow voice input</label>}{notice&&<span role="status" aria-live="polite">{notice}</span>}</div>
}
