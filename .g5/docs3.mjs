import { chromium } from 'playwright';
const b=await chromium.launch(); const p=await b.newPage();
await p.setViewportSize({width:1500,height:950});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,200));});
p.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,250)));
const net=[]; p.on('response',r=>{if(r.status()>=400)net.push(r.status()+' '+r.url().slice(0,150));});
await p.goto('http://localhost:3000/modules/documents',{waitUntil:'networkidle',timeout:180000});
await p.waitForTimeout(12000);
const st=async()=>p.evaluate(()=>{const t=document.body.innerText;return{
  filtre:(t.match(/([\d\s  ]+) documents?\n/)||[])[1]?.replace(/\s/g,''),
  lignes:document.querySelectorAll('a[href*="dropbox.com"]').length,
  pages:[...document.querySelectorAll('div.mt-3.flex.items-center.justify-center button')].map(b=>b.innerText.trim()),
  actif:[...document.querySelectorAll('div.mt-3.flex.items-center.justify-center button')].filter(b=>b.className.includes('bg-subtle')).map(b=>b.innerText.trim()),
  premier:document.querySelector('a[href*="dropbox.com"]')?.innerText.split('\n')[0],
}});
console.log('INIT',JSON.stringify(await st()));
let vu=new Set(); let cur=1;
for(let i=0;i<45;i++){
  const s=await st();
  const max=Math.max(...s.pages.map(Number).filter(n=>!isNaN(n)));
  if(max<=cur){ console.log('PLAFOND atteint a',cur,'| pages visibles',JSON.stringify(s.pages)); break; }
  const cible=String(max);
  await p.evaluate(c=>{const b=[...document.querySelectorAll('div.mt-3.flex.items-center.justify-center button')].find(x=>x.innerText.trim()===c);b&&b.click();},cible);
  await p.waitForTimeout(4500);
  cur=Number(cible);
  const s2=await st();
  if(i%5===0||cur>34) console.log('PAGE',cur,JSON.stringify({lignes:s2.lignes,actif:s2.actif,pages:s2.pages.slice(-6),premier:s2.premier}));
  if(vu.has(cur)){console.log('BOUCLE');break;} vu.add(cur);
}
console.log('FIN',JSON.stringify(await st()));
console.log('THEORIQUE pages', Math.ceil(8196/60));
const box=await p.$('div.w-\\[220px\\]');
if(box){ await box.click(); await p.waitForTimeout(2500); }
const opts=await p.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&b.getBoundingClientRect().width<400&&b.closest('div')?.className?.includes('fixed')).map(b=>b.innerText.trim()));
console.log('OPTS_fixed',opts.length,JSON.stringify(opts.slice(0,70)));
const opts2=await p.evaluate(()=>[...document.querySelectorAll('[role=option]')].map(o=>o.innerText.trim()));
console.log('OPTS_role',opts2.length,JSON.stringify(opts2.slice(0,70)));
await p.screenshot({path:'/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5/docs-dropdown.png'});
console.log('LOGS',JSON.stringify(logs));console.log('NET',JSON.stringify(net));
await b.close();
