#!/usr/bin/env node
/**
 * verifier-affirmation.mjs — on rejoue l'affirmation d'un agent, et on tranche.
 *
 * Sans LLM. Sans réseau sortant. Le code se vérifie en lisant le fichier, l'écran en
 * rouvrant la page : cliquer, recharger, comparer. Aucune vérification ne modifie quoi
 * que ce soit dans le projet audité, et la seule famille qui écrit (bouton_ne_persiste_pas)
 * refuse de partir sans --ecriture-permise.
 *
 *     node verifier-affirmation.mjs <lot.json> --repo <dépôt> --base http://localhost:3000
 *     node verifier-affirmation.mjs <lot.json> --repo . --json resultats.json --ecriture-permise
 *
 * QUATRE DISPOSITIONS, jamais une cinquième (le catalogue est dans affirmations.mjs) :
 * confirmée · infirmée · invérifiable · hors-sujet. Il n'existe pas de « probablement
 * vrai » : c'est précisément le mot qui a laissé passer les faux constats du 12/09/2026.
 *
 * EN SORTIE : le tableau des affirmations, puis le TAUX du lot. Sous le seuil, le lot est
 * REJETÉ et l'agent refait. C'est la boucle qui manquait à toute la chaîne.
 *
 * CODES DE SORTIE : 0 lot accepté · 1 lot rejeté · 2 rien n'a pu tourner (usage, lot illisible).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TYPES, valider, lireLot, taux, pourcent, estDisposition } from './affirmations.mjs';
import { chargerNavigateur } from './navigateur.mjs';

/* ── Ce qu'on ne clique jamais ───────────────────────────────────────────────
   Reprise mot pour mot de clics.mjs : la base contient les vraies données du client.
   DESTRUCTEUR est un refus absolu, même avec --ecriture-permise. ECRITURE est un refus
   par défaut, que --ecriture-permise lève (base de test, consentement donné).          */
/* Une seule différence avec clics.mjs : « déconnexion » s'écrit avec un x et passait
   entre les mailles de « déconnect ». Un vérificateur qui déconnecte la session du
   client casse tout le reste du lot. */
const DESTRUCTEUR = /supprim|delete|effac|vider|vide|purg|réinitialis|reinitialis|reset|archiv|déconnect|deconnect|déconnex|deconnex|logout|désactiv|desactiv|révoqu|revoqu|annuler l|retirer/i;
const ECRITURE = /\b(enregistr|sauvegard|save|cr[ée]e|creat|nouveau|nouvel|ajout|add\b|d[ée]pos|upload|t[ée]l[ée]vers|envoy|send\b|publier|publish|valid|confirm|soumet|submit|import|export|synchro|sync\b)/i;

/* Tout ce par quoi une donnée peut arriver. Coupé, l'écran ne doit plus rien savoir. */
const EST_SOURCE = (url) =>
  /\.convex\.(cloud|site)/.test(url) || /\/api\//.test(url) || /supabase|firebase|amazonaws|graphql/.test(url);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── Le contexte d'une vérification ─────────────────────────────────────────── */

export function contexte(options = {}) {
  return {
    repo: path.resolve(options.repo ?? '.'),
    base: (options.base ?? 'http://localhost:3000').replace(/\/+$/, ''),
    ecriturePermise: !!options.ecriturePermise,
    attente: Number(options.attente ?? 2500),
    _navigateur: null,
    async navigateur() {
      if (!this._navigateur) {
        const chromium = chargerNavigateur(this.repo);
        this._navigateur = await chromium.launch();
      }
      return this._navigateur;
    },
    async fermer() {
      if (this._navigateur) { await this._navigateur.close().catch(() => {}); this._navigateur = null; }
    },
  };
}

/* ── L'entrée unique ──────────────────────────────────────────────────────────
   Elle SCELLE la disposition : si un vérificateur rend autre chose que les quatre
   valeurs, ou lève, on ne devine pas — on rend invérifiable en disant pourquoi.     */

export async function verifier(affirmation, ctx) {
  const forme = valider(affirmation);
  if (!forme.ok) return sceller(affirmation, { disposition: 'hors-sujet', raison: forme.raison });

  const fn = VERIFICATEURS[affirmation.type];
  if (!fn) return sceller(affirmation, { disposition: 'hors-sujet', raison: `type sans vérificateur : ${affirmation.type}` });

  try {
    const r = await fn(affirmation, ctx);
    if (!r || !estDisposition(r.disposition)) {
      return sceller(affirmation, { disposition: 'invérifiable', raison: `le vérificateur du type ${affirmation.type} a rendu une disposition hors catalogue (${JSON.stringify(r?.disposition)})` });
    }
    return sceller(affirmation, r);
  } catch (e) {
    return sceller(affirmation, { disposition: 'invérifiable', raison: `la vérification a échoué : ${String(e.message || e).split('\n')[0]}` });
  }
}

function sceller(a, r) {
  return {
    id: a?.id ?? null,
    type: a?.type ?? null,
    dit: a?.dit ?? null,
    disposition: r.disposition,
    raison: r.raison,
    mesure: r.mesure ?? null,
  };
}

export async function verifierLot(affirmations, ctx) {
  const out = [];
  // En série : deux navigations concurrentes sur la même application faussent les mesures.
  for (const a of affirmations) out.push(await verifier(a, ctx));
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CÔTÉ CODE : on lit le fichier, on compare. Rien d'autre.
   ═══════════════════════════════════════════════════════════════════════════════ */

/* Motif : soit /expression/drapeaux, soit du texte littéral. Repris de vercel-optimize. */
function compilerMotif(motif, drapeaux) {
  const m = String(motif).match(/^\/(.+)\/([gimsu]*)$/);
  if (m) return new RegExp(m[1], [...new Set(((m[2] || '') + (drapeaux || '')).split(''))].join(''));
  return new RegExp(String(motif).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), drapeaux);
}

function lireFichier(ctx, chemin) {
  const p = path.isAbsolute(chemin) ? chemin : path.join(ctx.repo, chemin);
  return { chemin: p, contenu: fs.readFileSync(p, 'utf-8') };
}

function ligneDe(contenu, re) {
  const lignes = contenu.split('\n');
  for (let i = 0; i < lignes.length; i++) { re.lastIndex = 0; if (re.test(lignes[i])) return { n: i + 1, texte: lignes[i].trim().slice(0, 120) }; }
  return null;
}

async function verifierFichierContient(a, ctx) {
  if (/^\d+$/.test(String(a.motif).trim())) {
    return { disposition: 'hors-sujet', raison: `« ${a.motif} » est un numéro de ligne recopié, pas un motif : un nombre seul ne prouve rien` };
  }
  let f;
  try { f = lireFichier(ctx, a.chemin); }
  catch { return { disposition: 'invérifiable', raison: `fichier illisible ou absent : ${a.chemin} (dépôt : ${ctx.repo})` }; }
  const re = compilerMotif(a.motif, '');
  const l = ligneDe(f.contenu, compilerMotif(a.motif, ''));
  return re.test(f.contenu)
    ? { disposition: 'confirmée', raison: `motif trouvé${l ? ` à la ligne ${l.n} : ${l.texte}` : ''}`, mesure: { ligne: l?.n ?? null } }
    : { disposition: 'infirmée', raison: `le motif n'est nulle part dans ${a.chemin} (${f.contenu.split('\n').length} lignes lues)` };
}

async function verifierFichierNeContientPas(a, ctx) {
  if (/^\d+$/.test(String(a.motif).trim())) {
    return { disposition: 'hors-sujet', raison: `« ${a.motif} » est un numéro de ligne recopié, pas un motif` };
  }
  let f;
  try { f = lireFichier(ctx, a.chemin); }
  catch { return { disposition: 'invérifiable', raison: `fichier absent : ${a.chemin}. L'absence d'un motif dans un fichier absent ne prouve rien` }; }
  const l = ligneDe(f.contenu, compilerMotif(a.motif, ''));
  return l
    ? { disposition: 'infirmée', raison: `le motif est bien là, ligne ${l.n} : ${l.texte}`, mesure: { ligne: l.n } }
    : { disposition: 'confirmée', raison: `motif absent des ${f.contenu.split('\n').length} lignes de ${a.chemin}` };
}

const IGNORES = new Set(['node_modules', '.next', '.git', '_generated', 'dist', 'build', 'coverage', '.vercel', '.turbo', '.backend']);
const SOURCE = /\.(tsx?|jsx?|mjs|cjs)$/;

function* fichiersSource(racine) {
  let entrees;
  try { entrees = fs.readdirSync(racine, { withFileTypes: true }); } catch { return; }
  for (const e of entrees) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    const p = path.join(racine, e.name);
    if (e.isDirectory()) { if (IGNORES.has(e.name)) continue; yield* fichiersSource(p); continue; }
    if (e.isFile() && SOURCE.test(e.name)) yield p;
  }
}

async function verifierSymboleAppele(a, ctx) {
  const nom = String(a.nom);
  if (nom.length < 3) return { disposition: 'hors-sujet', raison: `« ${nom} » est trop court pour être compté sans bruit (3 caractères minimum)` };
  const racine = a.chemin ? path.join(ctx.repo, a.chemin) : ctx.repo;
  if (!fs.existsSync(racine)) return { disposition: 'invérifiable', raison: `dépôt ou sous-dossier introuvable : ${racine}` };

  const re = new RegExp(`\\b${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const declaration = new RegExp(`\\b(?:function|class|const|let|var|interface|type|enum)\\s+${nom}\\b`);
  const endroits = [];
  let fichiers = 0;
  for (const f of fichiersSource(racine)) {
    fichiers++;
    let contenu;
    try { contenu = fs.readFileSync(f, 'utf-8'); } catch { continue; }
    if (!re.test(contenu)) continue;
    contenu.split('\n').forEach((ligne, i) => {
      if (!re.test(ligne)) return;
      // On ne compte pas la déclaration, ni une ligne d'import ou de ré-export : ce ne sont
      // pas des appels. Sans ça, une fonction importée puis jamais utilisée paraît vivante.
      if (declaration.test(ligne)) return;
      if (/^\s*(?:import|export)\b/.test(ligne) && !new RegExp(`${nom}\\s*\\(`).test(ligne)) return;
      endroits.push({ fichier: path.relative(ctx.repo, f), ligne: i + 1, texte: ligne.trim().slice(0, 100) });
    });
  }
  if (!fichiers) return { disposition: 'invérifiable', raison: `aucun fichier source sous ${racine}` };

  const compte = endroits.length;
  const attendu = Number(a.appels_attendus);
  const apercu = endroits.slice(0, 3).map((e) => `${e.fichier}:${e.ligne}`).join(', ');
  return compte === attendu
    ? { disposition: 'confirmée', raison: `${compte} appel${compte > 1 ? 's' : ''} dans ${fichiers} fichiers${apercu ? ` (${apercu})` : ''}`, mesure: { compte, endroits: endroits.slice(0, 10) } }
    : { disposition: 'infirmée', raison: `annoncé ${attendu}, compté ${compte}${apercu ? ` : ${apercu}` : ''}`, mesure: { compte, attendu, endroits: endroits.slice(0, 10) } };
}

/* Résolution d'une route dans une arborescence de fichiers (App Router, puis Pages Router). */
function routesDuRepo(repo) {
  const out = [];
  const app = ['app', 'src/app'].map((d) => path.join(repo, d)).find((d) => fs.existsSync(d));
  const pages = ['pages', 'src/pages'].map((d) => path.join(repo, d)).find((d) => fs.existsSync(d));

  if (app) {
    const marche = (dir, segments) => {
      let entrees; try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entrees) {
        if (e.isDirectory()) {
          if (IGNORES.has(e.name) || e.name.startsWith('_') || e.name.startsWith('@')) continue;
          // (groupe) ne compte pas dans l'URL.
          const seg = /^\(.+\)$/.test(e.name) ? null : e.name;
          marche(path.join(dir, e.name), seg === null ? segments : [...segments, seg]);
        } else if (/^(page|route)\.(tsx?|jsx?|mjs)$/.test(e.name)) {
          out.push({ route: '/' + segments.join('/'), fichier: path.relative(repo, path.join(dir, e.name)) });
        }
      }
    };
    marche(app, []);
  }
  if (pages) {
    const marche = (dir, segments) => {
      let entrees; try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entrees) {
        if (e.isDirectory()) { if (IGNORES.has(e.name)) continue; marche(path.join(dir, e.name), [...segments, e.name]); }
        else if (/\.(tsx?|jsx?)$/.test(e.name) && !/^_/.test(e.name)) {
          const base = e.name.replace(/\.(tsx?|jsx?)$/, '');
          const segs = base === 'index' ? segments : [...segments, base];
          out.push({ route: '/' + segs.join('/'), fichier: path.relative(repo, path.join(dir, e.name)) });
        }
      }
    };
    marche(pages, []);
  }
  return { routes: out, aArborescence: !!(app || pages) };
}

function routeCorrespond(motif, demande) {
  const m = motif.split('/').filter(Boolean);
  const d = demande.split('/').filter(Boolean);
  for (let i = 0; i < m.length; i++) {
    if (/^\[\[?\.\.\..+\]\]?$/.test(m[i])) return true;           // attrape-tout
    if (i >= d.length) return false;
    if (/^\[.+\]$/.test(m[i])) continue;                          // segment dynamique
    if (m[i] !== d[i]) return false;
  }
  return m.length === d.length;
}

async function verifierRouteExiste(a, ctx) {
  const demande = String(a.route).split('?')[0].replace(/\/+$/, '') || '/';
  const { routes, aArborescence } = routesDuRepo(ctx.repo);
  if (!aArborescence) return { disposition: 'invérifiable', raison: `ni app/ ni pages/ sous ${ctx.repo} : ce projet ne range pas ses routes en fichiers, il faut un autre moyen` };
  const hit = routes.find((r) => routeCorrespond(r.route, demande));
  return hit
    ? { disposition: 'confirmée', raison: `servie par ${hit.fichier}`, mesure: { fichier: hit.fichier } }
    : { disposition: 'infirmée', raison: `aucun fichier ne sert ${demande} (${routes.length} routes trouvées dans le dépôt)`, mesure: { routes: routes.length } };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CÔTÉ RÉSEAU : une requête GET, jamais autre chose. fetch de Node, zéro dépendance.
   ═══════════════════════════════════════════════════════════════════════════════ */

function absolue(u, base) {
  const s = String(u);
  return /^https?:\/\//.test(s) ? s : base + (s.startsWith('/') ? s : `/${s}`);
}

async function appelGet(url, suivre) {
  try {
    const r = await fetch(url, { redirect: suivre ? 'follow' : 'manual', headers: { accept: 'text/html,*/*' } });
    // On lit le corps pour libérer la connexion, sans le garder.
    await r.arrayBuffer().catch(() => {});
    return { statut: r.status, arrivee: r.url || url };
  } catch (e) {
    return { erreur: String(e.cause?.code || e.message || e).split('\n')[0] };
  }
}

async function verifierRequeteEnEchec(a, ctx) {
  const url = absolue(a.url, ctx.base);
  const r = await appelGet(url, false);   // on juge CETTE réponse, pas sa destination
  if (r.erreur) return { disposition: 'invérifiable', raison: `le serveur ne répond pas (${r.erreur}) : l'application est éteinte, on ne peut rien dire de cette adresse` };
  const attendu = Number(a.statut);
  if (r.statut < 400) return { disposition: 'infirmée', raison: `statut ${r.statut}, ce n'est pas un échec`, mesure: { statut: r.statut } };
  return r.statut === attendu
    ? { disposition: 'confirmée', raison: `statut ${r.statut}, comme annoncé`, mesure: { statut: r.statut } }
    : { disposition: 'infirmée', raison: `annoncé ${attendu}, obtenu ${r.statut}`, mesure: { statut: r.statut, attendu } };
}

async function verifierLienMort(a, ctx) {
  const href = String(a.href);
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return { disposition: 'hors-sujet', raison: `« ${href} » n'est pas une adresse du produit` };
  if (/^https?:\/\//.test(href) && !href.startsWith(ctx.base)) {
    return { disposition: 'hors-sujet', raison: `« ${href} » sort du produit : le vérificateur n'appelle jamais l'extérieur` };
  }
  const r = await appelGet(absolue(href, ctx.base), true);  // un humain qui clique suit les redirections
  if (r.erreur) return { disposition: 'invérifiable', raison: `le serveur ne répond pas (${r.erreur})` };
  const attendu = Number(a.statut);
  if (r.statut < 400) return { disposition: 'infirmée', raison: `le lien mène à ${r.arrivee.replace(ctx.base, '')} en ${r.statut} : il n'est pas mort`, mesure: { statut: r.statut, arrivee: r.arrivee } };
  return r.statut === attendu
    ? { disposition: 'confirmée', raison: `${r.statut} au bout du lien (arrivée ${r.arrivee.replace(ctx.base, '')})`, mesure: { statut: r.statut, arrivee: r.arrivee } }
    : { disposition: 'infirmée', raison: `annoncé ${attendu}, obtenu ${r.statut} au bout du lien`, mesure: { statut: r.statut, attendu } };
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CÔTÉ ÉCRAN : on rouvre la page, on clique, on recharge, on compare.
   ═══════════════════════════════════════════════════════════════════════════════ */

/* Le recenseur vit dans la page : une seule façon de désigner un bouton, au recensement
   comme à la re-résolution après un clic qui a changé le DOM. */
const OUTILS_PAGE = `
window.__norm = (s) => (s || '').trim().replace(/\\s+/g, ' ');
window.__cliquables = () => [...document.querySelectorAll(
  'button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],input[type="submit"],summary')];
window.__libelleDe = (el) => window.__norm(
  (typeof el.innerText === 'string' ? el.innerText : el.textContent) ||
  el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').slice(0, 120);
window.__lisible = () => {
  const t = document.body ? (document.body.innerText || '') : '';
  const champs = [...document.querySelectorAll('input,textarea,select')]
    .map((e) => (e.tagName === 'SELECT' ? (e.selectedOptions[0] || {}).text : e.value) || '').filter(Boolean);
  return t + (champs.length ? '\\n' + champs.join('\\n') : '');
};
window.__etat = () => ({
  url: location.href,
  taille: (document.body ? (document.body.innerText || '') : '').length,
  lisible: window.__lisible(),
  ouverts: document.querySelectorAll('[role="dialog"],[role="menu"],[aria-expanded="true"]').length,
});
window.__gestionnaire = (el) => {
  if (!el) return null;
  if (el.onclick || el.getAttribute('onclick')) return 'onclick';
  if (el.tagName === 'A' && el.getAttribute('href')) return 'href';
  if ((el.getAttribute('type') || '').toLowerCase() === 'submit' || (el.tagName === 'BUTTON' && !el.getAttribute('type') && el.closest('form'))) return 'submit';
  for (const k of Object.keys(el)) {
    if (!/^__reactProps\\$|^__reactEventHandlers\\$/.test(k)) continue;
    const p = el[k];
    if (p && (p.onClick || p.onMouseDown || p.onPointerDown || p.onChange)) return 'react';
  }
  return null;
};
window.__parentCliquable = (el) => {
  const p = el.parentElement && el.parentElement.closest(
    'button,a[href],[role="button"],[role="tab"],[role="menuitem"],input[type="submit"],summary');
  return p ? window.__libelleDe(p) || p.tagName.toLowerCase() : null;
};
`;

/* Ouvre un écran dans un contexte neuf. `couperSource` installe la coupure AVANT la
   navigation : sinon la première réponse passe et la preuve ne vaut rien. */
async function ouvrirEcran(a, ctx, { largeur = 1440, couperSource = false } = {}) {
  const nav = await ctx.navigateur();
  const contexteNav = await nav.newContext({
    locale: 'fr-CH', timezoneId: 'Europe/Zurich',
    viewport: { width: largeur, height: largeur < 700 ? 844 : 900 },
  });
  const page = await contexteNav.newPage();
  const reseau = [];
  const consoleJS = [];
  page.on('response', (r) => { if (r.status() >= 400) reseau.push({ s: r.status(), u: r.url() }); });
  page.on('pageerror', (e) => consoleJS.push(String(e.message || e).split('\n')[0]));

  if (couperSource) {
    await page.route('**/*', (r) => (EST_SOURCE(r.request().url()) ? r.abort() : r.continue()));
    try { await page.routeWebSocket('**/*', (ws) => ws.close()); } catch { /* version sans routeWebSocket */ }
  }
  await page.addInitScript(OUTILS_PAGE);

  const url = absolue(a.url, ctx.base);
  let reponse = null, erreur = null;
  try { reponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }); }
  catch (e) { erreur = String(e.message || e).split('\n')[0]; }
  if (!erreur) await page.waitForTimeout(ctx.attente);

  return { page, contexteNav, reponse, erreur, url, reseau, consoleJS,
    fermer: () => contexteNav.close().catch(() => {}) };
}

/* « On ne conclut jamais sans page. » Reprise de clics.mjs : un 404, un JSON brut ou une
   redirection hors du produit ne sont pas un écran, et « 0 constat » n'y veut rien dire. */
async function pasDeVraiEcran(e, ctx) {
  if (e.erreur) return `la page n'a pas chargé (${e.erreur})`;
  if (!e.reponse) return "aucune réponse du serveur";
  const statut = e.reponse.status();
  if (statut >= 400) return `le serveur répond ${statut}`;
  const ct = (e.reponse.headers()['content-type'] || '').toLowerCase();
  if (ct && !/text\/html|application\/xhtml/.test(ct)) return `réponse non-HTML (${ct.split(';')[0]})`;
  try {
    if (new URL(e.page.url()).host !== new URL(absolue(e.url, ctx.base)).host) return `redirigé hors du produit, vers ${new URL(e.page.url()).host}`;
  } catch { /* url exotique : on laisse passer */ }
  const t = await e.page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim()).catch(() => '');
  if (/^404\b|This page could not be found|Cette page est introuvable/i.test(t)) return `page 404 du framework`;
  return null;
}

/* Un nombre affiché tolère les séparateurs de milliers : 7885, 7'885, 7 885, 7,885. */
function regexNombre(n) {
  const d = String(Math.abs(Math.trunc(Number(n))));
  const sep = "[ '’,.\\u00a0\\u202f]?";
  let motif = d[0];
  for (let i = 1; i < d.length; i++) motif += ((d.length - i) % 3 === 0 ? sep : '') + d[i];
  return new RegExp(`(?<![\\d])${motif}(?![\\d])`);
}

async function verifierTextePresent(a, ctx) {
  if (String(a.texte).trim().length < 2) return { disposition: 'hors-sujet', raison: `« ${a.texte} » est trop court : on ne prouve rien avec un caractère` };
  const e = await ouvrirEcran(a, ctx);
  try {
    const pas = await pasDeVraiEcran(e, ctx);
    if (pas) return { disposition: 'invérifiable', raison: `écran indisponible : ${pas}` };
    const lisible = await e.page.evaluate(() => window.__lisible());
    const trouve = lisible.toLowerCase().includes(String(a.texte).toLowerCase());
    return trouve
      ? { disposition: 'confirmée', raison: `« ${a.texte} » est bien lisible à l'écran`, mesure: { taille: lisible.length } }
      : { disposition: 'infirmée', raison: `« ${a.texte} » n'est ni dans le texte ni dans un champ de l'écran (${lisible.length} caractères lus)`, mesure: { taille: lisible.length } };
  } finally { await e.fermer(); }
}

async function verifierTexteAbsent(a, ctx) {
  const r = await verifierTextePresent(a, ctx);
  if (r.disposition === 'confirmée') return { disposition: 'infirmée', raison: `« ${a.texte} » est bien là : ${r.raison}`, mesure: r.mesure };
  if (r.disposition === 'infirmée') return { disposition: 'confirmée', raison: `« ${a.texte} » est absent de l'écran`, mesure: r.mesure };
  return r;  // invérifiable et hors-sujet ne s'inversent pas
}

async function verifierPageInatteignable(a, ctx) {
  // D'abord la question qui commande : le serveur répond-il du tout ?
  const vie = await appelGet(ctx.base + '/', true);
  if (vie.erreur) return { disposition: 'invérifiable', raison: `l'application ne répond pas du tout sur ${ctx.base} (${vie.erreur}) : ce n'est pas cette page-là qui est morte` };

  const e = await ouvrirEcran(a, ctx);
  try {
    const pas = await pasDeVraiEcran(e, ctx);
    if (!pas) return { disposition: 'infirmée', raison: `l'écran de l'application s'affiche (${e.reponse.status()}, ${await e.page.evaluate(() => (document.body?.innerText || '').length)} caractères)`, mesure: { statut: e.reponse.status() } };
    if (/n'a pas chargé/.test(pas)) return { disposition: 'invérifiable', raison: pas };
    return { disposition: 'confirmée', raison: pas, mesure: { statut: e.reponse ? e.reponse.status() : null, arrivee: e.page.url() } };
  } finally { await e.fermer(); }
}

async function verifierValeurEnDur(a, ctx) {
  const texte = String(a.texte);
  const contient = (s) => s.toLowerCase().includes(texte.toLowerCase());

  const avec = await ouvrirEcran(a, ctx);
  let lisibleAvec;
  try {
    const pas = await pasDeVraiEcran(avec, ctx);
    if (pas) return { disposition: 'invérifiable', raison: `écran indisponible : ${pas}` };
    lisibleAvec = await avec.page.evaluate(() => window.__lisible());
  } finally { await avec.fermer(); }

  if (!contient(lisibleAvec)) {
    return { disposition: 'invérifiable', raison: `« ${texte} » ne s'affiche même pas source branchée : il n'y a rien à couper` };
  }

  const sans = await ouvrirEcran(a, ctx, { couperSource: true });
  try {
    if (sans.erreur) return { disposition: 'invérifiable', raison: `l'écran ne charge plus une fois la source coupée (${sans.erreur}) : on ne peut pas conclure` };
    const lisibleSans = await sans.page.evaluate(() => window.__lisible());
    return contient(lisibleSans)
      ? { disposition: 'confirmée', raison: `« ${texte} » survit à la coupure de la source : il est écrit en dur`, mesure: { avec: lisibleAvec.length, sans: lisibleSans.length } }
      : { disposition: 'infirmée', raison: `« ${texte} » disparaît quand la source est coupée : il vient bien de la source`, mesure: { avec: lisibleAvec.length, sans: lisibleSans.length } };
  } finally { await sans.fermer(); }
}

const PAGINATION = /\b\d+\s*[–—-]\s*\d+\s+(?:sur|of|de)\s+[\d'’.,   ]+|\bpage\s+\d+\s*(?:\/|sur|of)\s*\d+|\bsuivant\b.*\bpr[ée]c[ée]dent\b/i;

async function verifierCompteurFaux(a, ctx) {
  const e = await ouvrirEcran(a, ctx);
  try {
    const pas = await pasDeVraiEcran(e, ctx);
    if (pas) return { disposition: 'invérifiable', raison: `écran indisponible : ${pas}` };

    const lisible = await e.page.evaluate(() => window.__lisible());
    const compteReel = await e.page.evaluate((s) => {
      try { return document.querySelectorAll(s).length; } catch { return -1; }
    }, String(a.selecteur));
    if (compteReel < 0) return { disposition: 'hors-sujet', raison: `sélecteur CSS invalide : ${a.selecteur}` };

    const affiche = Number(a.affiche), compte = Number(a.compte);
    if (!regexNombre(affiche).test(lisible)) {
      const vus = (lisible.match(/(?<![\d])\d[\d'’.,   ]{0,12}\d(?![\d])/g) || []).slice(0, 6).join(', ');
      return { disposition: 'infirmée', raison: `le nombre ${affiche} n'est pas affiché sur cet écran${vus ? ` (on y lit plutôt : ${vus})` : ''}`, mesure: { compteReel } };
    }
    // Un écran paginé n'a AUCUNE raison de montrer autant de lignes que son total.
    // C'est le faux positif classique : le vérificateur refuse la question plutôt que d'y répondre.
    if (PAGINATION.test(lisible) && compteReel !== affiche) {
      const m = lisible.match(PAGINATION);
      return { disposition: 'hors-sujet', raison: `écran paginé (« ${String(m[0]).trim().slice(0, 40)} ») : un total et ${compteReel} lignes visibles n'ont pas à coïncider`, mesure: { compteReel, affiche } };
    }
    if (compteReel !== compte) {
      return { disposition: 'infirmée', raison: `l'agent a compté ${compte}, le sélecteur « ${a.selecteur} » en donne ${compteReel}`, mesure: { compteReel, compte } };
    }
    return affiche !== compte
      ? { disposition: 'confirmée', raison: `${affiche} affiché, ${compteReel} recomptés avec « ${a.selecteur} » : les deux nombres diffèrent bien`, mesure: { affiche, compteReel } }
      : { disposition: 'infirmée', raison: `affiché et compté valent tous les deux ${affiche} : le compteur est juste`, mesure: { affiche, compteReel } };
  } finally { await e.fermer(); }
}

async function verifierElementHorsEcran(a, ctx) {
  const largeur = Number(a.largeur) || 390;
  const e = await ouvrirEcran(a, ctx, { largeur });
  try {
    const pas = await pasDeVraiEcran(e, ctx);
    if (pas) return { disposition: 'invérifiable', raison: `écran indisponible : ${pas}` };

    const m = await e.page.evaluate((s) => {
      let el;
      try { el = document.querySelector(s); } catch { return { invalide: true }; }
      if (!el) return { absent: true };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'
        && Number(cs.opacity) > 0.01 && (!!el.offsetParent || cs.position === 'fixed');
      let conteneur = null;
      for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
        const c = getComputedStyle(p);
        if (/hidden|clip|auto|scroll/.test(c.overflowX)) {
          const pr = p.getBoundingClientRect();
          conteneur = { balise: p.tagName.toLowerCase(), overflow: c.overflowX, droite: Math.round(pr.right) };
          break;
        }
      }
      return {
        droite: Math.round(r.right), largeurEl: Math.round(r.width), visible, conteneur,
        fenetre: document.documentElement.clientWidth,
        defile: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      };
    }, String(a.selecteur));

    if (m.invalide) return { disposition: 'hors-sujet', raison: `sélecteur CSS invalide : ${a.selecteur}` };
    if (m.absent) return { disposition: 'invérifiable', raison: `« ${a.selecteur} » ne trouve aucun élément à ${largeur} px : on ne peut rien mesurer` };
    if (!m.visible) return { disposition: 'infirmée', raison: `l'élément n'est pas visible à ${largeur} px : ce que le client ne voit pas ne déborde pas`, mesure: m };
    if (m.droite <= m.fenetre + 2) return { disposition: 'infirmée', raison: `l'élément tient dans la fenêtre (bord droit ${m.droite} px pour ${m.fenetre} px)`, mesure: m };
    /* Le faux positif le plus fréquent : un tableau large DANS un conteneur qui défile ou
       qui rogne. L'élément déborde, mais son conteneur tient dans la fenêtre : ce n'est pas
       lui qui pousse la page. Mesurer le seul bord droit de l'élément dit l'inverse. */
    if (m.conteneur && m.conteneur.droite <= m.fenetre + 2) {
      return { disposition: 'infirmée', raison: `le bord droit est à ${m.droite} px, mais le débordement est contenu par un ${m.conteneur.balise} en overflow-x ${m.conteneur.overflow} qui tient dans la fenêtre : ce n'est pas cet élément qui pousse la page`, mesure: m };
    }
    if (!m.defile) {
      return { disposition: 'infirmée', raison: `le bord droit est à ${m.droite} px mais la page ne défile pas de côté`, mesure: m };
    }
    return { disposition: 'confirmée', raison: `bord droit à ${m.droite} px pour une fenêtre de ${m.fenetre} px, et la page défile de côté`, mesure: m };
  } finally { await e.fermer(); }
}

/* ── Les deux types qui cliquent ─────────────────────────────────────────────── */

async function trouverBouton(page, libelle) {
  const cible = String(libelle).trim().replace(/\s+/g, ' ');
  const idx = await page.evaluate((l) => {
    const liste = window.__cliquables();
    const exact = liste.findIndex((el) => window.__libelleDe(el) === l);
    if (exact >= 0) return exact;
    return liste.findIndex((el) => window.__libelleDe(el).includes(l));
  }, cible);
  if (idx < 0) return null;
  const handle = await page.evaluateHandle((i) => window.__cliquables()[i], idx);
  const meta = await page.evaluate((i) => {
    const el = window.__cliquables()[i];
    return { libelle: window.__libelleDe(el), gestionnaire: window.__gestionnaire(el), parent: window.__parentCliquable(el) };
  }, idx);
  return { element: handle.asElement(), idx, ...meta };
}

async function verifierBoutonSansEffet(a, ctx) {
  const libelle = String(a.libelle);
  if (DESTRUCTEUR.test(libelle)) {
    return { disposition: 'invérifiable', raison: `« ${libelle} » détruit ou déconnecte : ce bouton n'est jamais cliqué par un vérificateur, quelle que soit l'option` };
  }
  if (ECRITURE.test(libelle) && !ctx.ecriturePermise) {
    return { disposition: 'invérifiable', raison: `« ${libelle} » écrit chez le client : relancer avec --ecriture-permise sur une base de test` };
  }

  const e = await ouvrirEcran(a, ctx);
  try {
    const pas = await pasDeVraiEcran(e, ctx);
    if (pas) return { disposition: 'invérifiable', raison: `écran indisponible : ${pas}` };

    const b = await trouverBouton(e.page, libelle);
    if (!b) return { disposition: 'invérifiable', raison: `aucun cliquable « ${libelle} » sur cet écran : introuvable, donc rien à conclure` };

    // Un cliquable DANS un cliquable : c'est le parent qui reçoit le clic. Six « morts »
    // sur huit venaient de là le 12/09/2026.
    if (b.parent) {
      return { disposition: 'infirmée', raison: `« ${b.libelle} » est inclus dans « ${b.parent} » : c'est le parent qui reçoit le clic, le client n'est pas bloqué`, mesure: { parent: b.parent } };
    }

    const bouge = await clicEtMesure(e, b.element, ctx.attente);
    if (bouge.change) {
      return { disposition: 'infirmée', raison: `le clic a bien un effet : ${bouge.quoi}`, mesure: bouge };
    }

    /* CONTRE-ÉPREUVE. Un bouton paraît inerte quand l'écran est DÉJÀ dans l'état qu'il
       produit : « Aujourd'hui » quand on est déjà aujourd'hui. On sort l'écran de cet
       état en cliquant autre chose, puis on re-clique. Leçon payée quatre fois. */
    await e.page.goto(absolue(a.url, ctx.base), { waitUntil: 'domcontentloaded', timeout: 25000 });
    await e.page.waitForTimeout(ctx.attente);
    /* Qui cliquer pour bouger l'écran, et qui ne jamais cliquer.
       · les VOISINS du bouton d'abord : les flèches « période précédente / suivante »
         sont juste à côté de « Aujourd'hui », et ce sont elles qui changent l'état.
       · les boutons SANS libellé comptent : une flèche n'a qu'une icône, et les
         exclure faisait rater la seule commande capable de sortir de l'état visé.
       · jamais un bouton qui écrit ou qui détruit : la contre-épreuve tapait sur
         « Nouveau RDV » du calendrier d'un client. On ne répare pas un faux positif
         en créant un rendez-vous chez lui. */
    const bouges = await e.page.evaluate(({ l, dest, ecr }) => {
      const reD = new RegExp(dest, 'i'), reE = new RegExp(ecr, 'i');
      const liste = window.__cliquables();
      const cible = liste.find((el) => window.__libelleDe(el) === l) || liste.find((el) => window.__libelleDe(el).includes(l));
      const parent = cible ? cible.parentElement : null;
      const grand = parent ? parent.parentElement : null;
      return liste
        .map((el, i) => ({ i, el, lib: window.__libelleDe(el) }))
        .filter((x) => x.el !== cible && x.el.tagName !== 'A' && !x.el.closest('a[href]'))
        .filter((x) => !x.lib || (!reD.test(x.lib) && !reE.test(x.lib)))
        .map((x) => ({ i: x.i, rang: parent && x.el.parentElement === parent ? 0 : (grand && grand.contains(x.el) ? 1 : 2) }))
        .sort((a, b2) => a.rang - b2.rang)
        .slice(0, 6)
        .map((x) => x.i);
    }, { l: String(b.libelle), dest: DESTRUCTEUR.source, ecr: ECRITURE.source });
    /* Un seul clic suffit, et il faut qu'il PORTE. La première version cliquait les six
       d'affilée : sur le calendrier elle appuyait « période précédente » puis « période
       suivante » et revenait au point de départ, si bien que « Aujourd'hui » n'avait
       toujours rien à faire. On clique donc un par un et on s'arrête dès que l'écran a
       vraiment changé d'état. */
    let deplace = null;
    for (const i of bouges) {
      const avant = await e.page.evaluate(() => window.__etat());
      const h = await e.page.evaluateHandle((k) => window.__cliquables()[k], i);
      const el = h.asElement();
      if (!el) continue;
      try { await el.click({ timeout: 1200 }); } catch { continue; }
      await dormir(700);
      const apres = await e.page.evaluate(() => window.__etat()).catch(() => avant);
      if (apres.url !== avant.url) {   // un clic qui navigue nous sort de l'écran : on revient
        await e.page.goto(absolue(a.url, ctx.base), { waitUntil: 'domcontentloaded', timeout: 25000 });
        await e.page.waitForTimeout(ctx.attente);
        continue;
      }
      if (apres.taille !== avant.taille || apres.ouverts !== avant.ouverts) { deplace = { de: avant.taille, a: apres.taille }; break; }
    }
    if (!deplace) {
      return { disposition: 'invérifiable', raison: `rien n'a bougé au clic, et la contre-épreuve n'a pas pu mettre l'écran dans un autre état : on ne conclut pas à la mort sans elle`, mesure: { gestionnaire: b.gestionnaire } };
    }
    await dormir(400);
    const b2 = await trouverBouton(e.page, libelle);
    if (!b2) return { disposition: 'invérifiable', raison: `« ${libelle} » a disparu pendant la contre-épreuve : on ne conclut pas à la mort sans l'avoir re-cliqué` };
    const bouge2 = await clicEtMesure(e, b2.element, ctx.attente);
    if (bouge2.change) {
      return { disposition: 'infirmée', raison: `paraissait inerte, mais réagit une fois l'écran dans un autre état : ${bouge2.quoi}`, mesure: bouge2 };
    }
    if (b.gestionnaire) {
      return { disposition: 'invérifiable', raison: `rien n'a bougé aux deux essais, mais un gestionnaire « ${b.gestionnaire} » est bien attaché : l'effet existe et n'est pas observable à l'écran, il faut un humain`, mesure: { gestionnaire: b.gestionnaire } };
    }
    return { disposition: 'confirmée', raison: `aucun gestionnaire attaché, et rien ne bouge ni au premier clic ni après contre-épreuve`, mesure: { essais: 2 } };
  } finally { await e.fermer(); }
}

/* Un clic, et la comparaison avant/après : URL, taille du texte, panneaux ouverts,
   requêtes en échec, erreurs JavaScript. */
/* `attente` n'est pas un détail : c'est la fenêtre pendant laquelle on accepte de voir
   l'effet du clic. Elle valait 1000 ms en dur, et un serveur de développement met de
   0,07 s à 42 s à rendre une page (mesuré le 12/09/2026, médiane 4,3 s). Avec 1 s, un
   lien parfaitement vivant ne montre rien, part en contre-épreuve, et revient
   « invérifiable » : c'est la mécanique exacte qui a produit 256 faux boutons morts,
   reproduite à l'intérieur du vérificateur censé les démentir. Elle suit désormais
   --attente, et attend au moins une seconde. */
async function clicEtMesure(e, element, attente = 1000) {
  const avant = await e.page.evaluate(() => window.__etat());
  const nR = e.reseau.length, nC = e.consoleJS.length;
  try { await element.click({ timeout: 2500 }); }
  catch (err) { return { change: false, quoi: null, echecClic: String(err.message || err).split('\n')[0] }; }
  await dormir(Math.max(1000, Number(attente) || 0));
  const apres = await e.page.evaluate(() => window.__etat()).catch(() => avant);

  if (apres.url !== avant.url) return { change: true, quoi: `l'écran a navigué vers ${apres.url}` };
  if (apres.taille !== avant.taille) return { change: true, quoi: `le texte de l'écran passe de ${avant.taille} à ${apres.taille} caractères` };
  if (apres.ouverts !== avant.ouverts) return { change: true, quoi: `${Math.abs(apres.ouverts - avant.ouverts)} panneau(x) ouvert(s) ou fermé(s)` };
  if (e.reseau.length > nR) return { change: true, quoi: `une requête part et répond ${e.reseau[nR].s}` };
  if (e.consoleJS.length > nC) return { change: true, quoi: `le clic déclenche une erreur JavaScript : ${e.consoleJS[nC].slice(0, 80)}` };
  return { change: false, quoi: null };
}

async function verifierBoutonNePersistePas(a, ctx) {
  if (!ctx.ecriturePermise) {
    return { disposition: 'invérifiable', raison: `vérifier la persistance oblige à écrire chez le client : relancer avec --ecriture-permise sur une base de test` };
  }
  if (DESTRUCTEUR.test(String(a.libelle))) {
    return { disposition: 'invérifiable', raison: `« ${a.libelle} » détruit ou déconnecte : jamais cliqué` };
  }
  const e = await ouvrirEcran(a, ctx);
  try {
    const pas = await pasDeVraiEcran(e, ctx);
    if (pas) return { disposition: 'invérifiable', raison: `écran indisponible : ${pas}` };

    const champ = e.page.locator(String(a.champ)).first();
    if (!(await champ.count())) return { disposition: 'invérifiable', raison: `le champ « ${a.champ} » est introuvable sur cet écran` };
    const avant = await champ.inputValue().catch(() => null);
    if (avant === null) return { disposition: 'invérifiable', raison: `« ${a.champ} » n'est pas un champ de saisie` };

    const test = String(a.valeur_test ?? `verif-${Date.now().toString(36)}`);
    await champ.fill(test);

    const b = await trouverBouton(e.page, String(a.libelle));
    if (!b) return { disposition: 'invérifiable', raison: `aucun cliquable « ${a.libelle} » sur cet écran` };
    try { await b.element.click({ timeout: 2500 }); }
    catch (err) { return { disposition: 'invérifiable', raison: `le bouton n'a pas pu être cliqué : ${String(err.message || err).split('\n')[0]}` }; }
    await dormir(1500);

    await e.page.goto(absolue(a.url, ctx.base), { waitUntil: 'domcontentloaded', timeout: 25000 });
    await e.page.waitForTimeout(ctx.attente);
    const apres = await e.page.locator(String(a.champ)).first().inputValue().catch(() => null);
    if (apres === null) return { disposition: 'invérifiable', raison: `le champ a disparu après rechargement : on ne peut pas comparer` };

    return apres === test
      ? { disposition: 'infirmée', raison: `la valeur « ${test} » est toujours là après rechargement : le bouton enregistre bien`, mesure: { avant, test, apres } }
      : { disposition: 'confirmée', raison: `le champ est revenu à « ${apres} » après rechargement, la valeur « ${test} » n'a pas été gardée`, mesure: { avant, test, apres } };
  } finally { await e.fermer(); }
}

/* ── Le tableau de répartition ─────────────────────────────────────────────── */

const VERIFICATEURS = {
  fichier_contient: verifierFichierContient,
  fichier_ne_contient_pas: verifierFichierNeContientPas,
  symbole_appele: verifierSymboleAppele,
  route_existe: verifierRouteExiste,
  requete_en_echec: verifierRequeteEnEchec,
  lien_mort: verifierLienMort,
  texte_present: verifierTextePresent,
  texte_absent: verifierTexteAbsent,
  page_inatteignable: verifierPageInatteignable,
  valeur_en_dur: verifierValeurEnDur,
  compteur_faux: verifierCompteurFaux,
  element_hors_ecran: verifierElementHorsEcran,
  bouton_sans_effet: verifierBoutonSansEffet,
  bouton_ne_persiste_pas: verifierBoutonNePersistePas,
};

/* Un type du catalogue sans vérificateur serait une promesse en l'air : on le dit tout de suite. */
for (const t of Object.keys(TYPES)) {
  if (!VERIFICATEURS[t]) throw new Error(`type ${t} au catalogue sans vérificateur : le catalogue ment`);
}

/* ── En ligne de commande ─────────────────────────────────────────────────── */

const SIGNES = { 'confirmée': '✓', 'infirmée': '✗', 'invérifiable': '?', 'hors-sujet': '·' };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const AVEC_VALEUR = new Set(['--repo', '--base', '--json', '--attente']);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  let fichier = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) { if (AVEC_VALEUR.has(args[i])) i++; continue; }
    fichier = args[i]; break;
  }

  if (!fichier) {
    console.error('usage: node verifier-affirmation.mjs <lot.json> [--repo <dépôt>] [--base http://localhost:3000] [--json <sortie>] [--ecriture-permise]');
    process.exit(2);
  }
  let lot;
  try { lot = lireLot(fs.readFileSync(fichier, 'utf-8')); }
  catch (e) { console.error(`  ✗ ${e.message}`); process.exit(2); }

  const ctx = contexte({
    repo: opt('--repo', '.'),
    base: opt('--base', 'http://localhost:3000'),
    ecriturePermise: args.includes('--ecriture-permise'),
    attente: opt('--attente', 2500),
  });

  const T0 = Date.now();
  let resultats;
  try { resultats = await verifierLot(lot.affirmations, ctx); }
  finally { await ctx.fermer(); }

  const t = taux(resultats);
  console.log(`\n  VÉRIFICATION DU LOT${lot.agent ? ` DE ${String(lot.agent).toUpperCase()}` : ''}  ·  ${t.total} affirmation${t.total > 1 ? 's' : ''}  ·  ${Math.round((Date.now() - T0) / 1000)} s`);
  console.log(`  dépôt ${ctx.repo}  ·  application ${ctx.base}${ctx.ecriturePermise ? '  ·  écriture permise' : ''}\n`);

  const large = Math.max(...resultats.map((r) => (r.id || '').length), 4);
  for (const r of resultats) {
    console.log(`  ${SIGNES[r.disposition]} ${String(r.id || '—').padEnd(large)}  ${r.disposition.padEnd(12)} ${r.type || '?'}`);
    console.log(`      ${r.raison}`);
  }

  console.log(`\n  ${t.confirmees} confirmée${t.confirmees > 1 ? 's' : ''} · ${t.infirmees} infirmée${t.infirmees > 1 ? 's' : ''} · ${t.inverifiables} invérifiable${t.inverifiables > 1 ? 's' : ''} · ${t.horsSujet} hors-sujet`);
  console.log(`  taux de confirmation ${pourcent(t.tauxConfirmation)} sur ${t.tranchees} tranchée${t.tranchees > 1 ? 's' : ''} · lot jugeable à ${pourcent(t.tauxJugeable)}`);
  console.log(`\n  ${t.verdict}`);
  for (const m of t.motifs) console.log(`    ${m}`);
  if (t.verdict === 'REJETÉ') console.log(`    Le lot repart chez l'agent : il refait, il ne discute pas.`);
  console.log('');

  const sortie = opt('--json', null);
  if (sortie) {
    fs.mkdirSync(path.dirname(path.resolve(sortie)), { recursive: true });
    fs.writeFileSync(sortie, JSON.stringify({ agent: lot.agent, depot: ctx.repo, base: ctx.base, taux: t, resultats }, null, 2));
    console.log(`  → ${sortie}\n`);
  }
  process.exit(t.verdict === 'ACCEPTÉ' ? 0 : 1);
}
