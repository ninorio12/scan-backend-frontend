import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:950});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,200));});
p.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,250)));
await p.goto('http://localhost:3000/modules/agents-ia',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(14000);
// filtrer sur Journal+Racine pour n'avoir que peu de noeuds ? non : on garde tout
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Graphe');b&&b.click();});
await p.waitForTimeout(30000);
const box=await p.evaluate(()=>{const c=document.querySelector('canvas');const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
console.log('CANVAS',JSON.stringify(box));
// essai 1 : retrouver l'instance via les fibres React
const inst=await p.evaluate(()=>{
  let c=document.querySelector('canvas'), k=null;
  while(c && !(k=Object.keys(c).find(k=>k.startsWith('__reactFiber$')))) c=c.parentElement;
  if(!k) return 'pas de fibre';
  let f=c[k], n=0, trouve=null;
  const test=(o)=>o&&typeof o==='object'&&typeof o.graph2ScreenCoords==='function';
  while(f&&n<60){
    if(test(f.stateNode)) {trouve='stateNode';window.__g=f.stateNode;break;}
    let ms=f.memoizedState;let d=0;
    while(ms&&d<30){ if(test(ms.memoizedState)){trouve='hook';window.__g=ms.memoizedState;break;} if(ms.memoizedState&&test(ms.memoizedState.current)){trouve='hook.current';window.__g=ms.memoizedState.current;break;} ms=ms.next;d++; }
    if(trouve)break;
    if(f.ref&&test(f.ref.current)){trouve='ref';window.__g=f.ref.current;break;}
    f=f.return;n++;
  }
  return trouve||'introuvable';
});
console.log('INSTANCE',inst);
let cible=null;
if(inst!=='introuvable'&&inst!=='pas de fibre'){
  cible=await p.evaluate(()=>{
    const g=window.__g; const d=g.graphData(); const c=document.querySelector('canvas').getBoundingClientRect();
    const notes=d.nodes.filter(n=>!String(n.id).startsWith('fam:'));
    for(const n of notes){ const s=g.graph2ScreenCoords(n.x,n.y,n.z); if(s.x>20&&s.y>20&&s.x<c.width-20&&s.y<c.height-20) return {id:n.id,label:n.label,x:c.x+s.x,y:c.y+s.y}; }
    return null;
  });
}
console.log('CIBLE',JSON.stringify(cible));
if(cible){
  await p.mouse.move(cible.x,cible.y); await p.waitForTimeout(800);
  const cur=await p.evaluate(()=>getComputedStyle(document.querySelector('canvas')).cursor);
  console.log('CURSEUR sur le point',cur);
  await p.mouse.click(cible.x,cible.y); await p.waitForTimeout(9000);
  const r=await p.evaluate(()=>{const l=document.querySelector('#note-ouverte'); const liste=document.querySelector('div[hidden]')?null:null; return {ouverte:l?l.innerText.split('\n').slice(0,2):null, vue:[...document.querySelectorAll('button')].filter(b=>['Liste','Graphe'].includes(b.innerText.trim())).map(b=>b.innerText.trim()+':'+(b.className.includes('bg-surface')?'actif':'-'))};});
  console.log('APRES_CLIC_NOEUD',JSON.stringify(r),'| attendu', cible.id);
  await p.screenshot({path:OUT+'/agents-apres-clic-noeud.png'});
}
console.log('LOGS',JSON.stringify(logs.slice(0,10)));
await b.close();
