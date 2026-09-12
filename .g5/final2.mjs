import { chromium } from 'playwright';
const b=await chromium.launch(); const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,180));});
await p.goto('http://localhost:3000/modules/documents',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(12000);
await p.click('div.w-\\[220px\\]'); await p.waitForTimeout(1800);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent&&x.innerText.trim()==='DOSSIERS ATLAS').pop(); b&&b.click();});
await p.waitForTimeout(7000);
console.log('DOSSIERS_ATLAS', JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('a[href*="dropbox.com"]')].map(a=>a.innerText.split('\n').slice(0,2))),null,1));
// ZZ-TEST-QA
await p.click('div.w-\\[220px\\]'); await p.waitForTimeout(1800);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent&&x.innerText.trim()==='ZZ-TEST-QA-2026-09-11').pop(); b&&b.click();});
await p.waitForTimeout(7000);
console.log('QA', JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('a[href*="dropbox.com"]')].map(a=>({t:a.innerText.split('\n').slice(0,3),h:a.href.slice(0,120)}))),null,1));
// bibliothèque racine : y a-t-il des fichiers en vrac ?
await p.goto('http://localhost:3000/modules/bibliotheque',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(10000);
console.log('RACINE', JSON.stringify(await p.evaluate(()=>({
  dossiers:document.querySelectorAll('div.group.relative').length,
  fichiers:document.querySelectorAll('div.group.flex.items-center.gap-3').length,
  aDossiersAtlas:[...document.querySelectorAll('div.group.relative button span span')].some(s=>s.innerText.trim()==='DOSSIERS ATLAS'),
}))));
console.log('LOGS',JSON.stringify(logs.slice(0,6)));
await b.close();
