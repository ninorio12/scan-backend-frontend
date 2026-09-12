import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:950});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,220));});
p.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,250)));
const net=[]; p.on('response',r=>{if(r.status()>=400)net.push(r.status()+' '+r.url().slice(0,160));});
await p.goto('http://localhost:3000/modules/agents-ia',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(15000);
const nb=async()=>p.evaluate(()=>document.querySelectorAll('button.tap.flex.items-center.gap-2\\.5').length);
const fam=async(l)=>{await p.evaluate(l=>{const b=[...document.querySelectorAll('div.mt-2\\.5.flex.flex-wrap button')].find(x=>x.innerText.replace(/\n/g,' ').trim().startsWith(l));b&&b.click();},l); await p.waitForTimeout(2500);};
// A) filtres famille
for(const f of ['Concepts','Entités','Journal','Racine','Requêtes','Tout']){
  await fam(f);
  const n=await nb();
  const fams=await p.evaluate(()=>{const s=new Set();document.querySelectorAll('button.tap.flex.items-center.gap-2\\.5').forEach(x=>{const pr=x.innerText.split('\n');s.add(pr[pr.length-2]);});return [...s];});
  console.log('FAM',f,'->',n,'notes, familles affichees',JSON.stringify(fams));
}
// B) recherche
await p.fill('input[placeholder="Chercher une note…"]','onex'); await p.waitForTimeout(2500);
console.log('RECH onex ->', await nb());
await p.fill('input[placeholder="Chercher une note…"]','zzzz_rien'); await p.waitForTimeout(2000);
console.log('RECH vide ->', await nb(), JSON.stringify((await p.evaluate(()=>document.body.innerText)).slice(-120)));
await p.fill('input[placeholder="Chercher une note…"]',''); await p.waitForTimeout(2500);
// C) ouvrir une note depuis la liste
const nom=await p.evaluate(()=>{const x=[...document.querySelectorAll('button.tap.flex.items-center.gap-2\\.5')][2]; x.click(); return x.innerText.split('\n')[1];});
await p.waitForTimeout(9000);
console.log('NOTE_OUVERTE', JSON.stringify(await p.evaluate(()=>{const l=document.querySelector('#note-ouverte'); return l?{titre:l.innerText.split('\n')[0],chemin:l.innerText.split('\n')[1],corps:l.innerText.slice(0,260).replace(/\n/g,' | ')}:null;})));
console.log('  attendu chemin', nom);
// fermer
await p.evaluate(()=>{const b=document.querySelector('button[aria-label="Fermer la note"]');b&&b.click();});
await p.waitForTimeout(1500);
console.log('NOTE_FERMEE', await p.evaluate(()=>!document.querySelector('#note-ouverte')));
// D) graphe
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Graphe');b&&b.click();});
await p.waitForTimeout(25000);
const g=await p.evaluate(()=>{
  const c=document.querySelector('canvas');
  return {canvas:!!c, w:c?.width, h:c?.height, txt:document.body.innerText.length};
});
console.log('GRAPHE',JSON.stringify(g));
await p.screenshot({path:OUT+'/agents-graphe.png'});
console.log('LOGS',JSON.stringify(logs.slice(0,12)));console.log('NET',JSON.stringify(net.slice(0,8)));
await b.close();
