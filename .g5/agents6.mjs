import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,180));});
await p.goto('http://localhost:3000/modules/agents-ia',{waitUntil:'networkidle',timeout:200000});
await p.waitForTimeout(14000);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Graphe');b&&b.click();});
await p.waitForTimeout(35000);
await p.evaluate(()=>document.querySelector('canvas').scrollIntoView({block:'center'}));
await p.waitForTimeout(3000);
const zone=await p.$('canvas');
const a=await zone.screenshot({path:OUT+'/rec-avant.png'});
// dezoomer fort a la molette pour ensuite verifier que Recadrer ramene
const bb=await zone.boundingBox();
await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2);
for(let i=0;i<10;i++){ await p.mouse.wheel(0,400); await p.waitForTimeout(150); }
await p.waitForTimeout(3000);
const c=await zone.screenshot({path:OUT+'/rec-dezoom.png'});
console.log('molette change la vue ?', Buffer.compare(a,c)!==0);
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='Recadrer');b&&b.click();});
await p.waitForTimeout(7000);
const d=await zone.screenshot({path:OUT+'/rec-apres.png'});
console.log('Recadrer change la vue ?', Buffer.compare(c,d)!==0);
console.log('LOGS',JSON.stringify(logs.slice(0,6)));
await b.close();
