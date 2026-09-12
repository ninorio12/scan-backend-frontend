import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5';
const b=await chromium.launch(); const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,180));});
p.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,220)));
const net=[]; p.on('response',r=>{if(r.status()>=400)net.push(r.status()+' '+r.url().slice(0,140));});

/* ---- A) bibliothèque : descente vers le plus gros dossier, plafond 500 ---- */
await p.goto('http://localhost:3000/modules/bibliotheque',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(9000);
const etat=async()=>p.evaluate(()=>({
  fil:[...document.querySelectorAll('div.mb-3 button')].map(b=>b.innerText.trim()),
  dossiers:[...document.querySelectorAll('div.group.relative')].map(d=>{const s=d.querySelectorAll('button span span');return s.length>=2?{n:s[0].innerText.trim(),nb:parseInt(s[1].innerText)}:null;}).filter(Boolean),
  fichiers:document.querySelectorAll('div.group.flex.items-center.gap-3').length,
  plus:(document.body.innerText.match(/(\d+) fichiers de plus/)||[])[1]||null,
}));
const enter=async(n)=>{await p.evaluate(n=>{const c=[...document.querySelectorAll('div.group.relative')].find(d=>{const s=d.querySelector('button span span');return s&&s.innerText.trim()===n;}); c&&c.querySelector('button').click();},n); await p.waitForTimeout(7000);};
await enter('FACTURES');
for(let i=0;i<8;i++){
  const e=await etat();
  console.log('DESC',JSON.stringify(e.fil),'| sous-dossiers',e.dossiers.length,'| fichiers affichés',e.fichiers,'| plafond',e.plus);
  if(!e.dossiers.length) break;
  const gros=e.dossiers.sort((a,c)=>c.nb-a.nb)[0];
  await enter(gros.n);
}
const fin=await etat();
console.log('FEUILLE',JSON.stringify({fil:fin.fil,fichiers:fin.fichiers,plus:fin.plus}));
// recherche dans un dossier plafonné
if(fin.plus){
  await p.fill('input[placeholder="Chercher dans ce dossier…"]','2025');
  await p.waitForTimeout(4000);
  console.log('PLAFOND+RECHERCHE ->', JSON.stringify(await etat()));
  await p.fill('input[placeholder="Chercher dans ce dossier…"]','');
  await p.waitForTimeout(3000);
}

/* ---- B) documents : dropdown dossier ---- */
await p.goto('http://localhost:3000/modules/documents',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(12000);
const st=async()=>p.evaluate(()=>{const t=document.body.innerText;return{
  entete:(t.match(/Documents\n([\d\s  ]+)\n/)||[])[1]?.replace(/\s/g,''),
  dossiersCarte:(t.match(/Dossiers\n(\d+)/)||[])[1],
  filtre:(t.match(/([\d\s  ]+) documents?\n/)||[])[1]?.replace(/\s/g,''),
  lignes:document.querySelectorAll('a[href*="dropbox.com"]').length,
  valeurSelect:document.querySelector('div.w-\\[220px\\] button')?.innerText.trim(),
}});
console.log('DOCS_INIT',JSON.stringify(await st()));
for(const d of ['Marketing','ACIGe','ZZ-TEST-QA-2026-09-11','DOSSIERS ATLAS']){
  await p.click('div.w-\\[220px\\]'); await p.waitForTimeout(1800);
  const ok=await p.evaluate(n=>{const b=[...document.querySelectorAll('button')].filter(x=>x.offsetParent&&x.innerText.trim()===n).pop(); if(!b)return false; b.click(); return true;},d);
  await p.waitForTimeout(6000);
  console.log('SELECT',d,ok?JSON.stringify(await st()):'option introuvable');
}
// survie au rechargement
const avant=await st();
await p.reload({waitUntil:'networkidle',timeout:200000}); await p.waitForTimeout(12000);
console.log('AVANT_RELOAD',JSON.stringify(avant));
console.log('APRES_RELOAD',JSON.stringify(await st()));
console.log('LOGS',JSON.stringify(logs.slice(0,8)));console.log('NET',JSON.stringify(net.slice(0,8)));
await b.close();
