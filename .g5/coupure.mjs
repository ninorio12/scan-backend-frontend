import { chromium } from 'playwright';
const OUT='/tmp/claude-0/-root/2a498558-abf1-4136-9309-84369033f8e0/scratchpad/g5';
const HOST='formal-porcupine-257.eu-west-1.convex.cloud';
const b=await chromium.launch({args:['--host-resolver-rules=MAP '+HOST+' 0.0.0.0','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const logs=[]; p.on('console',m=>{if(m.type()==='error')logs.push(m.text().slice(0,160));});
for(const url of ['/modules/bibliotheque','/modules/documents','/modules/agents-ia']){
  await p.goto('http://localhost:3000'+url,{waitUntil:'networkidle',timeout:200000}).catch(e=>console.log('GOTO_ERR',url,String(e).slice(0,80)));
  await p.waitForTimeout(20000);
  const t=await p.evaluate(()=>document.body.innerText);
  const chiffres=t.match(/\b\d[\d\s ]{2,}\b/g);
  console.log('=== COUPÉ',url,'len',t.length);
  console.log('   chiffres visibles', JSON.stringify(chiffres));
  console.log('   squelettes', await p.evaluate(()=>document.querySelectorAll('.animate-pulse').length));
  console.log('   extrait', JSON.stringify(t.slice(240,700)));
  await p.screenshot({path:OUT+'/coupe-'+url.split('/').pop()+'.png'});
}
console.log('LOGS',JSON.stringify(logs.slice(0,6)));
await b.close();
