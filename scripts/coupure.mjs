#!/usr/bin/env node
/**
 * coupure.mjs — La preuve par coupure. La manœuvre la plus rentable du skill.
 *
 * L'IDÉE, EN UNE PHRASE : on charge chaque écran deux fois, une fois normalement et une
 * fois en coupant la source de données, et tout ce qui s'affiche encore est écrit en dur.
 *
 * Pourquoi c'est mieux que la preuve par témoin. Le témoin demande d'écrire des valeurs
 * reconnaissables en base par la voie normale du produit, donc un compte de test, un
 * accès en écriture, et une manœuvre à refaire à chaque session. La coupure ne demande
 * rien : aucune écriture, aucun marqueur, aucun compte. Elle marche sur n'importe quelle
 * stack, y compris un produit dont on n'a pas les identifiants d'administration, et elle
 * répond à la question dans le bon sens : au lieu de prouver qu'une valeur vient de la
 * source, elle prouve qu'une valeur n'en vient pas.
 *
 * Les deux restent complémentaires : la coupure trouve le champ inventé, le témoin
 * trouve le champ branché sur la MAUVAISE source (il bouge à la coupure, mais il affiche
 * la donnée de quelqu'un d'autre).
 *
 *   node coupure.mjs <url-de-base> [--routes=/a,/b] [--repo=<chemin>] [--json]
 *
 * Exemple : node coupure.mjs http://localhost:3000 --repo=<projet-client-A>
 *
 * Résultat obtenu sur le projet client A le 11/09/2026 : 19 valeurs survivent à la coupure,
 * dont l'email du profil sur 13 écrans sur 13, écrit en dur dans le composant de coquille.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const ARGS = process.argv.slice(2);
const BASE = (ARGS.find((a) => /^https?:\/\//.test(a)) || 'http://localhost:3000').replace(/\/+$/, '');
const flag = (n, d) => { const f = ARGS.find((a) => a.startsWith(`--${n}=`)); return f ? f.split('=').slice(1).join('=') : d; };
const REPO = path.resolve(flag('repo', '.'));
const AS_JSON = ARGS.includes('--json');
const ATTENTE = Number(flag('attente', 2500));

/* ── Playwright : dans le projet, global, ou installé à la volée ─────────── */

let chromium;
for (const essai of [
  () => createRequire(path.join(REPO, 'package.json'))('playwright').chromium,
  () => createRequire(import.meta.url)('playwright').chromium,
]) {
  try { chromium = essai(); break; } catch { /* on tente le suivant */ }
}
if (!chromium) {
  console.error(`Playwright introuvable. Installer une fois : npm i -D playwright && npx playwright install chromium`);
  process.exit(2);
}

/* ── Les routes à parcourir ─────────────────────────────────────────────── */

function routesDuRepo() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (['node_modules', '.next', '.git'].includes(e.name)) continue;
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/^page\.(tsx?|jsx?)$/.test(e.name)) continue;
      let url = rel.replace(/\\/g, '/').replace(/^(src\/)?app/, '').replace(/\/page\.\w+$/, '').replace(/\/\([^)]+\)/g, '');
      if (!url.startsWith('/')) url = '/' + url;
      if (/\[/.test(url)) continue;                 // segment dynamique : demande un vrai identifiant
      out.push(url || '/');
    }
  };
  walk('src/app'); walk('app');
  return [...new Set(out)].sort();
}

const ROUTES = (flag('routes', '') ? flag('routes', '').split(',') : routesDuRepo()).filter(Boolean);
if (!ROUTES.length) {
  console.error(`Aucune route trouvée sous ${REPO}. Préciser --routes=/a,/b.`);
  process.exit(2);
}

/* ── Ce qui compte comme « une donnée affichée » ─────────────────────────── */

const SONDES = [
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, 'email'],
  [/\+?\d[\d\s().-]{8,}\d/g, 'téléphone'],
  [/\b\d{1,3}(?:[ '.,]\d{3})+(?:[.,]\d+)?\b/g, 'nombre formaté'],
  [/\b\d{1,3}(?:[.,]\d+)?\s*(?:%|€|\$|CHF|EUR|USD)\b/gi, 'montant ou taux'],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, 'date'],
  [/\b[A-ZÀ-Ÿ][a-zà-ÿ]{2,}\s+[A-ZÀ-Ÿ][a-zà-ÿ'-]{2,}\b/gu, 'nom propre'],
];

// Mots d'interface qui ont la forme d'un nom propre sans en être un.
const LIBELLE = /^(Nouveau|Nouvelle|Mon|Ma|Mes|Tous|Toutes|Aucun|Aucune|Voir|Ajouter|Modifier|Supprimer|Enregistrer|Annuler|Retour|Suivant|Précédent|Se |Bonjour|Bienvenue|Chargement|Erreur|Page|Tableau|Vue |Centre |Base )/i;

// Ligne par ligne, jamais sur le texte entier : sinon deux libellés de menu adjacents
// (« Contacts » puis « Biens ») se collent et passent pour un nom de personne.
function valeurs(texte) {
  const trouve = new Map();
  for (const ligne of String(texte).split('\n')) {
    const l = ligne.trim();
    if (!l || l.length > 120) continue;
    for (const [re, type] of SONDES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(l))) {
        const v = m[0].trim();
        if (v.length < 3 || /\n/.test(v)) continue;
        if (type === 'nom propre' && LIBELLE.test(v)) continue;
        // Un « nom propre » qui est en fait deux mots de menu : il occupe toute la ligne
        // et se répète à l'identique sur chaque écran, ce que le rapport dira de lui-même.
        if (!trouve.has(v)) trouve.set(v, type);
      }
    }
  }
  return trouve;
}

/* ── Le parcours ─────────────────────────────────────────────────────────── */

// Tout ce par quoi une donnée peut arriver. Coupé, l'écran ne doit plus rien savoir.
const estSource = (url) =>
  /\.convex\.(cloud|site)/.test(url) || /\/api\//.test(url) || /supabase|firebase|amazonaws|graphql/.test(url);

const resultats = [];

const navigateur = await chromium.launch();
try {
  for (const route of ROUTES) {
    const lignes = { route, avec: null, sans: null, erreur: null };

    for (const mode of ['avec', 'sans']) {
      const ctx = await navigateur.newContext({ locale: 'fr-CH', timezoneId: 'Europe/Zurich' });
      const page = await ctx.newPage();

      if (mode === 'sans') {
        // La source est injoignable : ni WebSocket, ni requête de données.
        await page.route('**/*', (r) => (estSource(r.request().url()) ? r.abort() : r.continue()));
        try { await page.routeWebSocket('**/*', (ws) => ws.close()); } catch { /* version sans routeWebSocket */ }
      }

      try {
        await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(ATTENTE);
        const texte = await page.evaluate(() => document.body?.innerText || '');
        lignes[mode] = valeurs(texte);
      } catch (e) {
        lignes.erreur = e.message.split('\n')[0];
      }
      await ctx.close();
    }

    if (lignes.avec && lignes.sans) {
      const enDur = [...lignes.sans.entries()].map(([v, t]) => ({ valeur: v, type: t }));
      const deLaSource = [...lignes.avec.keys()].filter((v) => !lignes.sans.has(v));
      resultats.push({ route: lignes.route, enDur, deLaSource: deLaSource.length, total: lignes.avec.size });
    } else {
      resultats.push({ route: lignes.route, erreur: lignes.erreur || 'page non chargée', enDur: [], deLaSource: 0, total: 0 });
    }
  }
} finally {
  await navigateur.close();
}

/* ── Rapport ─────────────────────────────────────────────────────────────── */

// Une valeur en dur partout est dans la coquille (barre latérale, en-tête) : une seule cause.
const parValeur = new Map();
for (const r of resultats) for (const e of r.enDur) {
  if (!parValeur.has(e.valeur)) parValeur.set(e.valeur, { type: e.type, routes: [] });
  parValeur.get(e.valeur).routes.push(r.route);
}

const totalEnDur = parValeur.size;
if (AS_JSON) {
  process.stdout.write(JSON.stringify({ base: BASE, resultats, enDur: [...parValeur.entries()].map(([v, d]) => ({ valeur: v, ...d })) }, null, 2) + '\n');
} else {
  console.log(`\n╔══ PREUVE PAR COUPURE ─ ${BASE}`);
  console.log(`║  ${ROUTES.length} écrans chargés deux fois : source vivante, puis source coupée`);
  console.log(`╚══ ${totalEnDur} valeur(s) survivent à la coupure : elles sont écrites en dur\n`);

  if (totalEnDur) {
    console.log('AFFICHÉ SANS VENIR DE LA SOURCE :\n');
    for (const [v, d] of [...parValeur.entries()].sort((a, b) => b[1].routes.length - a[1].routes.length)) {
      const partout = d.routes.length === ROUTES.length;
      console.log(`  « ${v.slice(0, 50)} »  (${d.type})`);
      console.log(`      sur ${d.routes.length}/${ROUTES.length} écrans${partout ? ' — donc dans la coquille commune' : ' : ' + d.routes.slice(0, 4).join(', ')}`);
    }
    console.log(`\n  Une valeur présente sur TOUS les écrans vient de la coquille (barre latérale,`);
    console.log(`  en-tête) : c'est une seule ligne à corriger, pas ${totalEnDur}.\n`);
  }

  console.log('PAR ÉCRAN :\n');
  for (const r of resultats) {
    if (r.erreur) { console.log(`  ${r.route.padEnd(34)} ⚠️  ${r.erreur.slice(0, 50)}`); continue; }
    const etat = r.enDur.length ? '✗' : r.deLaSource ? '✓' : '·';
    console.log(`  ${etat} ${r.route.padEnd(32)} ${String(r.deLaSource).padStart(4)} valeurs de la source · ${r.enDur.length} en dur`);
  }
  console.log(`\n  « · » : l'écran n'affiche aucune donnée reconnaissable. Soit il n'en affiche pas,`);
  console.log(`  soit il ne lit rien du tout — le distinguer demande de regarder l'écran.\n`);
}

process.exitCode = totalEnDur ? 1 : 0;
