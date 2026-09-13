#!/usr/bin/env node
/**
 * Proves the reveal and the transition actually run, which a screenshot cannot.
 * Samples the covers' transform over time and asserts they start covering and
 * end fully retracted, and that a nav click blurs the content and swaps it.
 * Also samples, frame by frame inside the page (requestAnimationFrame), the
 * mobile menu opening and closing and the cross-page curtain leaving one page
 * and uncovering the next, and fails if any of them jumps instead of animating.
 */
import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import path from 'node:path'; import os from 'node:os';
const CHROME=process.env.VERIFY_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
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
await send('Page.navigate',{url:BASE+'/home'});
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

await new Promise(r=>setTimeout(r,500));
const navOpacity=await ev("Math.min(...[...document.querySelectorAll('#main-navigation li')].map(l=>+getComputedStyle(l).opacity))");
if(parseFloat(navOpacity)<0.9) fail.push('nav never faded in (opacity '+navOpacity+')');
else ok.push('nav revealed (opacity '+navOpacity+')');

// Easing tokens actually resolve.
const eases=await ev("JSON.stringify({e1:getComputedStyle(document.documentElement).getPropertyValue('--ease1').trim(),e2:getComputedStyle(document.documentElement).getPropertyValue('--ease2').trim()})");
const E=JSON.parse(eases);
if(!/\.37/.test(E.e1)||!/\.19/.test(E.e2)) fail.push('ISU easing tokens missing: '+eases);
else ok.push('ISU easings present (ease1 '+E.e1+', ease2 '+E.e2+')');

// Transition: click a nav item, catch the blur mid-flight.
await ev("document.querySelector('#main-navigation [data-sec=\"contact\"]').click()");
await new Promise(r=>setTimeout(r,150));
const midBlur=await ev("(()=>{const c=document.getElementById('main-content');return {filter:getComputedStyle(c).filter,curtain:document.documentElement.className};})()");
if(!/blur/.test(midBlur.filter)) fail.push('no motion blur during the swap (filter: '+midBlur.filter+')');
else ok.push('motion blur active mid-swap ('+midBlur.filter+')');
if(!/curtain-(in|out)/.test(midBlur.curtain)) fail.push('curtain not sweeping during the swap ('+midBlur.curtain+')');
else ok.push('curtain sweeping mid-swap ('+midBlur.curtain.trim()+')');

await new Promise(r=>setTimeout(r,1300));
const after=await ev("(()=>{const c=document.getElementById('main-content');return {active:document.querySelector('.section.is-active').id,filter:getComputedStyle(c).filter,curtain:document.documentElement.className};})()");
if(after.active!=="contact") fail.push('section did not settle on contact (got '+after.active+')');
else if(after.filter!=='none') fail.push('blur left on after the swap ('+after.filter+')');
else if(/curtain-/.test(after.curtain)) fail.push('curtain not parked after the swap ('+after.curtain+')');
else ok.push('swap settles clean: contact active, blur cleared, curtain idle');

// Grain present on the hero.
await send('Page.navigate',{url:BASE+'/home'});
await new Promise(r=>setTimeout(r,1400));
const grain=await ev("(()=>{const s=getComputedStyle(document.querySelector('#home .figure'),'::after');return {img:s.backgroundImage.slice(0,30),op:s.opacity,blend:s.mixBlendMode};})()");
if(!/svg/.test(grain.img)) fail.push('no grain layer on the hero');
else if(parseFloat(grain.op)>0.12) fail.push('grain too strong ('+grain.op+')');
else ok.push('hero grain present at '+grain.op+' ('+grain.blend+')');

// ---- mobile menu: sample the open transition frame by frame, in the page.
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
await send('Page.navigate',{url:BASE+'/home'});
await sleep(2800);
const menu=await ev(`new Promise(res=>{
  const n=document.getElementById('main-navigation-mobile');
  const li=n.querySelector('li');const bar=document.querySelector('#ico-nav .ln2');
  const out=[];const t0=performance.now();
  const tick=()=>{
    const g=new DOMMatrixReadOnly(getComputedStyle(n,'::before').transform);
    const b=new DOMMatrixReadOnly(getComputedStyle(bar).transform);
    out.push({t:Math.round(performance.now()-t0),ground:+g.a.toFixed(3),li:+(+getComputedStyle(li).opacity).toFixed(3),
      liX:+new DOMMatrixReadOnly(getComputedStyle(li).transform).m41.toFixed(2),bar:+Math.atan2(b.b,b.a).toFixed(3)});
    if(performance.now()-t0<1100)requestAnimationFrame(tick);else res(out);
  };
  document.getElementById('ico-nav').click();
  requestAnimationFrame(tick);
})`);
const between=(arr,k,lo,hi)=>arr.filter(s=>s[k]>lo&&s[k]<hi).length;
const gMid=between(menu,'ground',0.02,0.98), liMid=between(menu,'li',0.02,0.98);
const barMid=menu.filter(s=>Math.abs(s.bar)>0.02&&Math.abs(s.bar)<0.76).length;
const lastM=menu[menu.length-1];
if(gMid<3) fail.push('menu ground jumped open ('+gMid+' intermediate frames): '+JSON.stringify(menu.slice(0,8)));
else ok.push('menu ground scales open through '+gMid+' intermediate frames');
if(liMid<3) fail.push('menu items jumped in ('+liMid+' intermediate frames)');
else ok.push('first menu item fades/slides in through '+liMid+' intermediate frames');
if(barMid<3) fail.push('burger bars jumped to the X ('+barMid+' frames)');
else ok.push('burger bars rotate into the X through '+barMid+' intermediate frames');
if(!(lastM.ground>0.99&&lastM.li>0.99&&Math.abs(lastM.liX)<0.1)) fail.push('menu did not settle open: '+JSON.stringify(lastM));
else ok.push('menu is fully open by '+lastM.t+'ms (ground 1, item opacity 1, x 0)');
const firstGround=menu.find(s=>s.ground>0.02);
ok.push('menu timeline: ground starts '+(firstGround?firstGround.t:'?')+'ms, first item visible from '+((menu.find(s=>s.li>0.02)||{}).t)+'ms');

const close=await ev(`new Promise(res=>{
  const n=document.getElementById('main-navigation-mobile');const out=[];const t0=performance.now();
  const tick=()=>{out.push({t:Math.round(performance.now()-t0),op:+(+getComputedStyle(n).opacity).toFixed(3),vis:getComputedStyle(n).visibility});
    if(performance.now()-t0<600)requestAnimationFrame(tick);else res(out);};
  document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  requestAnimationFrame(tick);
})`);
const cMid=between(close,'op',0.02,0.98);
if(cMid<3) fail.push('menu close jumped ('+cMid+' frames)');
else if(close[close.length-1].vis!=='hidden') fail.push('menu not hidden after close');
else ok.push('menu fades closed through '+cMid+' intermediate frames and ends hidden');

// ---- cross-page curtain: leaving (sampled in the old page) ...
await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
await send('Page.navigate',{url:BASE+'/home'});
await sleep(2800);
// ... and arriving (a sampler installed before the new document's own scripts).
const {identifier}=await send('Page.addScriptToEvaluateOnNewDocument',{source:`
  window.__arrive=[];const __t0=performance.now();
  const __tick=()=>{const c=document.getElementById('curtain');
    if(c){window.__arrive.push({t:Math.round(performance.now()-__t0),a:+new DOMMatrixReadOnly(getComputedStyle(c).transform).a.toFixed(3),
      vis:getComputedStyle(c).visibility,cls:document.documentElement.className});}
    if(performance.now()-__t0<1500)requestAnimationFrame(__tick);};
  requestAnimationFrame(__tick);`});
const leaving=await ev(`new Promise(res=>{
  const bck=document.querySelector('#curtain .bck');const out=[];const t0=performance.now();
  const tick=()=>{out.push(+new DOMMatrixReadOnly(getComputedStyle(bck).transform).a.toFixed(3));
    if(performance.now()-t0<370)requestAnimationFrame(tick);else res(out);};
  document.querySelector('#main-navigation a[href="gallery"]').click();
  requestAnimationFrame(tick);
})`);
const lMid=leaving.filter(v=>v>0.02&&v<0.98).length;
if(lMid<3) fail.push('leaving curtain jumped ('+JSON.stringify(leaving)+')');
else ok.push('leaving: the curtain sweeps in through '+lMid+' intermediate frames');

await sleep(2200);
const arrive=await ev('({path:location.pathname,s:window.__arrive||[]})');
await send('Page.removeScriptToEvaluateOnNewDocument',{identifier});
const s=arrive.s;
const coveredFirst=s.length&&s[0].vis==='visible'&&s[0].a>0.98;
const aMid=s.filter(v=>v.vis==='visible'&&v.a>0.02&&v.a<0.98).length;
const endIdle=s.length&&s[s.length-1].vis==='hidden'&&!/curtain-/.test(s[s.length-1].cls);
if(arrive.path!=='/gallery') fail.push('cross-page click did not land on /gallery ('+arrive.path+')');
else if(!coveredFirst) fail.push('arriving page was not covered on its first frame: '+JSON.stringify(s.slice(0,3)));
else if(aMid<3) fail.push('arriving curtain jumped ('+aMid+' frames): '+JSON.stringify(s.slice(0,20)));
else if(!endIdle) fail.push('arriving curtain did not end idle: '+JSON.stringify(s[s.length-1]));
else {
  const lastVisible=[...s].reverse().find(v=>v.vis==='visible');
  ok.push('arriving: covered on the first frame, uncovers through '+aMid+' intermediate frames, idle from '+(lastVisible?lastVisible.t:'?')+'ms');
}

ws.close();chrome.kill();await rm(profile,{recursive:true,force:true}).catch(()=>{});
console.log(ok.map(o=>'  ok   '+o).join('\n'));
if(fail.length){console.error('\n'+fail.length+' FAILED:\n'+fail.map(f=>'  x  '+f).join('\n'));process.exit(1);}
console.log('\nmotion checks passed against '+BASE);
