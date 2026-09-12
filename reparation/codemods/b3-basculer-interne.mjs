#!/usr/bin/env node
/**
 * b3-basculer-interne.mjs — « internalize-and-defer ».
 *
 * LA RÈGLE, ET POURQUOI ELLE EST CONTRE-INTUITIVE
 * Le skill officiel convex-authz (~/.agents/skills/convex-authz) pose une étape
 * obligatoire AVANT toute pose de garde :
 *
 *   « check the auth foundation exists before injecting any ctx.auth enforcement:
 *     (1) is there an auth.config.ts with a provider? (2) is there a users/identities
 *     table keyed to the auth subject? If EITHER is missing, DO NOT add
 *     requireIdentity/requireOwner — on a foundationless app ctx.auth.getUserIdentity()
 *     always returns null (enforcement is non-functional: every call 401s) and a
 *     reviewer correctly flags that as a NEW authz defect, not a fix. Instead […]
 *     convert the public query/mutation to internalQuery/internalMutation (removes
 *     public reachability entirely — safe and foundation-free). »
 *
 * C'est exactement projet client A : pas de convex/auth.config.ts, donc les 219 « portes sans
 * garde » ne se corrigent pas en ajoutant une garde. Elles se trient :
 *   — celles qu'aucun écran n'appelle  → internal*, la porte disparaît. Mécanique.
 *   — celles qu'un écran appelle       → dette d'authentification, déclarée une
 *                                        fois. Ni codemod ni agent : une décision.
 *
 * Le codemod ne bascule QUE la première catégorie, et il le prouve en cherchant
 * lui-même les appels côté client. La condition tombe, la bascule ne se fait pas.
 *
 *   node b3-basculer-interne.mjs <repo> [--appliquer] [--symbole mod.fn] [--json]
 */

import fs from 'node:fs';
import path from 'node:path';

const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const APPLIQUER = process.argv.includes('--appliquer');
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const CIBLE = arg('--symbole');

const PAIRES = [['query', 'internalQuery'], ['mutation', 'internalMutation'], ['action', 'internalAction']];

/* Qui a le droit d'appeler une fonction INTERNE : le serveur Convex, et lui seul.
   ⚠️ Piège payé en mesurant : la première version classait « client » les seuls
   app/ et components/, donc `scripts/ingest_icloud_agenda.mjs` — un script Node qui
   parle à Convex par le client HTTP — passait pour un appelant serveur, et la
   bascule de `agenda.upsertEvenements` en internal aurait cassé l'ingestion du
   calendrier iCloud d'projet client A en silence. La règle juste est l'inverse d'une liste
   noire : est serveur ce qui vit DANS convex/, tout le reste est un consommateur
   public, y compris un script du dépôt. */
const SERVEUR = /^convex\//;

function fichiersDe(dir, base = dir, out = []) {
  let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (['node_modules', '.next', '.git', '_generated', 'dist', '.vercel'].includes(x.name) || x.name.startsWith('.')) continue;
    const p = path.join(dir, x.name);
    if (x.isDirectory()) fichiersDe(p, base, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(x.name)) out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

const tous = fichiersDe(RACINE);
const lire = (f) => fs.readFileSync(path.join(RACINE, f), 'utf8');
const textes = new Map(tous.map((f) => [f, lire(f)]));

/* La fondation d'authentification, au sens de convex-authz : les DEUX morceaux. */
const fondation = {
  config: fs.existsSync(path.join(RACINE, 'convex/auth.config.ts')) || fs.existsSync(path.join(RACINE, 'convex/auth.config.js')),
  tableSujet: /tokenIdentifier|identity\.subject/.test([...textes.entries()].filter(([f]) => /^convex\/schema\.ts$/.test(f)).map(([, t]) => t).join('\n')),
};
fondation.presente = fondation.config && fondation.tableSujet;

/* Recensement des fonctions publiques exportées d'un module Convex. */
function unitesPubliques() {
  const out = [];
  for (const f of tous.filter((x) => /^convex\//.test(x) && !/_generated|schema\.ts|auth\.config|\.test\./.test(x))) {
    const txt = textes.get(f);
    const mod = f.replace(/^convex\//, '').replace(/\.ts$/, '');
    for (const m of txt.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(query|mutation|action)\s*\(/g)) {
      out.push({ fichier: f, module: mod, nom: m[1], genre: m[2], ligne: txt.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

/* Qui appelle quoi. On relit le texte plutôt que d'emprunter le graphe du scanner :
   l'invariant doit être indépendant de l'outil qui a signalé le défaut. */
function appelants(u) {
  const motif = new RegExp(`\\b(api|internal)\\.${u.module.replace(/\//g, '\\.')}\\.${u.nom}\\b`);
  const cote = { client: [], serveur: [] };
  for (const [f, txt] of textes) {
    if (!motif.test(txt)) continue;
    // Un module qui s'appelle lui-même par ctx.runQuery(api.x.y) est un appelant
    // serveur à part entière : c'est le cas B3 le plus courant, et l'exclure
    // faisait rater les deux seuls que le scanner avait trouvés sur projet client A.
    (SERVEUR.test(f) ? cote.serveur : cote.client).push(f);
  }
  return cote;
}

const unites = unitesPubliques().filter((u) => !CIBLE || `${u.module}.${u.nom}` === CIBLE);

const basculables = [], retenues = [];
for (const u of unites) {
  const a = appelants(u);
  const qualifie = a.client.length === 0;
  (qualifie ? basculables : retenues).push({ ...u, appelantsClient: a.client, appelantsServeur: a.serveur });
}

/* ── L'écriture ────────────────────────────────────────────────────────────── */

function basculer(u) {
  const paire = PAIRES.find(([p]) => p === u.genre);
  let txt = textes.get(u.fichier);

  // 1. la déclaration
  const re = new RegExp(`(export\\s+const\\s+${u.nom}\\s*=\\s*)${u.genre}(\\s*\\()`);
  if (!re.test(txt)) return { ok: false, raison: 'déclaration introuvable' };
  txt = txt.replace(re, `$1${paire[1]}$2`);

  // 2. l'import : on ajoute le symbole interne s'il manque, on ne retire l'ancien
  //    que s'il ne sert plus dans le fichier.
  const imp = txt.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/_generated\/server["'];?/);
  if (imp) {
    const noms = imp[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (!noms.includes(paire[1])) noms.push(paire[1]);
    const resteUtilise = new RegExp(`=\\s*${u.genre}\\s*\\(`).test(txt);
    const finaux = noms.filter((n) => n !== u.genre || resteUtilise);
    txt = txt.replace(imp[0], `import { ${finaux.join(', ')} } from "./_generated/server";`);
  }

  // 3. les appelants serveur : api.x.y → internal.x.y, et l'import qui va avec.
  const modifies = [{ fichier: u.fichier, texte: txt }];
  for (const f of appelants(u).serveur) {
    let t = textes.get(f);
    const avant = t;
    t = t.replace(new RegExp(`\\bapi\\.${u.module.replace(/\//g, '\\.')}\\.${u.nom}\\b`, 'g'), `internal.${u.module.replace(/\//g, '.')}.${u.nom}`);
    if (t !== avant && !/import\s*\{[^}]*\binternal\b/.test(t)) {
      const impApi = t.match(/import\s*\{([^}]*)\}\s*from\s*["']\.\/_generated\/api["'];?/);
      if (impApi) {
        const noms = impApi[1].split(',').map((s) => s.trim()).filter(Boolean);
        if (!noms.includes('internal')) noms.push('internal');
        t = t.replace(impApi[0], `import { ${noms.join(', ')} } from "./_generated/api";`);
      }
    }
    if (t !== avant) modifies.push({ fichier: f, texte: t });
  }
  return { ok: true, modifies };
}

/* ── Sortie ────────────────────────────────────────────────────────────────── */

const rapport = {
  racine: RACINE,
  fondationAuth: fondation,
  regle: fondation.presente
    ? "La fondation d'authentification existe : ce codemod ne traite que B3 (fonctions appelées uniquement côté serveur). Les gardes d'identité relèvent de l'agent, via le skill convex-authz."
    : "⚠️ Pas de fondation d'authentification (auth.config.ts absent). Ajouter une garde d'identité CRÉERAIT un défaut : ctx.auth.getUserIdentity() rend toujours null. Seule correction sûre : basculer en internal* ce qu'aucun écran n'appelle.",
  basculables: basculables.map((u) => ({ symbole: `${u.module}.${u.nom}`, genre: u.genre, fichier: `${u.fichier}:${u.ligne}`, appelantsServeur: u.appelantsServeur })),
  retenues: retenues.map((u) => ({ symbole: `${u.module}.${u.nom}`, raison: `appelée par ${u.appelantsClient.length} fichier(s) client`, appelantsClient: u.appelantsClient.slice(0, 3) })),
  applique: [],
};

if (APPLIQUER) {
  const ecrits = new Map();
  for (const u of basculables) {
    const r = basculer(u);
    if (!r.ok) { rapport.applique.push({ symbole: `${u.module}.${u.nom}`, ok: false, raison: r.raison }); continue; }
    for (const m of r.modifies) { textes.set(m.fichier, m.texte); ecrits.set(m.fichier, m.texte); }
    rapport.applique.push({ symbole: `${u.module}.${u.nom}`, ok: true, fichiers: r.modifies.map((m) => m.fichier) });
  }
  for (const [f, t] of ecrits) fs.writeFileSync(path.join(RACINE, f), t);
  rapport.fichiersEcrits = [...ecrits.keys()];
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rapport, null, 2));
} else {
  console.log(`\n╔══ internalize-and-defer ─ ${path.basename(RACINE)}`);
  console.log(`║  fondation d'authentification : ${fondation.presente ? 'présente' : `ABSENTE (auth.config.ts ${fondation.config ? 'ok' : 'manquant'}, table sujet ${fondation.tableSujet ? 'ok' : 'manquante'})`}`);
  console.log(`╚══ ${rapport.regle}\n`);
  console.log(`  ${basculables.length} fonction(s) basculables en internal* (aucun appel client)`);
  for (const b of rapport.basculables.slice(0, 12)) console.log(`      ${b.symbole.padEnd(40)} ${b.genre.padEnd(9)} ${b.fichier}`);
  if (basculables.length > 12) console.log(`      … ${basculables.length - 12} autres`);
  console.log(`\n  ${retenues.length} fonction(s) NON basculables : un écran les appelle. Ce sont elles, la dette d'authentification.`);
  for (const r of rapport.retenues.slice(0, 6)) console.log(`      ${r.symbole.padEnd(40)} ${r.raison}`);
  if (retenues.length > 6) console.log(`      … ${retenues.length - 6} autres`);
  if (APPLIQUER) console.log(`\n  écrit : ${(rapport.fichiersEcrits || []).length} fichier(s)`);
  else console.log(`\n  (à blanc — ajouter --appliquer pour écrire)`);
  console.log();
}
