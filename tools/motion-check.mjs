#!/usr/bin/env node
/**
 * Proves the reveal and the transition actually run, which a screenshot cannot.
 * Samples the covers' transform over time and asserts they start covering and
 * end fully retracted, and that a nav click blurs the content and swaps it.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path'; import os from 'node:os';
const CHROME='C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE=process.env.VERIFY_ORIGIN ?? 'http://localhost:4219';
const port=9100+Math.floor(Math.random()*200);
const profile=path.join(os.tmpdir(),'mc-'+port);
await rm(profile,{recursive:true,force:true});
const chrome=spawn(CHROME,['--headless=new','--remote-debugging-port='+port,'--user-data-dir='+profile,'--no-first-run','--disable-gpu','--hide-scrollbars','about:blank'],{stdio:'ignore'});
async function ep(){for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+port+'/json/version');if(r.ok)return (await r.json()).webSocketDebuggerUrl;}catch{}await new Promise(r=>setTimeout(r,150));}throw new Error('x');}
const ws=new WebSocket(await ep());const pend=new Map();let id=0;
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const{res,rej}=pend.get(m.id);pend.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}});
const raw=(m,p={},s)=>new Promise((res,rej)=>{const n=++id;pend.set(n,{res,rej});ws.send(JSON.stringify({id:n,method:m,params:p,sessionId:s}));});
const {targetId}=await raw('Target.createTarget',{url:'about:blank'});
const {sessionId}=await raw('Target.attachToTarget',{targetId,flatten:true});
const send=(m,p)=>raw(m,p,sessionId);
await send('Page.enable');await send('Runtime.enable');
const ev=async(e)=>{const{result,exceptionDetails}=await send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(exceptionDetails)throw new Error(exceptionDetails.text);return result.value;};

const fail=[],ok=[];
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:BASE+'/'});
await new Promise(r=>setTimeout(r,120));

// Sample the wordmark cover across the reveal.
const samples=[];
for(let i=0;i<12;i++){
  samples.push(await ev("(()=>{const t=document.querySelector('.tapa--word');if(!t)return null;const m=new DOMMatrixReadOnly(getComputedStyle(t).transform);return Math.round(m.a*100)/100;})()"));
  await new Promise(r=>setTimeout(r,180));
}
const first=samples.find(v=>v!==null), last=samples[samples.length-1];
if(first===null) fail.push('no .tapa--word cover found');
else if(!(first>0.5)) fail.push('cover did not start covering (scaleX '+first+')');
else if(!(last<0.02)) fail.push('cover did not finish retracting (scaleX '+last+')');
else ok.push('logo cover wipes '+first+' -> '+last+' across the reveal');

const mid=samples.filter(v=>v!==null&&v>0.02&&v<0.98).length;
if(mid<1) fail.push('cover jumped instead of animating (no intermediate values)');
else ok.push('cover animates through '+mid+' intermediate frames (not a jump)');

const navOpacity=await ev("getComputedStyle(document.getElementById('main-navigation')).opacity");
if(parseFloat(navOpacity)<0.9) fail.push('nav never faded in (opacity '+navOpacity+')');
else ok.push('nav revealed (opacity '+navOpacity+')');

// Easing tokens actually resolve.
const eases=await ev("JSON.stringify({e1:getComputedStyle(document.documentElement).getPropertyValue('--ease1').trim(),e2:getComputedStyle(document.documentElement).getPropertyValue('--ease2').trim()})");
const E=JSON.parse(eases);
if(!/\.37/.test(E.e1)||!/\.19/.test(E.e2)) fail.push('ISU easing tokens missing: '+eases);
else ok.push('ISU easings present (ease1 '+E.e1+', ease2 '+E.e2+')');

// Transition: click a nav item, catch the blur mid-flight.
await ev("document.querySelector('#main-navigation [data-sec=\"prices\"]').click()");
await new Promise(r=>setTimeout(r,150));
const midBlur=await ev("(()=>{const c=document.getElementById('main-content');return {filter:getComputedStyle(c).filter,curtain:document.getElementById('curtain').className};})()");
if(!/blur/.test(midBlur.filter)) fail.push('no motion blur during the swap (filter: '+midBlur.filter+')');
else ok.push('motion blur active mid-swap ('+midBlur.filter+')');
if(!/sweep/.test(midBlur.curtain)) fail.push('curtain not sweeping during the swap ('+midBlur.curtain+')');
else ok.push('curtain sweeping mid-swap ('+midBlur.curtain.trim()+')');

await new Promise(r=>setTimeout(r,900));
const after=await ev("(()=>{const c=document.getElementById('main-content');return {active:document.querySelector('.section.is-active').id,filter:getComputedStyle(c).filter,curtain:document.getElementById('curtain').className};})()");
if(after.active!=='prices') fail.push('section did not settle on prices (got '+after.active+')');
else if(after.filter!=='none') fail.push('blur left on after the swap ('+after.filter+')');
else if(!/idle/.test(after.curtain)) fail.push('curtain not parked after the swap ('+after.curtain+')');
else ok.push('swap settles clean: prices active, blur cleared, curtain idle');

// Grain present on the hero.
await send('Page.navigate',{url:BASE+'/'});
await new Promise(r=>setTimeout(r,1400));
const grain=await ev("(()=>{const s=getComputedStyle(document.querySelector('#home .figure'),'::after');return {img:s.backgroundImage.slice(0,30),op:s.opacity,blend:s.mixBlendMode};})()");
if(!/svg/.test(grain.img)) fail.push('no grain layer on the hero');
else if(parseFloat(grain.op)>0.12) fail.push('grain too strong ('+grain.op+')');
else ok.push('hero grain present at '+grain.op+' ('+grain.blend+')');

ws.close();chrome.kill();await rm(profile,{recursive:true,force:true}).catch(()=>{});
console.log(ok.map(o=>'  ok   '+o).join('\n'));
if(fail.length){console.error('\n'+fail.length+' FAILED:\n'+fail.map(f=>'  x  '+f).join('\n'));process.exit(1);}
console.log('\nmotion checks passed against '+BASE);
