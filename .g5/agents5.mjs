import { chromium } from 'playwright';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,180));});
p.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,220)));
await p.goto('http://localhost:3000/modules/agents-ia',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(14000);
const N=await p.evaluate(()=>[...document.querySelectorAll('button.tap.flex.items-center.gap-2\\.5')].map(x=>x.innerText.split('\n')));
const idx=[0,1,2,20,40,60,74];
for(const i of idx){
  await p.evaluate(i=>{const x=[...document.querySelectorAll('button.tap.flex.items-center.gap-2\\.5')][i];x&&x.click();},i);
  await p.waitForTimeout(6000);
  const r=await p.evaluate(()=>{const l=document.querySelector('#note-ouverte');if(!l)return null;const t=l.innerText;return {chemin:t.split('\n')[1], vide:/n'a pas été rapatriée/.test(t), lecture:/^Lecture…$/m.test(t), taille:t.length};});
  console.log('NOTE',i,JSON.stringify(N[i]),'->',JSON.stringify(r));
  await p.evaluate(()=>{const b=document.querySelector('button[aria-label="Fermer la note"]');b&&b.click();});
  await p.waitForTimeout(1000);
}
// bouton recadrer du graphe
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Graphe');b&&b.click();});
await p.waitForTimeout(25000);
const btns=await p.evaluate(()=>[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&!b.innerText.trim()).map(b=>b.getAttribute('aria-label')||b.getAttribute('data-tip')||'(sans nom)'));
console.log('BOUTONS_GRAPHE',JSON.stringify(btns));
const avant=await p.screenshot({path:'/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5/g-avant.png'});
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&!b.innerText.trim()&&/recadr|cadr/i.test((b.getAttribute('aria-label')||'')+(b.getAttribute('data-tip')||'')))[0];b&&b.click();});
await p.waitForTimeout(6000);
const apres=await p.screenshot({path:'/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5/g-apres.png'});
console.log('RECADRER change le rendu ?', Buffer.compare(avant,apres)!==0);
console.log('LOGS',JSON.stringify(logs.slice(0,6)));
await b.close();
