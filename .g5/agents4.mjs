import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,200));});
p.on('pageerror',e=>logs.push('pageerror: '+String(e).slice(0,250)));
await p.goto('http://localhost:3000/modules/agents-ia',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(14000);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Graphe');b&&b.click();});
await p.waitForTimeout(30000);
await p.evaluate(()=>document.querySelector('canvas').scrollIntoView({block:'center'}));
await p.waitForTimeout(3000);
let box=await p.evaluate(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
console.log('CANVAS_VISIBLE',JSON.stringify(box));
// balayage in-page : on cherche un point où le curseur passe en "pointer"
const hit=await p.evaluate(async(box)=>{
  const c=document.querySelector('canvas');
  const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const trouves=[];
  for(let y=box.y+20;y<box.y+box.h-20;y+=22){
    for(let x=box.x+20;x<box.x+box.w-20;x+=22){
      c.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y,bubbles:true,pointerId:1,pointerType:'mouse'}));
      await frame();
      if(getComputedStyle(c).cursor==='pointer'){ trouves.push({x,y}); if(trouves.length>=6) return trouves; }
    }
  }
  return trouves;
},box);
console.log('POINTS_SURVOLES',JSON.stringify(hit));
if(hit.length){
  for(const pt of hit.slice(0,3)){
    await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Graphe');b&&b.click();});
    await p.waitForTimeout(1500);
    await p.evaluate(()=>document.querySelector('canvas').scrollIntoView({block:'center'}));
    await p.waitForTimeout(1500);
    await p.mouse.move(pt.x,pt.y); await p.waitForTimeout(900);
    const cur=await p.evaluate(()=>getComputedStyle(document.querySelector('canvas')).cursor);
    await p.mouse.down(); await p.waitForTimeout(120); await p.mouse.up();
    await p.waitForTimeout(9000);
    const r=await p.evaluate(()=>({
      note:document.querySelector('#note-ouverte')?.innerText.split('\n').slice(0,2)||null,
      vue:[...document.querySelectorAll('button')].filter(b=>['Liste','Graphe'].includes(b.innerText.trim())).map(b=>b.innerText.trim()+(b.className.includes('bg-surface')?'=actif':'')),
      famille:[...document.querySelectorAll('div.mt-2\\.5.flex.flex-wrap button')].filter(b=>b.style.background&&b.style.background!=='transparent').map(b=>b.innerText.replace(/\n/g,' ')),
    }));
    console.log('CLIC',JSON.stringify(pt),'curseur',cur,'->',JSON.stringify(r));
    await p.screenshot({path:OUT+'/agents-clic-'+pt.x+'-'+pt.y+'.png'});
    // refermer
    await p.evaluate(()=>{const b=document.querySelector('button[aria-label="Fermer la note"]');b&&b.click();});
    await p.waitForTimeout(1200);
  }
}
console.log('LOGS',JSON.stringify(logs.slice(0,10)));
await b.close();
