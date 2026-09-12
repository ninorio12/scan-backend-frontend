import { chromium } from 'playwright';
const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p=await b.newPage(); await p.setViewportSize({width:1500,height:1000});
const compte=async(url,extra)=>{
  await p.goto('http://localhost:3000'+url,{waitUntil:'networkidle',timeout:200000});
  await p.waitForTimeout(14000);
  const r=await p.evaluate(()=>{
    const shell=document.querySelector('aside, nav');
    const tous=[...document.querySelectorAll('button, a[href], input:not([type=file]), [role=checkbox]')];
    const dedans=tous.filter(e=>!(shell&&shell.contains(e)));
    const cls=(e)=>{
      const l=(e.getAttribute('aria-label')||'')+' '+(e.getAttribute('data-tip')||'')+' '+e.innerText.trim();
      if(/Supprimer/i.test(l)) return 'destructeur';
      if(e.tagName==='INPUT') return 'champ';
      if(e.tagName==='A') return 'lien';
      return 'bouton';
    };
    const m={};
    dedans.forEach(e=>{const c=cls(e);m[c]=(m[c]||0)+1;});
    return {total:tous.length, horsShell:dedans.length, parType:m};
  });
  console.log(url, JSON.stringify(r), extra||'');
};
await compte('/modules/bibliotheque','(racine)');
await compte('/modules/documents','(page 1, Tous)');
await compte('/modules/agents-ia','(liste)');
await b.close();
