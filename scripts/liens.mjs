#!/usr/bin/env node
/**
 * liens.mjs : où mènent les liens, pour de vrai.
 *
 *     node liens.mjs http://localhost:3000 [--depart /,/modules/biens] [--max 120] [--json f]
 *
 * L'analyse du code sait dire qu'un lien pointe vers une page qui n'existe pas. Elle
 * se trompe dans les deux sens : elle rate les redirections et les réécritures, et
 * elle crie sur des routes dynamiques parfaitement valides. Ici on suit les liens
 * dans le navigateur et on regarde ce que le serveur répond. C'est sans appel.
 *
 * TROIS VERDICTS
 *   MORT      le lien mène à une page qui n'existe pas (404), qui plante (5xx), ou qui
 *             répond autre chose que du HTML (un JSON brut à l'écran, pour le client,
 *             c'est une page cassée)
 *   VIDE      la page répond, mais elle est vide de contenu : le client voit un écran
 *             blanc, ce qui pour lui revient au même qu'une page absente
 *   OK        la page répond et affiche quelque chose
 *
 * On suit les liens INTERNES seulement. Les liens externes, les `tel:` et les
 * `mailto:` sortent du produit : les tester reviendrait à tester le web.
 *
 * ON NE CONCLUT JAMAIS SANS PAGE : si aucune page de départ ne se charge, ou si ce qui
 * se charge n'est pas l'application (écran de connexion, JSON, redirection hors
 * domaine), code 2 et un message. Jamais « Tous les liens mènent quelque part » sur
 * une application éteinte. Et ce que --max laisse de côté est compté et nommé.
 *
 * CODES DE SORTIE : 0 tout mène quelque part · 1 au moins un MORT ou VIDE · 2 pas de page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chargerNavigateur } from './navigateur.mjs';
import { ecrireJson } from './dossier-backend.mjs';
const chromium = chargerNavigateur(process.cwd());  // une URL n'est pas un chemin

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const DEPART = arg('--depart', '/').split(',').map((s) => s.trim()).filter(Boolean);
const MAX = Number(arg('--max', 120));

if (!/^https?:\/\//.test(BASE)) { console.error('usage: node liens.mjs <url> [--depart /a,/b] [--max 120] [--json f]'); process.exit(2); }

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Sommes-nous dans l'application ? (même règle que clics.mjs) ─────────────── */
async function pasDansLapp(page, rep, urlCible) {
  const ct = (rep.headers()['content-type'] || '').toLowerCase();
  if (ct && !/text\/html|application\/xhtml/.test(ct)) return `réponse non-HTML (${ct.split(';')[0]})`;
  const vise = new URL(urlCible).host, ici = new URL(page.url()).host;
  if (vise !== ici) return `redirigé hors de l'application, vers ${ici}`;
  const m = await page.evaluate(() => {
    const texte = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const motDePasse = !!document.querySelector('input[type="password"]');
    const clerk = !!document.querySelector('[class*="cl-signIn"],[class*="cl-signUp"],[class*="cl-rootBox"] form,#clerk-captcha');
    const auth = !!document.querySelector('form[action*="/api/auth/"],form[action*="sign-in"],form[action*="login"],[data-supabase-auth-ui]');
    const motsConnexion = /\b(sign in|sign up|log in|se connecter|connectez-vous|créer un compte|mot de passe oublié)\b/i.test(texte.slice(0, 500));
    return { taille: texte.length, motDePasse, clerk, auth, motsConnexion, formulaire: !!document.querySelector('form,input') };
  });
  if (m.motDePasse) return 'écran de connexion (champ mot de passe)';
  if (m.clerk) return 'écran de connexion Clerk';
  if (m.auth) return 'écran de connexion d\'un fournisseur d\'authentification';
  if (m.motsConnexion && m.formulaire) return 'écran de connexion (formulaire « se connecter »)';
  if (m.taille < 200) return `corps quasi vide (${m.taille} caractères de texte)`;
  return null;
}

(async () => {
  const nav = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const entete = () => { console.log(`\n  LIENS : ${BASE}`); console.log(`  ${'-'.repeat(72)}`); };

  /* 1. Récolte : tous les liens internes, et d'où ils viennent. */
  const liens = new Map();      // href → [pages qui le portent]
  const vues = new Set();
  const file = [...DEPART];
  const departsRates = [];      // pages de départ qui ne se chargent pas, ou hors app
  let pagesChargees = 0;

  while (file.length && vues.size < 40) {
    const p = file.shift();
    if (vues.has(p)) continue;
    vues.add(p);
    const rep = await page.goto(BASE + p, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null);
    if (!rep) { departsRates.push({ page: p, pourquoi: 'ne répond pas' }); continue; }
    if (rep.status() >= 400) { departsRates.push({ page: p, pourquoi: `le serveur répond ${rep.status()}` }); continue; }
    await dormir(900);
    const horsApp = await pasDansLapp(page, rep, BASE + p);
    if (horsApp) { departsRates.push({ page: p, pourquoi: `pas dans l'application : ${horsApp}` }); continue; }
    pagesChargees++;
    const trouves = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
      .map((a) => ({ href: a.getAttribute('href'), texte: (typeof a.innerText === 'string' ? a.innerText : a.textContent || '').trim().slice(0, 45) }))
      .filter((l) => l.href && l.href.startsWith('/') && !l.href.startsWith('//')));
    for (const l of trouves) {
      const h = l.href.split('#')[0];
      if (!h) continue;
      if (!liens.has(h)) liens.set(h, { texte: l.texte, depuis: [] });
      liens.get(h).depuis.push(p);
      /* On explore à leur tour les pages de premier et deuxième niveau, pour récolter
         leurs liens. Le motif était `/modules/<x>` en dur : c'est la convention d'UN
         projet. Les autres rangent leurs écrans à la racine, et l'exploration
         s'arrêtait à la première page sans rien dire. */
      const niveaux = h.split('/').filter(Boolean).length;
      if (niveaux >= 1 && niveaux <= 2 && !/\.\w+$/.test(h) && !vues.has(h)) file.push(h);
    }
  }

  /* ON NE CONCLUT PAS SANS PAGE. Aucune page de départ chargée = rien n'a été suivi. */
  if (!pagesChargees) {
    entete();
    console.log(`  ⛔ Aucune page de départ n'a pu être chargée dans l'application. Aucun lien suivi.`);
    for (const d of departsRates.slice(0, 8)) console.log(`     ${d.page}  ${d.pourquoi}`);
    console.log();
    await nav.close(); process.exit(2);
  }

  /* 2. Vérification : chaque lien, une fois, dans le navigateur. */
  const R = { base: BASE, pages_explorees: pagesChargees, liens: liens.size, verdicts: [], non_verifies: [], departs_rates: departsRates };
  let n = 0;
  for (const [href, info] of liens) {
    if (n++ >= MAX) { R.non_verifies.push(href); continue; }
    let statut = 0, ct = '';
    const rep = await page.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 35000 })
      .catch(() => null);
    if (rep) { statut = rep.status(); ct = (rep.headers()['content-type'] || '').toLowerCase().split(';')[0]; }
    await dormir(500);
    const t = await page.evaluate(() => document.body.innerText.trim()).catch(() => '');

    let verdict = 'OK', pourquoi = '';
    if (!rep) { verdict = 'MORT'; pourquoi = 'aucune réponse'; }
    else if (statut >= 400) { verdict = 'MORT'; pourquoi = `le serveur répond ${statut}`; }
    else if (ct && !/text\/html|application\/xhtml/.test(ct)) { verdict = 'MORT'; pourquoi = `réponse non-HTML (${ct})`; }
    else if (/^404\b|page could not be found|introuvable|not found/i.test(t.slice(0, 120))) {
      verdict = 'MORT'; pourquoi = 'la page affiche « introuvable »';
    } else if (t.length < 60) { verdict = 'VIDE'; pourquoi = `${t.length} caractères à l'écran`; }

    if (verdict !== 'OK') {
      R.verdicts.push({ href, texte: info.texte, verdict, pourquoi,
        depuis: [...new Set(info.depuis)].slice(0, 4) });
    }
  }
  await nav.close();

  entete();
  console.log(`  ${R.pages_explorees} pages explorées · ${R.liens - R.non_verifies.length} liens distincts suivis`
    + `${R.non_verifies.length ? ` · ${R.non_verifies.length} NON vérifiés (--max ${MAX})` : ''}\n`);
  for (const v of ['MORT', 'VIDE']) {
    const l = R.verdicts.filter((x) => x.verdict === v);
    if (!l.length) continue;
    console.log(`  ${v} (${l.length})`);
    for (const x of l) {
      console.log(`    ${x.href}   ${x.pourquoi}`);
      console.log(`      « ${x.texte || 'sans libellé'} »  depuis ${x.depuis.join(', ')}`);
    }
    console.log();
  }
  if (departsRates.length) {
    console.log(`  PAGES DE DÉPART NON EXPLORÉES (${departsRates.length})`);
    for (const d of departsRates) console.log(`    ${d.page}   ${d.pourquoi}`);
    console.log();
  }
  if (R.non_verifies.length) {
    console.log(`  NON VÉRIFIÉS (${R.non_verifies.length})  : au-delà de --max ${MAX}, on ne sait pas où ils mènent`);
    for (const h of R.non_verifies.slice(0, 20)) console.log(`    ${h}`);
    if (R.non_verifies.length > 20) console.log(`    … et ${R.non_verifies.length - 20} autres`);
    console.log();
  }
  if (!R.verdicts.length && !R.non_verifies.length && !departsRates.length) console.log('  Tous les liens mènent quelque part.\n');
  else if (!R.verdicts.length) console.log('  Tous les liens VÉRIFIÉS mènent quelque part.\n');

  const j = arg('--json', null);
  if (j) ecrireJson(process.cwd(), 'liens.json', R, j);
  process.exitCode = R.verdicts.length ? 1 : 0;
})();
