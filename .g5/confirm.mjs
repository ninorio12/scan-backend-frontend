import { chromium } from 'playwright';
const HOST='formal-porcupine-257.eu-west-1.convex.cloud';
/* 1) contre-épreuve : faux « dossier vide » sur une recherche sans résultat */
{
  const b=await chromium.launch(); const p=await b.newPage();
  await p.goto('http://localhost:3000/modules/bibliotheque',{waitUntil:'networkidle',timeout:200000});
  await p.waitForTimeout(9000);
  const enter=async(n)=>{await p.evaluate(n=>{const c=[...document.querySelectorAll('div.group.relative')].find(d=>{const s=d.querySelector('button span span');return s&&s.innerText.trim()===n;}); c&&c.querySelector('button').click();},n); await p.waitForTimeout(7000);};
  for(const dossier of ['Rapports Pipedrive BNI','PROPRIETAIRE par commune']){
    await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Bibliothèque');b&&b.click();});
    await p.waitForTimeout(3500);
    await enter(dossier);
    const avant=await p.evaluate(()=>({d:document.querySelectorAll('div.group.relative').length,f:document.querySelectorAll('div.group.flex.items-center.gap-3').length}));
    await p.fill('input[placeholder="Chercher dans ce dossier…"]','qqqzzz');
    await p.waitForTimeout(3500);
    const apres=await p.evaluate(()=>document.body.innerText.includes('Ce dossier est vide')?document.body.innerText.slice(-140):'(pas de message vide)');
    console.log('VIDE?',dossier,JSON.stringify(avant),'->',JSON.stringify(apres));
    await p.fill('input[placeholder="Chercher dans ce dossier…"]','');
    await p.waitForTimeout(2500);
  }
  /* 2) couleurs des pastilles : chip vs ligne de liste */
  await b.close();
}
{
  const b=await chromium.launch(); const p=await b.newPage();
  await p.goto('http://localhost:3000/modules/agents-ia',{waitUntil:'networkidle',timeout:200000});
  await p.waitForTimeout(14000);
  const c=await p.evaluate(()=>{
    const chips={}; document.querySelectorAll('div.mt-2\\.5.flex.flex-wrap button').forEach(b=>{const n=b.innerText.split('\n')[0].trim(); chips[n]=getComputedStyle(b.querySelector('svg')||b).color;});
    const lignes={}; document.querySelectorAll('button.tap.flex.items-center.gap-2\\.5 span[style]').forEach(s=>{const n=s.innerText.trim(); lignes[n]=getComputedStyle(s).color;});
    return {chips,lignes};
  });
  console.log('COULEURS',JSON.stringify(c,null,1));
  await b.close();
}
/* 3) seconde coupure Convex */
{
  const b=await chromium.launch({args:['--host-resolver-rules=MAP '+HOST+' 0.0.0.0']});
  const p=await b.newPage();
  for(const u of ['/modules/bibliotheque','/modules/documents']){
    await p.goto('http://localhost:3000'+u,{waitUntil:'networkidle',timeout:200000}).catch(()=>{});
    await p.waitForTimeout(30000);
    const t=await p.evaluate(()=>document.body.innerText);
    console.log('COUPURE2',u,'len',t.length,'squelettes',await p.evaluate(()=>document.querySelectorAll('.animate-pulse').length),'message erreur ?',/erreur|panne|indisponible|hors ligne|connexion/i.test(t));
  }
  await b.close();
}
