#!/usr/bin/env node
/**
 * reconnaitre.mjs : le skill comprend le projet tout seul, avant de l'auditer.
 *
 *     node reconnaitre.mjs <repo> [--json f] [--url http://localhost:3000]
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le skill a été construit sur un projet, et il s'est mis à supposer la forme de ce
 * projet : les pages dans `app/`, le schéma dans `convex/schema.ts`, le serveur sur le
 * port 3000. Sur le SaaS suivant, les pages étaient dans `src/app/` et l'orchestrateur
 * annonçait « 0 page trouvée » sans le dire. Alors le skill commence par REGARDER, et il
 * dit ce qu'il a compris. Si sa lecture est fausse, ça se voit avant l'audit.
 *
 * L'APPLICATION VIVANTE : UNE LEÇON PAYÉE. Une première version déclarait « vivante »
 * n'importe quelle application qui écoutait sur un port habituel. Sur une machine où un
 * autre projet tournait sur :3000, une instance a failli auditer l'écran d'un autre
 * client. Désormais une application n'est « confirmée » que si ce qu'elle sert porte la
 * marque de CE projet (son titre déclaré, ou du texte de sa page d'accueil), et une
 * redirection vers un fournisseur d'authentification, un écran de connexion ou une
 * réponse qui n'est pas du HTML sont nommés comme tels, avec la marche à suivre.
 *
 * CE QU'IL ÉCRIT : `<repo>/.backend/reconnaissance.json`, toujours (le bilan le lit).
 * CODES DE SORTIE : 0 tout compris · 1 des inconnues restent (l'audit sera partiel).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ecrireJson } from './dossier-backend.mjs';

const RACINE = path.resolve(process.argv[2] || '.');
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const existe = (p) => fs.existsSync(path.join(RACINE, p));
const lire = (p) => { try { return fs.readFileSync(path.join(RACINE, p), 'utf8'); } catch { return ''; } };

if (!fs.existsSync(RACINE)) { console.error(`Dépôt introuvable : ${RACINE}`); process.exit(2); }

const C = {};   // la carte du projet

/* ── La stack ──────────────────────────────────────────────────────────────── */

let pkg = {};
try { pkg = JSON.parse(lire('package.json') || '{}'); } catch { /* pas de package.json */ }
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

C.nom = pkg.name || path.basename(RACINE);
C.cadre = deps.next ? 'Next.js' : deps.nuxt ? 'Nuxt' : deps['@sveltejs/kit'] ? 'SvelteKit'
  : deps.express ? 'Express' : deps.astro ? 'Astro' : 'inconnu';
C.base = deps.convex ? 'Convex' : deps['@prisma/client'] ? 'Prisma'
  : deps['drizzle-orm'] ? 'Drizzle' : deps['@supabase/supabase-js'] ? 'Supabase' : 'inconnue';
C.auth = deps['@clerk/nextjs'] ? 'Clerk' : deps['next-auth'] ? 'NextAuth'
  : deps['@convex-dev/auth'] ? 'Convex Auth' : deps['@supabase/auth-helpers-nextjs'] ? 'Supabase Auth' : null;

/* ── Sur quelle base on tape : dev ou prod ─────────────────────────────────── */

const env = ['.env.local', '.env'].map(lire).join('\n');
const convexDep = (env.match(/^CONVEX_DEPLOYMENT=([^\n]+)/m) || [])[1] || '';
C.deploiement = /^prod:/.test(convexDep) ? 'production'
  : /^dev:/.test(convexDep) ? 'développement'
    : /^DATABASE_URL=/m.test(env) ? 'inconnu (DATABASE_URL présent)' : 'inconnu';

/* ── Où sont les pages ─────────────────────────────────────────────────────── */

const CANDIDATS_PAGES = ['app', 'src/app', 'pages', 'src/pages', 'src/routes'];
C.racinePages = CANDIDATS_PAGES.find((d) => {
  if (!existe(d)) return false;
  const trouve = (x, prof = 0) => {
    if (prof > 6) return false;
    for (const e of fs.readdirSync(path.join(RACINE, x), { withFileTypes: true })) {
      if (/node_modules|\.next/.test(e.name)) continue;
      if (e.isDirectory() && trouve(path.join(x, e.name), prof + 1)) return true;
      if (/^(page|index|\+page)\.(tsx|jsx|ts|js|svelte|vue)$/.test(e.name)) return true;
    }
    return false;
  };
  return trouve(d);
}) || null;

/* ── Les pages, et donc les modules ────────────────────────────────────────── */

C.pages = [];
C.layouts = [];
if (C.racinePages) {
  const marcher = (d, url = '') => {
    for (const e of fs.readdirSync(path.join(RACINE, d), { withFileTypes: true })) {
      if (/node_modules|\.next|_generated/.test(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) marcher(p, `${url}/${e.name}`);
      else if (/^(page|\+page)\.(tsx|jsx|ts|js|svelte|vue)$/.test(e.name)) {
        // Les groupes de routes, (app) ou (auth), n'apparaissent pas dans l'URL.
        C.pages.push({ route: url.replace(/\/\([^)]+\)/g, '') || '/', dynamique: /\[/.test(url), fichier: p });
      } else if (/^layout\.(tsx|jsx|ts|js)$/.test(e.name)) C.layouts.push(p);
    }
  };
  marcher(C.racinePages);
}
/* Un dossier `modules/` (ou `ecrans/`) porte le découpage métier ; sinon le premier segment. */
const segMod = ['modules', 'ecrans', 'screens'].find((s) => C.pages.some((p) => p.route.split('/')[1] === s));
C.modules = [...new Set(C.pages.map((p) => {
  const seg = p.route.split('/').filter(Boolean);
  if (segMod && seg[0] === segMod) return seg[1] || segMod;
  return seg[0] || '/';
}).filter(Boolean))];

/* ── Le schéma et les tables ───────────────────────────────────────────────── */

C.schema = ['convex/schema.ts', 'src/convex/schema.ts', 'prisma/schema.prisma',
  'src/db/schema.ts', 'db/schema.ts', 'drizzle/schema.ts'].find(existe) || null;
C.tables = [];
if (C.schema) {
  const s = lire(C.schema);
  const noms = new Set();
  for (const m of s.matchAll(/^\s{2,}(\w+)\s*:\s*defineTable/gm)) noms.add(m[1]);
  for (const m of s.matchAll(/^\s*model\s+(\w+)/gm)) noms.add(m[1]);
  for (const m of s.matchAll(/(\w+)\s*=\s*pgTable\s*\(\s*["'](\w+)["']/g)) noms.add(m[2]);
  C.tables = [...noms];
}

/* ── Comment on lance, et sur quel port ────────────────────────────────────── */

const dev = (pkg.scripts || {}).dev || '';
C.commandeDev = dev ? 'npm run dev' : null;
const portDeclare = (dev.match(/-p\s*(\d+)|--port[= ](\d+)/) || []).slice(1).find(Boolean);
C.port = Number(portDeclare || (C.cadre === 'SvelteKit' ? 5173 : 3000));

/* ── Les marques du projet : ce qu'on attend de voir dans la page servie ────── */

const marques = { titres: [], textes: [] };
for (const f of [...C.layouts, ...C.pages.filter((p) => p.route === '/').map((p) => p.fichier)]) {
  const s = lire(f);
  for (const m of s.matchAll(/title\s*:\s*["'`]([^"'`\n]{3,120})["'`]/g)) marques.titres.push(m[1].trim());
  for (const m of s.matchAll(/<title[^>]*>([^<]{3,120})<\/title>/g)) marques.titres.push(m[1].trim());
  if (/\/page\./.test(`/${f}`) || /^page\./.test(path.basename(f))) {
    for (const m of s.matchAll(/>\s*([^<>{}\n]{12,80}?)\s*</g)) {
      const t = m[1].trim();
      if (/^[\p{L}\p{N} .,:!?()-]+$/u.test(t) && /\p{L}{3}/u.test(t)) marques.textes.push(t);
    }
  }
}
marques.titres = [...new Set(marques.titres)];
marques.textes = [...new Set(marques.textes)].slice(0, 20);
C.marques = marques;

/* ── Quelle application répond, et est-ce bien celle-ci ────────────────────── */

const curl = (url, suivre = false) => {
  try {
    const out = execFileSync('curl', ['-s', '-i', ...(suivre ? ['-L', '--max-redirs', '3'] : []), '--max-time', '6',
      '-H', 'Accept: text/html,application/xhtml+xml', '-H', 'Sec-Fetch-Dest: document', '-H', 'Sec-Fetch-Mode: navigate',
      '-A', 'Mozilla/5.0 (X11; Linux x86_64) scan-backend-frontend', url],
    { encoding: 'utf8', timeout: 12000, maxBuffer: 8 * 1024 * 1024 });
    // Réponses en chaîne (redirections suivies) : on garde la dernière en-tête et le corps.
    const blocs = out.split(/\r?\n\r?\n/);
    let i = 0; while (i < blocs.length - 1 && /^HTTP\/\S+ [13]\d\d/.test(blocs[i + 1] || '') ) i++;
    const entetes = blocs.slice(0, i + 1).join('\n\n');
    const corps = blocs.slice(i + 1).join('\n\n');
    const codes = [...entetes.matchAll(/^HTTP\/\S+ (\d{3})/gm)].map((m) => m[1]);
    const location = (entetes.match(/^location:\s*(\S+)/mi) || [])[1] || null;
    const type = (entetes.match(/^content-type:\s*([^\r\n;]+)/mi) || [])[1] || '';
    return { code: codes[codes.length - 1] || '000', codes, location, type, corps };
  } catch { return null; }
};

function examiner(url) {
  const r0 = curl(url);
  if (!r0 || r0.code === '000') return { url, statut: 'éteinte' };
  const R = { url, code: r0.code, statut: 'non confirmée', detail: '' };
  /* Redirection : vers un autre hôte, c'est un fournisseur d'authentification (Clerk, Auth0…). */
  if (/^3/.test(r0.code) && r0.location) {
    let cible; try { cible = new URL(r0.location, url); } catch { cible = null; }
    if (cible && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(cible.hostname)) {
      return { ...R, statut: 'authentification', detail: `redirige vers ${cible.hostname} (${r0.code}) : écran de connexion ou poignée de main d'authentification` };
    }
  }
  const r = /^3/.test(r0.code) ? curl(url, true) || r0 : r0;
  R.code = r.code;
  if (!/html/i.test(r.type)) return { ...R, statut: 'non-html', detail: `la réponse est « ${r.type || 'sans type'} », pas une page` };
  const titre = ((r.corps.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  R.titre = titre;
  const corpsTexte = r.corps.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const pageConnexion = /type=["']password["']|clerk\.accounts|\/sign-in|\/login\b|se connecter|connexion/i.test(corpsTexte)
    && !marques.textes.some((t) => corpsTexte.includes(t));
  const titreConnu = marques.titres.some((t) => titre && (titre.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(titre.toLowerCase())));
  const texteConnu = marques.textes.filter((t) => corpsTexte.includes(t));
  if (titreConnu && pageConnexion && !texteConnu.length) {
    return { ...R, statut: 'authentification', detail: `répond avec l'écran de connexion de ce projet (titre « ${titre} »)` };
  }
  /* Un texte d'accueil se retrouve dans un projet jumeau (même gabarit) : il ne suffit
     que sur le port déclaré du projet ou sur une URL donnée explicitement, et à deux
     textes distincts au moins. Un titre déclaré suffit partout. */
  const portAttendu = urlForcee || Number(new URL(url).port || 80) === C.port;
  if (titreConnu || (texteConnu.length >= 2 && portAttendu)) {
    return { ...R, statut: 'confirmée', detail: titreConnu ? `titre « ${titre} » déclaré par ce projet` : `texte de la page d'accueil reconnu (« ${texteConnu[0]} », « ${texteConnu[1]} »)` };
  }
  if (texteConnu.length) {
    return { ...R, statut: 'non confirmée', detail: `la page servie partage du texte avec ce projet (« ${texteConnu[0]} ») mais ${portAttendu ? 'un seul texte' : `elle répond sur un port qui n'est pas celui du projet (:${C.port})`} : un projet jumeau est possible ; relancer avec --url ${url} pour l'assumer` };
  }
  /* Rien ne rattache la page servie à ce projet : c'est peut-être un autre projet de la
     machine, peut-être celui-ci derrière un écran de connexion. On ne tranche pas. */
  const attendu = marques.titres[0] ? `titre attendu « ${marques.titres[0]} »` : marques.textes[0] ? `texte attendu « ${marques.textes[0]} »` : 'ce projet ne déclare ni titre ni texte statique sur sa page d\'accueil, donc rien ne permet de le reconnaître';
  return { ...R, statut: 'non confirmée', detail: `la page servie a pour titre « ${titre || '?'} »${pageConnexion ? ' et ressemble à un écran de connexion' : ''} ; ${attendu}` };
}

const urlForcee = arg('--url', null);
const candidats = urlForcee ? [urlForcee] : [...new Set([C.port, 3000, 3001, 3100, 5173, 4310, 8080])].map((p) => `http://localhost:${p}`);
C.applications = [];
for (const u of candidats) {
  const ex = examiner(u);
  if (ex.statut === 'éteinte') continue;
  C.applications.push(ex);
  if (ex.statut === 'confirmée') break;
}
C.application = C.applications.find((x) => x.statut === 'confirmée') || C.applications[0] || { statut: 'éteinte' };
C.urlVivante = C.application.statut === 'confirmée' ? C.application.url : null;

/* ── Où vivent les fausses données ─────────────────────────────────────────── */

C.semeurs = [];
const chercherSemeurs = (d, prof = 0) => {
  if (prof > 4) return;
  let entrees; try { entrees = fs.readdirSync(path.join(RACINE, d), { withFileTypes: true }); } catch { return; }
  for (const e of entrees) {
    if (/node_modules|\.next|\.git|_generated|^\.backend$/.test(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) chercherSemeurs(p, prof + 1);
    else if (/(seed|mock|fixture|demo|sample|faker)[\w.-]*\.(ts|tsx|js|mjs|json)$/i.test(e.name)) {
      C.semeurs.push({ fichier: p, lignes: lire(p).split('\n').length });
    }
  }
};
chercherSemeurs('');

/* ── Ce qu'on ne sait pas, dit à voix haute ────────────────────────────────── */

C.inconnues = [];
if (!C.racinePages) C.inconnues.push('où sont les pages : aucun dossier de routes reconnu');
if (!C.schema) C.inconnues.push('où est le schéma : aucun fichier de définition de tables trouvé');
if (C.cadre === 'inconnu') C.inconnues.push('le cadre applicatif n\'est pas reconnu : l\'analyse des pages sera partielle');
const ap = C.application;
if (ap.statut === 'éteinte') {
  C.inconnues.push(`l'application ne répond sur aucun port testé : la lancer avec « ${C.commandeDev || 'la commande de dev du projet'} » pour couvrir le côté écran`);
} else if (ap.statut === 'non confirmée') {
  C.inconnues.push(`une application répond sur ${ap.url} mais je ne peux pas confirmer que c'est ce projet (${ap.detail}) : lancer ce projet sur un port libre (« ${C.commandeDev || 'npm run dev'} -- -p 3100 ») puis relancer avec --url http://localhost:3100`);
} else if (ap.statut === 'authentification') {
  C.inconnues.push(`${ap.url} ${ap.detail} : côté écran impossible sans session. Soit renseigner les clés d'authentification (${C.auth || 'fournisseur'}) dans .env.local, soit enregistrer une session dans un navigateur (Playwright storageState : « npx playwright codegen --save-storage=.backend/session.json ${ap.url} ») et la passer aux scripts d'écran avec --session .backend/session.json`);
} else if (ap.statut === 'non-html') {
  C.inconnues.push(`${ap.url} répond mais ${ap.detail} : ce n'est pas une application à cliquer, ou pas la bonne`);
}

/* ── Le rapport ────────────────────────────────────────────────────────────── */

console.log(`\n  RECONNAISSANCE · ${C.nom}`);
console.log(`  ${'-'.repeat(72)}`);
console.log(`  cadre            ${C.cadre}${C.base !== 'inconnue' ? ` · base ${C.base}` : ''}${C.auth ? ` · auth ${C.auth}` : ' · aucune authentification'}`);
console.log(`  déploiement      ${C.deploiement}`);
console.log(`  pages            ${C.racinePages || '?'}  →  ${C.pages.length} pages, dont ${C.pages.filter((p) => p.dynamique).length} à identifiant`);
console.log(`  modules          ${C.modules.length} : ${C.modules.slice(0, 12).join(', ')}${C.modules.length > 12 ? '…' : ''}`);
console.log(`  schéma           ${C.schema || '?'}  →  ${C.tables.length} tables`);
const etatApp = ap.statut === 'éteinte' ? 'éteinte'
  : ap.statut === 'confirmée' ? `${ap.url} (${ap.code}) · confirmée : ${ap.detail}`
    : `${ap.url} (${ap.code}) · ${ap.statut.toUpperCase()} : ${ap.detail}`;
console.log(`  application      ${etatApp}`);
console.log(`  fausses données  ${C.semeurs.length ? C.semeurs.map((s) => `${s.fichier} (${s.lignes} l.)`).join(', ') : 'aucun fichier d\'injection'}`);

if (C.inconnues.length) {
  console.log(`\n  ⚠️  CE QUE JE N'AI PAS COMPRIS`);
  for (const i of C.inconnues) console.log(`     · ${i.replace(/(.{80}\s)/g, '$1\n       ')}`);
  console.log(`\n  Un audit lancé là-dessus sera partiel. Corriger d'abord, ou l'assumer.`);
}

const j = ecrireJson(RACINE, 'reconnaissance.json', C, arg('--json', null));
console.log(`\n  Carte : ${j}\n`);
process.exitCode = C.inconnues.length ? 1 : 0;
