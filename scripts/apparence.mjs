#!/usr/bin/env node
/**
 * apparence.mjs : « à quoi ça ressemble ». Le contrôle visuel d'un écran.
 *
 *     node apparence.mjs http://localhost:3000/modules/biens
 *     node apparence.mjs <url> --json f --large 1440 --etroit 390
 *
 * ON NE CONCLUT JAMAIS SANS PAGE : adresse muette, 404, ou page qui n'est pas
 * l'application (écran de connexion, JSON brut, redirection hors domaine, corps quasi
 * vide) : code 2 et un message, jamais « Rien à signaler ».
 *
 * CODES DE SORTIE : 0 rien à signaler · 1 au moins un constat · 2 pas de page.
 *
 * POURQUOI PAS DE COMPARAISON D'IMAGES
 *
 * La méthode habituelle compare une capture à une capture de référence. Elle exige
 * qu'on ait une référence (on ne l'a pas), elle hurle dès qu'un chiffre change (nos
 * écrans lisent une base vivante), et elle ne dit jamais CE QUI ne va pas, seulement
 * que des pixels ont bougé. Inutilisable ici.
 *
 * On vérifie donc des INVARIANTS DE MISE EN PAGE : des choses qui ne doivent jamais
 * arriver, quel que soit le contenu. Chacune est mesurée sur la géométrie réelle des
 * éléments, pas sur une impression.
 *
 *   DÉBORDE    la page glisse horizontalement, ou un texte sort de sa boîte
 *   TRONQUÉ    un texte est coupé par sa boîte (le client ne lit pas la fin)
 *   CHEVAUCHE  deux éléments cliquables se recouvrent (l'un est inatteignable)
 *   INVISIBLE  un texte dont la couleur est trop proche de son fond
 *   VIDE       un bloc occupe une grande surface et ne contient rien
 *   CASSÉ      une image ne charge pas
 *   HORS-ÉCRAN un élément cliquable est en dehors de la zone visible
 *
 * On contrôle en LARGE et en ÉTROIT : la moitié des défauts de mise en page
 * n'existent qu'à l'une des deux tailles.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chargerNavigateur } from './navigateur.mjs';
import { ecrireJson } from './dossier-backend.mjs';
const chromium = chargerNavigateur(process.cwd());  // une URL n'est pas un chemin

const URL_CIBLE = process.argv[2];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
if (!URL_CIBLE || !/^https?:\/\//.test(URL_CIBLE)) {
  console.error('usage: node apparence.mjs <url> [--json f] [--large 1440] [--etroit 390]'); process.exit(2);
}

const LARGE = Number(arg('--large', 1440));
const ETROIT = Number(arg('--etroit', 390));

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

/* Tout se mesure dans la page : une seule fonction, exécutée dans le navigateur.

   Liste négative, ce qu'on ne signale PAS : un SVG ou un MathML (ils n'ont pas
   d'innerText, et un graphique n'est pas un « bloc vide ») ; un texte porté par un
   enfant (on ne le compte qu'une fois, sur l'élément qui le porte) ; un chevauchement
   d'éléments imbriqués (c'est normal) ; un fond transparent (rien à comparer). */
function controler() {
  const out = [];
  /* innerText n'existe que sur HTMLElement : sur un <svg> il vaut undefined et
     `.trim()` plantait tout le contrôle (tableau de bord d'un client, un graphique de 400×300).
     Deux gardes : on ne parcourt que des HTMLElement, et texte() tolère le reste. */
  const texte = (e) => (typeof e.innerText === 'string' ? e.innerText : (e.textContent || ''));
  const vis = (e) => {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0';
  };
  const nom = (e) => {
    const t = (texte(e) || e.getAttribute('aria-label') || e.alt || '').trim().replace(/\s+/g, ' ');
    return t ? t.slice(0, 55) : `<${e.tagName.toLowerCase()}>`;
  };
  const ou = (e) => {
    // Un chemin court et lisible, pour qu'on retrouve l'élément dans le code.
    const p = [];
    for (let n = e; n && n !== document.body && p.length < 3; n = n.parentElement) {
      p.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string'
        ? '.' + n.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''));
    }
    return p.join(' > ').slice(0, 90);
  };

  // 1. La page glisse-t-elle horizontalement ?
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) {
    out.push({ type: 'DÉBORDE', quoi: 'la page entière',
      detail: `${de.scrollWidth}px de contenu dans ${de.clientWidth}px de fenêtre`, ou: 'body' });
  }

  const tous = [...document.querySelectorAll('body *')].filter((e) => e instanceof HTMLElement).filter(vis);

  for (const e of tous) {
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    const propre = texte(e) && [...e.children].every((c) => !texte(c));  // le texte est à LUI

    // 2. Un texte sort de sa boîte, ou y est coupé.
    if (propre && e.scrollWidth > e.clientWidth + 4 && e.clientWidth > 0) {
      const coupe = /hidden|clip/.test(s.overflowX) || s.textOverflow === 'ellipsis';
      out.push({ type: coupe ? 'TRONQUÉ' : 'DÉBORDE', quoi: nom(e),
        detail: `${e.scrollWidth}px de texte dans ${e.clientWidth}px`, ou: ou(e) });
    }
    if (propre && e.scrollHeight > e.clientHeight + 6 && /hidden|clip/.test(s.overflowY) && e.clientHeight > 0) {
      out.push({ type: 'TRONQUÉ', quoi: nom(e),
        detail: `${e.scrollHeight}px de hauteur dans ${e.clientHeight}px, le bas est coupé`, ou: ou(e) });
    }

    // 3. Un texte invisible : couleur trop proche du fond.
    if (propre && texte(e).trim().length > 2) {
      const lum = (c) => {
        const m = c.match(/[\d.]+/g); if (!m || m.length < 3) return null;
        if (m[3] !== undefined && Number(m[3]) === 0) return null;           // transparent
        const [r0, g0, b0] = m.map(Number).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
        return .2126 * r0 + .7152 * g0 + .0722 * b0;
      };
      let fond = null;
      for (let n = e; n && !fond; n = n.parentElement) {
        const b = getComputedStyle(n).backgroundColor;
        if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) fond = b;
      }
      const a = lum(s.color), b = lum(fond || 'rgb(255,255,255)');
      if (a !== null && b !== null) {
        const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        if (ratio < 1.6) out.push({ type: 'INVISIBLE', quoi: nom(e),
          detail: `contraste ${ratio.toFixed(2)} contre le fond (illisible en dessous de 3)`, ou: ou(e) });
      }
    }

    // 4. Un grand bloc parfaitement vide.
    if (r.width > 220 && r.height > 120 && !texte(e).trim()
        && !e.querySelector('img,svg,canvas,video,input,iframe')
        && /rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor) === false) {
      out.push({ type: 'VIDE', quoi: nom(e),
        detail: `bloc de ${Math.round(r.width)}×${Math.round(r.height)}px sans contenu`, ou: ou(e) });
    }
  }

  // 5. Images cassées.
  for (const img of [...document.images]) {
    if (img.complete && img.naturalWidth === 0 && vis(img)) {
      out.push({ type: 'CASSÉ', quoi: img.alt || img.src.split('/').pop(),
        detail: 'l\'image ne charge pas', ou: img.src.slice(-70) });
    }
  }

  // 6. Éléments cliquables : hors écran, ou qui se recouvrent.
  const clic = [...document.querySelectorAll('button,a[href],[role="button"],input,select')]
    .filter((e) => e instanceof HTMLElement).filter(vis).map((e) => ({ e, r: e.getBoundingClientRect() }));

  for (const { e, r } of clic) {
    if (r.right < 0 || r.left > de.clientWidth + 2 || r.bottom < 0) {
      out.push({ type: 'HORS-ÉCRAN', quoi: nom(e),
        detail: `à x=${Math.round(r.left)} dans une fenêtre de ${de.clientWidth}px`, ou: ou(e) });
    }
  }
  for (let i = 0; i < clic.length; i++) {
    for (let j = i + 1; j < clic.length; j++) {
      const A = clic[i], B = clic[j];
      if (A.e.contains(B.e) || B.e.contains(A.e)) continue;        // imbriqués : normal
      const x = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
      const y = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
      if (x <= 2 || y <= 2) continue;
      const part = (x * y) / Math.min(A.r.width * A.r.height, B.r.width * B.r.height);
      if (part > 0.45) {
        out.push({ type: 'CHEVAUCHE', quoi: `« ${nom(A.e)} » et « ${nom(B.e)} »`,
          detail: `${Math.round(part * 100)} % de recouvrement : l'un des deux est difficile à atteindre`,
          ou: ou(A.e) });
      }
    }
  }
  return out;
}

(async () => {
  const nav = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const R = { url: URL_CIBLE, tailles: {} };
  const refuser = async (pourquoi) => {
    console.log(`\n  APPARENCE : ${URL_CIBLE}\n  ${'-'.repeat(72)}\n  ⛔ ${pourquoi} Rien n'a été contrôlé.\n`);
    await nav.close(); process.exit(2);
  };

  for (const [nomTaille, w] of [['large', LARGE], ['étroit', ETROIT]]) {
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 } });
    const page = await ctx.newPage();
    /* ON NE CONCLUT PAS SANS PAGE. Avant : application éteinte = « Rien à signaler »,
       code 0. Un audit qui rassure sur ce qu'il n'a pas regardé est pire qu'aucun audit. */
    const rep = await page.goto(URL_CIBLE, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => null);
    if (!rep) await refuser(`Impossible de charger la page : ${URL_CIBLE} ne répond pas.`);
    if (rep.status() >= 400) await refuser(`Le serveur répond ${rep.status()} sur ${URL_CIBLE}.`);
    await page.waitForTimeout(1500);
    const t = await page.evaluate(() => document.body.innerText.slice(0, 120));
    if (/^404\b|page could not be found|introuvable/i.test(t)) await refuser(`Cette page n'existe pas (404 affiché).`);
    const horsApp = await pasDansLapp(page, rep, URL_CIBLE);
    if (horsApp) await refuser(`Je ne suis pas dans l'application : ${horsApp}.`);
    try {
      R.tailles[nomTaille] = await page.evaluate(controler);
    } catch (e) {
      await refuser(`Le contrôle a planté dans la page : ${String(e.message).split('\n')[0].slice(0, 160)}.`);
    }
    await ctx.close();
  }
  await nav.close();

  /* Ce qui n'apparaît qu'à une seule taille est un défaut de mise en page ;
     ce qui apparaît aux deux est un défaut tout court. On le dit. */
  const cle = (d) => `${d.type}|${d.quoi}|${d.ou}`;
  const enLarge = new Set(R.tailles.large.map(cle));
  const enEtroit = new Set(R.tailles['étroit'].map(cle));
  const tous = [...R.tailles.large, ...R.tailles['étroit']];
  const vus = new Set(); const liste = [];
  for (const d of tous) {
    const k = cle(d);
    if (vus.has(k)) continue; vus.add(k);
    liste.push({ ...d, ou_quand: enLarge.has(k) && enEtroit.has(k) ? 'aux deux tailles'
      : enLarge.has(k) ? `seulement en ${LARGE}px` : `seulement en ${ETROIT}px` });
  }
  R.constats = liste;

  console.log(`\n  APPARENCE : ${URL_CIBLE}`);
  console.log(`  ${'-'.repeat(72)}`);
  console.log(`  contrôlé en ${LARGE}px et en ${ETROIT}px · ${liste.length} constat${liste.length > 1 ? 's' : ''}\n`);
  const ordre = ['CASSÉ', 'INVISIBLE', 'TRONQUÉ', 'DÉBORDE', 'CHEVAUCHE', 'HORS-ÉCRAN', 'VIDE'];
  for (const t of ordre) {
    const l = liste.filter((d) => d.type === t);
    if (!l.length) continue;
    console.log(`  ${t} (${l.length})`);
    for (const d of l.slice(0, 6)) {
      console.log(`    « ${d.quoi} »  ${d.detail}  [${d.ou_quand}]`);
      console.log(`      ${d.ou}`);
    }
    if (l.length > 6) console.log(`    … et ${l.length - 6} autres`);
    console.log();
  }
  if (!liste.length) console.log('  Rien à signaler.\n');

  const j = arg('--json', null);
  if (j) ecrireJson(process.cwd(), 'apparence.json', R, j);
  process.exitCode = liste.length ? 1 : 0;
})();
