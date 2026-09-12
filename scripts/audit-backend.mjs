#!/usr/bin/env node
/**
 * audit-backend.mjs — Auditeur de câblage backend, indépendant de la stack.
 *
 * Ne cherche pas « du beau code ». Cherche les CHAÎNES CASSÉES :
 * une fonction ou une route que personne n'appelle, une table qu'on écrit sans
 * jamais la lire, une porte publique sans serrure, une erreur avalée en silence,
 * une variable d'environnement attendue par le code et absente du déploiement.
 *
 * Les stacks sont décrites par des adaptateurs (scripts/adapters/*.mjs) et
 * détectées automatiquement. Plusieurs peuvent être actifs en même temps
 * (ex. Next.js pour les routes + Prisma pour les tables).
 *
 * Usage :
 *   node audit-backend.mjs [repo] [--json] [--full] [--only=A,B,C] [--list-stacks]
 *
 * Sortie : rapport priorisé. Code 1 s'il reste un défaut BLOQUANT.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resoudreGardes, estGardee } from './gardes.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const FLAGS = process.argv.slice(2).filter((a) => a.startsWith('--'));
const AS_JSON = FLAGS.includes('--json');
const FULL = FLAGS.includes('--full');
const LIST = FLAGS.includes('--list-stacks');
const ONLY = (FLAGS.find((f) => f.startsWith('--only=')) || '').replace('--only=', '').split(',').filter(Boolean);

const IGNORED = new Set(['node_modules', '_generated', '.next', '.git', 'dist', 'build', '.vercel', 'coverage', '.turbo', 'out', '.output', 'vendor', '__pycache__']);
const LEGACY = /(^|[\\/])(_?legacy|archive|old|backup|deprecated)[\\/]/i;
const CODE = /\.(ts|tsx|js|jsx|mjs|cjs|sql|prisma)$/;

/* ─────────────────────────────── Lecture du repo ────────────────────────── */

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (IGNORED.has(e.name) || (e.name.startsWith('.') && e.name !== '.env.example')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (CODE.test(e.name)) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const files = walk(ROOT).map((p) => ({ p, rel: rel(p), txt: fs.readFileSync(p, 'utf8') }));
const GARDES = resoudreGardes(files);
const live = files.filter((f) => !LEGACY.test(f.rel)); // hors dossiers explicitement morts

const ctx = {
  root: ROOT,
  files: live,
  allFiles: files,
  pkg: readJson('package.json') || {},
  exists: (p) => fs.existsSync(path.join(ROOT, p)),
  hasDir: (d) => { try { return fs.statSync(path.join(ROOT, d)).isDirectory(); } catch { return false; } },
  read: (p) => fs.readFileSync(path.join(ROOT, p), 'utf8'),
  glob: (re) => live.filter((f) => re.test(f.rel)).map((f) => f.rel),
};

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch { return null; }
}

/* ──────────────────────────── Adaptateurs de stack ──────────────────────── */

const adapters = [];
const adapterDir = path.join(HERE, 'adapters');
for (const f of fs.existsSync(adapterDir) ? fs.readdirSync(adapterDir).filter((x) => x.endsWith('.mjs')).sort() : []) {
  const mod = await import(pathToFileURL(path.join(adapterDir, f)).href);
  // Le dossier contient aussi des aides partagées (bases.mjs, extraction*.mjs) qui ne
  // sont pas des adaptateurs de stack : elles n'ont pas de `detect`. Sans ce filtre,
  // `adapters.map(a => a.name)` plantait sur un `default` absent.
  if (mod.default && typeof mod.default.detect === 'function') adapters.push(mod.default);
}
const active = adapters.filter((a) => { try { return a.detect(ctx); } catch { return false; } });

if (LIST) {
  console.log(`Adaptateurs disponibles : ${adapters.map((a) => a.name).join(', ')}`);
  console.log(`Détectés dans ${path.basename(ROOT)} : ${active.map((a) => a.name).join(', ') || 'aucun'}`);
  process.exit(0);
}

if (!active.length) {
  console.error(`Aucune stack backend reconnue dans ${ROOT}.`);
  console.error(`Connues : ${adapters.map((a) => a.name).join(', ')}.`);
  console.error(`Ajouter un adaptateur : ${path.join(adapterDir, '<stack>.mjs')} (voir references/ajouter-une-stack.md).`);
  process.exit(2);
}

/* ───────────────────── Collecte : unités exposées + entités ─────────────── */

const units = [];
for (const a of active) {
  if (!a.unitFiles || !a.units) continue;
  for (const f of live) {
    let keep = false;
    try { keep = a.unitFiles(f); } catch { keep = false; }
    if (!keep) continue;
    for (const u of a.units(f)) units.push({ ...u, file: f.rel, stack: a.name, adapter: a });
  }
}

// Une même table peut être déclarée par deux stacks (schéma Convex + migration SQL
// héritée, par exemple). On fusionne : une lecture par n'importe quel adaptateur compte.
const entityMap = new Map();
for (const a of active) {
  if (!a.entities) continue;
  let list = [];
  try { list = a.entities(ctx) || []; } catch { list = []; } // schéma illisible
  for (const e of list) {
    const prev = entityMap.get(e.name);
    if (prev) {
      prev.adapters.push(a);
      prev.fields = [...new Set([...(prev.fields || []), ...(e.fields || [])])];
      prev.source += ` + ${e.source}`;
    } else {
      entityMap.set(e.name, { ...e, adapters: [a], stack: a.name });
    }
  }
}
const entities = [...entityMap.values()];

/* ── LE REFUS DE CONCLURE, et l'aveu partiel ────────────────────────────────
   Une stack détectée ne veut pas dire une stack comprise. Si ni une unité exposée ni
   une entité de données n'a été reconnue, toutes les règles de câblage et de données
   rendent zéro pour la même raison : il n'y a rien dans le dénominateur. Ce zéro-là
   n'est pas « rien à signaler », c'est « le travail n'a pas pu être fait » — code 2.

   Quand une seule des deux moitiés manque, le rapport reste utile (les règles de texte
   et de chemins travaillent quand même) mais il doit le DIRE en tête, sinon le lecteur
   prend un rapport à moitié aveugle pour un rapport propre. */
const incomprehensions = [];
if (!units.length && !entities.length) {
  const { refuser } = await import(pathToFileURL(path.join(adapterDir, 'bases.mjs')).href);
  refuser("unité exposée ni entité de données", ROOT,
    `Stack détectée : ${active.map((a) => a.name).join(' + ')}. Détectée n'est pas comprise.`);
}
if (!entities.length) incomprehensions.push("aucune table reconnue : A2, A3 et tout ce qui parle de données n'ont rien jugé");
if (!units.length) incomprehensions.push("aucune unité exposée reconnue : A1, B1 et B2 n'ont rien jugé");

// Le dépôt entier en un seul texte, sans un fichier donné (celui qui déclare l'entité
// qu'on cherche). Les fichiers sont séparés par un saut de ligne pour qu'aucun motif ne
// chevauche deux fichiers. Mémorisé par fichier exclu.
const _corpus = new Map();
const corpusSans = (rel) => {
  if (!_corpus.has(rel)) _corpus.set(rel, live.filter((f) => f.rel !== rel).map((f) => f.txt).join('\n'));
  return _corpus.get(rel);
};

const findings = [];
const add = (id, axe, gravite, titre, items, detail) => {
  if (ONLY.length && !ONLY.includes(axe)) return;
  if (items.length) findings.push({ id, axe, gravite, titre, detail, items });
};
const lineAt = (txt, i) => txt.slice(0, i).split('\n').length;
// Exception assumée. Pas de \b après une lettre accentuée : en JS, « é » n'est pas
// un caractère de mot, donc \b ne s'y applique pas et la règle ne matcherait jamais.
const ANNOTATED = /\/\/\s*(appel|called|invoqu|expos|utilis)/i;

/* ══════════════════ AXE A — CÂBLAGE (les liens qui se perdent) ═══════════ */

// A1 · Unité exposée que rien n'appelle.
{
  const dead = [];
  for (const u of units) {
    if (u.exposure === 'http') continue;
    const pats = u.adapter.refPatterns(u);
    if (!pats.length) continue;
    // Pré-filtre par recherche de sous-chaîne : une expression régulière par unité et par
    // fichier coûtait 21 s sur un dépôt de 900 unités. Un fichier qui ne contient même pas
    // le nom brut ne peut pas contenir l'appel.
    const aiguilles = u.adapter.refNeedles ? u.adapter.refNeedles(u) : null;
    const touched = live.some((f) => (f.rel !== u.file || u.kind === 'route' || u.adapter.selfRefsCount)
      && (!aiguilles || aiguilles.some((s) => f.txt.includes(s)))
      && pats.some((re) => { re.lastIndex = 0; return re.test(f.txt); }));
    if (touched) continue;
    // Exception assumée : annotation dans l'unité, ou dans les lignes qui la précèdent.
    const host = live.find((f) => f.rel === u.file);
    const above = host ? host.txt.split('\n').slice(Math.max(0, u.line - 5), u.line).join('\n') : '';
    if (ANNOTATED.test(u.body.slice(0, 300)) || ANNOTATED.test(above)) continue;
    dead.push(`${String(u.kind).padEnd(14)} ${u.label}  (${u.file}:${u.line})`);
  }
  add('A1', 'A', dead.length > units.length * 0.15 ? 'BLOQUANT' : 'À TRAITER',
    `Unités backend que rien n'appelle (${dead.length}/${units.length})`, dead,
    "Chaîne morte : le code existe, la feature n'existe pas. Soit la surface qui devait l'appeler n'a jamais été câblée, soit c'est un résidu. Les deux se corrigent, aucune ne se laisse en place.\nException légitime (client externe, agent, webhook d'un fournisseur, backfill) : l'annoter dans le code, une ligne « // appelé par <qui> depuis <où> », et elle sort du décompte.");
}

// A2 · Entité de données écrite sans être lue, ou lue sans être écrite.
{
  const orphans = [], deadFields = [];
  for (const e of entities) {
    const rp = e.adapters.flatMap((a) => a.readPatterns?.(e.name, e) || []);
    const wp = e.adapters.flatMap((a) => a.writePatterns?.(e.name, e) || []);
    const count = (pats) => live.reduce((n, f) => {
      if (f.rel === e.source) return n;
      return n + pats.reduce((k, re) => { re.lastIndex = 0; return k + (f.txt.match(re) || []).length; }, 0);
    }, 0);
    const reads = count(rp), writes = count(wp);
    if (!rp.length && !wp.length) continue;
    if (reads === 0 && writes === 0) orphans.push(`${e.name.padEnd(30)} morte (ni lue ni écrite) · ${e.source}`);
    else if (reads === 0) orphans.push(`${e.name.padEnd(30)} écrite ${writes}× JAMAIS LUE  → donnée collectée pour rien`);
    else if (writes === 0) orphans.push(`${e.name.padEnd(30)} lue ${reads}× JAMAIS ÉCRITE → l'écran restera vide en prod`);

    // Un champ a deux vies : on l'écrit, on le lit. Le seul cas qu'on sache prouver en
    // statique est l'absence de LECTURE : l'écriture passe par mille chemins (objet
    // construit ailleurs, spread des arguments, helper), et vouloir la détecter produit
    // des faux positifs en masse. Vécu : 223 signalements sur projet client B dont « devis.numero
    // jamais écrit », ce qui est impossible. Un détecteur qui se trompe est pire qu'absent.
    // Trois expressions par champ sur CHAQUE fichier : 85 s sur un dépôt de 900 fichiers,
    // c'est-à-dire un auditeur que personne ne relance. On concatène une fois le dépôt
    // (moins le fichier source de l'entité) et on cherche dans ce seul texte : mêmes
    // décomptes, cent fois moins de compilations.
    const corpus = corpusSans(e.source);
    for (const fld of e.fields || []) {
      const mentionne = (corpus.match(new RegExp(`\\b${fld}\\b`, 'g')) || []).length;
      if (!mentionne) { deadFields.push(`${e.name}.${fld}  jamais mentionné nulle part`); continue; }
      let lu = (corpus.match(new RegExp(`[.?]\\s*${fld}\\b`, 'g')) || []).length;
      if (!lu) lu += (corpus.match(new RegExp(`\\{[^{}]{0,150}\\b${fld}\\b[^{}]{0,150}\\}\\s*=`, 'g')) || []).length;
      if (!lu) deadFields.push(`${e.name}.${fld}  mentionné ${mentionne}× mais jamais LU — donnée collectée pour rien`);
    }
  }
  add('A2', 'A', 'BLOQUANT', `Entités de données orphelines (${orphans.length})`, orphans,
    "Une table écrite jamais lue = un module qui alimente le vide. Une table lue jamais écrite = un écran qui restera vide quoi qu'il arrive. C'est la signature n°1 d'un lien logique perdu entre deux modules.");
  add('A3', 'A', 'À TRAITER', `Champs de schéma jamais utilisés (${deadFields.length})`, deadFields,
    "Champ déclaré, jamais écrit ni lu : soit la moitié de la chaîne a été oubliée, soit le schéma ment sur ce qu'il contient.");
}

// A4 · Tâche planifiée qui vise une cible disparue.
{
  const broken = [];
  for (const a of active) {
    if (!a.cronFile || !ctx.exists(a.cronFile)) continue;
    const txt = ctx.read(a.cronFile);
    for (const m of txt.matchAll(a.cronRefRe)) {
      const [, , mod, name] = m;
      if (!units.some((u) => u.mod === mod.replace(/\./g, '/') && u.name === name)) broken.push(`${mod}.${name} — cible introuvable (${a.cronFile})`);
    }
  }
  // Crons déclarés côté plateforme (vercel.json / vercel.ts) qui visent une route absente.
  for (const cfg of ['vercel.json', 'vercel.ts']) {
    if (!ctx.exists(cfg)) continue;
    const txt = ctx.read(cfg);
    for (const m of txt.matchAll(/["'`]?path["'`]?\s*:\s*["'`]([^"'`]+)["'`]/g)) {
      const p = m[1].split('?')[0];
      if (!units.some((u) => u.urlPath && p.startsWith(u.urlPath))) broken.push(`${p} — cron ${cfg} sans route correspondante`);
    }
  }
  add('A4', 'A', 'BLOQUANT', `Tâches planifiées cassées (${broken.length})`, broken,
    "Un cron qui vise une fonction renommée échoue en silence dans les logs : personne ne le voit, la donnée arrête juste de se mettre à jour.");
}

// A5 · Variable d'environnement attendue par le code, absente du repo de référence.
{
  const used = new Map();
  for (const f of live) {
    for (const m of f.txt.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})|process\.env\[["'`]([A-Z][A-Z0-9_]{2,})["'`]\]|Deno\.env\.get\(["'`]([A-Z][A-Z0-9_]{2,})["'`]\)/g)) {
      const k = m[1] || m[2] || m[3];
      if (!used.has(k)) used.set(k, `${f.rel}:${lineAt(f.txt, m.index)}`);
    }
  }
  const declared = new Set();
  for (const p of ['.env.example', '.env.sample', '.env.local.example', '.env', 'turbo.json', 'vercel.json']) {
    if (!ctx.exists(p)) continue;
    for (const m of ctx.read(p).matchAll(/^\s*(?:#\s*)?([A-Z][A-Z0-9_]{2,})\s*[=:]/gm)) declared.add(m[1]);
    for (const m of ctx.read(p).matchAll(/["']([A-Z][A-Z0-9_]{2,})["']/g)) declared.add(m[1]);
  }
  const BUILTIN = /^(NODE_ENV|VERCEL|VERCEL_.*|PORT|CI|npm_.*|NEXT_RUNTIME|PWD|HOME|PATH|TZ)$/;
  const missing = [...used.entries()].filter(([k]) => !declared.has(k) && !BUILTIN.test(k)).map(([k, where]) => `${k.padEnd(34)} ${where}`);
  const hasRef = ['.env.example', '.env.sample', '.env.local.example'].some(ctx.exists);
  add('A5', 'A', hasRef ? 'BLOQUANT' : 'À TRAITER',
    `Variables d'environnement non déclarées (${missing.length})`, missing,
    (hasRef
      ? "Le code les attend, le fichier de référence ne les mentionne pas. C'est la panne classique « ça marche en local, pas en prod » : le déploiement n'a aucun moyen de savoir qu'il lui manque une clé."
      : "Aucun .env.example dans le repo : rien ne documente ce dont le déploiement a besoin. En créer un qui liste ces clés (sans les valeurs) est le geste le moins cher de toute cette liste."));
}

/* ══════════ AXE B — PORTES (contrat d'entrée, accès, multi-tenant) ═══════ */

// B1 · Unité publique sans vérification de l'appelant.
// La garde n'est plus reconnue à son NOM (liste anglaise : 16 faux positifs sur 16 sur
// un helper nommé `orgCourante`) mais RÉSOLUE : on remonte à ce qui vérifie réellement
// une identité, une signature ou un secret, et on propage aux appelants. Voir gardes.mjs.
{
  const naked = [], pub = units.filter((u) => u.exposure === 'public');
  for (const u of pub) {
    if (estGardee(u.body, GARDES.gardes)) continue;
    naked.push(`${String(u.kind).padEnd(14)} ${u.label}  (${u.file}:${u.line})`);
  }
  add('B1', 'B', 'BLOQUANT', `Portes publiques sans garde d'identité (${naked.length}/${pub.length})`, naked,
    "Une fonction ou une route publique est joignable par n'importe qui sur Internet, connecté ou non : le fait que l'UI ne l'appelle que depuis une page protégée ne protège rien, l'UI n'est pas la porte.\nEt authentifier n'est pas autoriser : sur du multi-client, le cloisonnement passe par l'index de lecture, pas par un filtre appliqué après coup.");
}

// B2 · Unité publique sans validation des entrées.
{
  // Une unité qui ne lit AUCUNE entrée n'a rien à valider : reprocher son absence de
  // validateur à un `GET /api/agenda` sans paramètre produit du bruit qui noie les vraies
  // portes ouvertes. Mesuré sur banc/stacks : 9 constats sur 16 étaient des GET nus.
  // Lire le corps s'écrit `requete.json()` — sans argument. `NextResponse.json(data)`,
  // qui ÉCRIT la réponse, en a un : sans cette distinction, toute route en était une.
  const litUneEntree = (u) => /\.\s*(json|text|formData|arrayBuffer)\s*\(\s*\)|\.input\s*\(|\bargs\s*:|searchParams|req(uest|uete)?\s*\.\s*(body|query)|\bparams\b/.test(u.body);
  const noArgs = units.filter((u) => u.exposure === 'public' && u.adapter.validatorRe
      && litUneEntree(u) && !u.adapter.validatorRe.test(u.body))
    .map((u) => `${u.label}  (${u.file}:${u.line})`);
  // Un bloc `args:` existe, mais un de ses champs est `v.any()` : la porte a un validateur
  // de façade et accepte n'importe quoi pour ce champ. Mesuré à l'aveugle : 0/3 puis 0/4
  // portes ouvertes de cette façon n'étaient vues par personne.
  // LISTE NÉGATIVE : jamais sur une unité interne (l'appelant est le serveur) ; jamais sur un
  // champ dont le nom annonce un sac opaque (payload, metadata, properties, options…) : là,
  // l'absence de forme est le contrat, pas un oubli ; jamais sur un `v.any()` imbriqué dans
  // v.record / v.array / v.object (le conteneur, lui, est typé).
  const OPAQUE = /^(payload|meta|metadata|properties|props|extra|extras|data|json|raw|body|options|params|attrs|attributes|config|settings|context|contexte|details|detail|value|valeur|content|contenu|state|etat|snapshot|dump|blob|record|fields|champs|patch|delta|diff|args|input|any|submission|form|formulaire|answers|reponses)$/i;
  for (const u of units) {
    if (u.exposure !== 'public') continue;
    const iArgs = u.body.search(/\bargs\s*:\s*\{/);
    if (iArgs === -1) continue;
    const iHandler = u.body.search(/\bhandler\s*:/);
    const entete = u.body.slice(iArgs, iHandler === -1 ? Math.min(u.body.length, iArgs + 1500) : iHandler);
    for (const m of entete.matchAll(/^\s*(\w+)\s*:\s*v\.(?:optional\(\s*v\.)?any\(\s*\)/gm)) {
      if (OPAQUE.test(m[1])) continue;
      noArgs.push(`${u.label}  (${u.file}:${u.line})  argument « ${m[1]} » accepté sans aucune forme (v.any())`);
    }
  }
  add('B2', 'B', 'À TRAITER', `Entrées publiques non validées (${noArgs.length})`, noArgs,
    "TypeScript n'existe plus à l'exécution. Sans validateur (zod, v.*, class-validator…), l'appelant envoie ce qu'il veut et la donnée se corrompt sans un seul message d'erreur.\nUn champ déclaré v.any() dans un bloc args est la même porte ouverte, avec un validateur de façade devant.");
}

// B3 · Fonction interne exposée publiquement (spécifique stack).
{
  const leaks = [];
  for (const a of active) {
    if (!a.internalOnlyLeakRe) continue;
    for (const f of live) {
      const re = new RegExp(a.internalOnlyLeakRe.source, 'g');
      let m;
      while ((m = re.exec(f.txt))) leaks.push(`${f.rel}:${lineAt(f.txt, m.index)}  → api.${m[2]} (doit être internal.*)`);
    }
  }
  add('B3', 'B', 'À TRAITER', `Appels internes passant par la porte publique (${leaks.length})`, leaks,
    "Une fonction appelée par le planificateur ou par une autre fonction n'a aucune raison d'être exposée. Chaque porte inutile est une porte à défendre.");
}

// B5 (retirée le 12/09/2026) : « la seule porte du module sans le contrôle que ses sœurs
// appliquent », par vote de majorité. Mesurée : 3 signalements sur 3 étaient faux (une
// lecture ouverte à tous dans un fichier d'écritures réservées à l'admin ; une action
// utilisateur au milieu d'outils réservés au fondateur ; une synchronisation Clerk). Un
// rôle mêlé dans un même fichier est un choix courant, pas un oubli : la règle n'est pas
// discriminante. Retirée plutôt que gardée « pour le rappel ».

// B4 · Secret en dur (toutes stacks).
{
  const hard = [];
  const PATTERNS = [
    [/\b(sk_live_|sk_test_|rk_live_)[A-Za-z0-9]{10,}/g, 'clé Stripe'],
    [/\bsk-[A-Za-z0-9_-]{20,}/g, 'clé OpenAI/Anthropic'],
    [/\bghp_[A-Za-z0-9]{20,}/g, 'token GitHub'],
    [/\bxox[baprs]-[A-Za-z0-9-]{10,}/g, 'token Slack'],
    [/\bAKIA[0-9A-Z]{16}\b/g, 'clé AWS'],
    [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, 'JWT en dur'],
    [/(?:password|secret|apiKey|api_key|token)\s*[:=]\s*["'`]([^"'`$\s{}]{12,})["'`]/gi, 'secret littéral'],
  ];
  // Un littéral n'est un secret que s'il en a la tête : ni un NOM de variable
  // d'environnement, ni un chemin, ni une URL, ni une phrase.
  const looksLikeSecret = (v) => v && !/^[A-Z][A-Z0-9_]*$/.test(v) && !/^https?:|^\/|\s|\.(com|io|dev|ch|fr)\b/.test(v) && /[a-z]/.test(v) && /[0-9A-Z_-]/.test(v);
  for (const f of live) {
    if (/\.(test|spec)\.|\/tests?\//.test(f.rel)) continue;
    for (const [re, label] of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(f.txt))) {
        if (/process\.env|import\.meta\.env|example|placeholder|xxx|<your/i.test(f.txt.slice(Math.max(0, m.index - 60), m.index + 60))) continue;
        if (label === 'secret littéral' && !looksLikeSecret(m[1])) continue;
        hard.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${label}`);
      }
    }
  }
  add('B4', 'B', 'BLOQUANT', `Secrets en dur dans le code (${hard.length})`, hard,
    "Un secret commité est publié, y compris après un rollback : il se révoque, il ne se retire pas. Tout secret vient de l'environnement.");
}

/* ═════════ AXE C — SILENCE (ce qui casse sans que personne le voie) ══════ */

// C1 · Panne masquée par un catch muet.
{
  const critiques = [], anodins = [];
  for (const f of live) {
    for (const m of f.txt.matchAll(/catch\s*(?:\(\s*\w*\s*\))?\s*\{([^}]{0,120})\}/g)) {
      const body = m[1].trim();
      const muet = body === '' || /^(\/\/.*|\/\*[\s\S]*?\*\/)$/.test(body) || /^return\s*(null|undefined|\[\]|\{\}|false|0)\s*;?$/.test(body);
      if (!muet) continue;
      const bloc = f.txt.slice(Math.max(0, m.index - 900), m.index);
      const tryAt = bloc.lastIndexOf('try');
      const surveille = tryAt === -1 ? bloc : bloc.slice(tryAt);
      const item = `${f.rel}:${lineAt(f.txt, m.index)}  catch { ${body.slice(0, 40)} }`;
      if (/fetch\(|axios|ctx\.db\.|ctx\.scheduler|runMutation|runAction|\.insert\(|\.patch\(|\.update\(|prisma\.|supabase|stripe|clerk|webhook|sendMail|sendMessage/i.test(surveille)) critiques.push(item);
      else anodins.push(item);
    }
  }
  add('C1', 'C', 'BLOQUANT', `Pannes masquées par un catch muet (${critiques.length})`, critiques,
    "C'est LA cause des « ça marchait hier ». L'intégration tombe, le catch renvoie [] , l'écran affiche « aucune donnée » et tout le monde croit que c'est normal : la panne dort des semaines.\nUn catch correct fait trois choses : il trace, il remonte un état distinct de « vide », et l'écran affiche cet état.");
  // Un catch qui renvoie un succès est pire qu'un catch vide : l'appelant (un
  // fournisseur de webhook, un cron) enregistre que tout va bien et ne réessaiera jamais.
  const menteurs = [];
  for (const f of live) {
    for (const m of f.txt.matchAll(/catch\s*(?:\(\s*\w*\s*\))?\s*\{([\s\S]{0,220}?)\}/g)) {
      const corps = m[1];
      if (!/return/.test(corps)) continue;
      const succes = /ok\s*:\s*true|success\s*:\s*true|status\s*:\s*2\d\d|NextResponse\.json\([^)]*\)(?!\s*,\s*\{[^}]*status\s*:\s*[45])|new Response\(\s*["'`]ok/i.test(corps);
      const erreurAnnoncee = /status\s*:\s*[45]\d\d|throw|ok\s*:\s*false|error\s*:/i.test(corps);
      if (!succes || erreurAnnoncee) continue;
      menteurs.push(`${f.rel}:${lineAt(f.txt, m.index)}  catch qui répond un succès : ${corps.replace(/\s+/g, ' ').trim().slice(0, 60)}`);
    }
  }
  add('C1c', 'C', 'BLOQUANT', `Échecs déguisés en succès (${menteurs.length})`, menteurs,
    "Le traitement échoue et la réponse dit que tout va bien. Le fournisseur de webhook enregistre une livraison réussie et ne réessaiera jamais ; la donnée est perdue et aucune alerte ne se déclenche.\nUn échec doit répondre un échec : c'est la seule façon qu'un retry existe.");

  add('C1b', 'C', 'À TRAITER', `Catch muets anodins (${anodins.length})`, anodins,
    "Autour d'un JSON.parse ou d'un localStorage, tolérable. Vérifier qu'aucun n'entoure en réalité un appel utile.");
}

// C2 · Écriture non attendue (await manquant).
{
  const missing = [];
  const CONSUMED = /(await|return|void|=>|[=:,(\[]|\.\s*push\(|\.\s*map\(|&&|\|\||\?|yield)\s*$/;
  for (const a of active) {
    if (!a.writeCallRe) continue;
    for (const f of live) {
      const re = new RegExp(a.writeCallRe.source, 'g');
      let m;
      while ((m = re.exec(f.txt))) {
        const before = f.txt.slice(Math.max(0, m.index - 120), m.index).trimEnd();
        if (CONSUMED.test(before)) continue;
        missing.push(`${f.rel}:${lineAt(f.txt, m.index)}  ${m[0].slice(0, 40)}… sans await`);
      }
    }
  }
  add('C2', 'C', 'BLOQUANT', `Écritures sans await (${missing.length})`, missing,
    "Une écriture non attendue peut ne jamais s'exécuter, et son erreur ne remonte nulle part. Le front croit avoir écrit, la base est vide.");
}

// C3 · Lecture qui balaie toute la table.
{
  const scans = [];
  for (const a of active) {
    if (!a.scanRe) continue;
    for (const f of live) {
      const re = new RegExp(a.scanRe.source, 'g');
      let m;
      while ((m = re.exec(f.txt))) if (a.scanBad(m[2])) scans.push(`${f.rel}:${lineAt(f.txt, m.index)}  « ${m[1]} » filtrée sans index`);
    }
  }
  // Générique SQL/ORM : findMany / select sans where ni limit.
  for (const f of live) {
    for (const m of f.txt.matchAll(/\.findMany\(\s*\)|\.findMany\(\s*\{\s*\}\s*\)/g)) scans.push(`${f.rel}:${lineAt(f.txt, m.index)}  findMany() sans filtre ni limite`);
    for (const m of f.txt.matchAll(/\.select\(\s*["'`]\*["'`]\s*\)(?![\s\S]{0,120}(\.eq\(|\.limit\(|\.range\(|\.filter\())/g)) scans.push(`${f.rel}:${lineAt(f.txt, m.index)}  select('*') sans filtre ni limite`);
    // Drizzle : db.select().from(x) sans .where ni .limit dans la même chaîne. Cette
    // forme n'était écrite nulle part : D10 passait inaperçu deux fois sur le banc.
    for (const m of f.txt.matchAll(/\.select\(\s*(?:\{[\s\S]{0,300}?\})?\s*\)\s*\.from\(\s*(\w+)\s*\)(?![\s\S]{0,160}?\.(where|limit|offset)\()/g))
      scans.push(`${f.rel}:${lineAt(f.txt, m.index)}  db.select().from(${m[1]}) sans filtre ni limite`);
  }
  add('C3', 'C', 'À TRAITER', `Lectures non bornées (${scans.length})`, scans,
    "Lit toute la table à chaque appel. Invisible sur 50 lignes de démo, fatal à 50 000 chez le client, et toujours découvert en prod.");
}

// C4 · Temps lu dans une lecture réactive.
{
  const stale = units.filter((u) => u.adapter.staleTimeKinds && u.adapter.staleTimeKinds.test(u.kind) && /Date\.now\(\)|new Date\(\)/.test(u.body))
    .map((u) => `${u.label}  (${u.file}:${u.line})`);
  add('C4', 'C', 'À TRAITER', `Temps lu dans une query réactive (${stale.length})`, stale,
    "Une query réactive n'est pas ré-exécutée quand l'heure change : « aujourd'hui » reste figé au premier abonnement. Passer la date en argument, ou la matérialiser par une tâche planifiée.");
}

// C5 · Appel externe sans filet.
{
  const naked = [];
  for (const f of live) {
    for (const m of f.txt.matchAll(/(?:await\s+)?fetch\s*\(|axios\.(get|post|put|patch|delete)\s*\(/g)) {
      // Une URL relative vise notre propre serveur : ce n'est pas un tiers qui tombe, et
      // le reprocher comme « appel externe » est un faux positif. Mesuré : 3 sur les bancs.
      if (/^\s*["'`]\//.test(f.txt.slice(m.index + m[0].length, m.index + m[0].length + 8))) continue;
      const around = f.txt.slice(Math.max(0, m.index - 700), m.index + 900);
      // Une chaîne de promesses protège autant qu'un try/catch : fetch(...).catch(...)
      // n'est pas un appel nu, et le signaler use la confiance pour rien.
      if (/try\s*\{/.test(around)) continue;
      const apres = f.txt.slice(m.index, m.index + 400);
      if (/\.\s*(catch|finally)\s*\(/.test(apres)) continue;
      naked.push(`${f.rel}:${lineAt(f.txt, m.index)}  appel externe sans filet`);
    }
  }
  add('C5', 'C', 'À TRAITER', `Appels externes sans filet (${naked.length})`, naked,
    "Toute API tierce tombe un jour. Sans try/catch, trace et statut visible, la panne se manifeste comme « le module ne marche plus », sans aucune piste.");
}

// C6 · Collecte non bornée (spécifique stack).
{
  const bombs = [];
  for (const a of active) {
    if (!a.unboundedReadRe) continue;
    for (const f of live) {
      const re = new RegExp(a.unboundedReadRe.source, 'g');
      let m;
      while ((m = re.exec(f.txt))) if (!a.unboundedOk.test(m[2])) bombs.push(`${f.rel}:${lineAt(f.txt, m.index)}  collecte de « ${m[1] } » sans index ni limite`);
    }
  }
  add('C6', 'C', 'À TRAITER', `Collectes non bornées (${bombs.length})`, bombs,
    "Charge toute la table en mémoire à chaque appel. Le jour où le client a du volume, la fonction dépasse la limite et l'écran meurt.");
}

// C7 · Entrée rejouable sans idempotence.
{
  const risky = [];
  for (const u of units) {
    const isHook = /webhook|callback|hook|stripe|clerk|ical|notify|ingest/i.test(u.label + u.file);
    if (!isHook) continue;
    // Une lecture ne peut pas créer de doublon : une query, même nommée « stripe », n'est
    // pas une entrée rejouable. Faux positif vu sur un projet public inconnu
    // (users.getUsersStripeConnectId classé C7). Même chose pour le GET d'un webhook :
    // c'est la poignée de main du fournisseur (hub.challenge), pas une livraison.
    if (/query/i.test(String(u.kind))) continue;
    if (u.kind === 'route' && /^(GET|HEAD|OPTIONS)$/.test(u.name)) continue;
    // Une route ou un httpAction reçoit vraiment des livraisons de l'extérieur : le nom
    // suffit. Une mutation Convex, elle, n'est « rejouable » que si elle CRÉE quelque
    // chose (un patch du même champ est idempotent par nature) : on exige une création,
    // directe ou déléguée, dans son corps.
    const recoitDeLExterieur = u.kind === 'route' || u.kind === 'httpAction' || u.kind === 'server-action';
    if (!recoitDeLExterieur && !/\.insert\s*\(|\.create(?:Many)?\s*\(|runMutation\s*\(|fetchMutation\s*\(|scheduler\.run(?:After|At)\s*\(|\.upsert\s*\(|INSERT\s+INTO/i.test(u.body)) continue;
    if (/idempot|upsert|existing|dedup|alreadyProcessed|eventId|by_event|unique/i.test(u.body)) continue;
    risky.push(`${u.label}  (${u.file}:${u.line})`);
  }
  add('C7', 'C', 'BLOQUANT', `Entrées rejouables sans idempotence (${risky.length})`, risky,
    "La livraison at-least-once est la norme de tous les fournisseurs de webhooks : les doublons sont une certitude, pas un risque. Sans clé d'idempotence stockée, on n'obtient pas une erreur, on obtient des doublons silencieux qui faussent tous les chiffres en aval.");
}

// La fonction englobante d'un endroit : la DERNIÈRE déclaration `export const` avant lui.
const nomFonctionEnglobante = (txt, index) => {
  const avant = txt.slice(0, index);
  const i = avant.lastIndexOf('export const ');
  return i === -1 ? '' : ((avant.slice(i).match(/^export const (\w+)/) || [])[1] || '');
};

// C8 · Un total calculé sur un échantillon.
// Le client lit « 37 rendez-vous ce mois » ; c'est le nombre de rendez-vous parmi les 50
// premières lignes ramenées. Le chiffre a l'air vrai, il est borné par la page.
// LISTE NÉGATIVE : jamais sur .take(1) ni .take(2) (une recherche, pas un échantillon) ;
// jamais quand la borne vient d'un argument (args.limit : la page est demandée, le compte
// qui suit décrit la page, c'est assumé) ; jamais si le résultat de l'agrégat ne sort pas
// sous un nom de total (un `.length` pour tester « y a-t-il quelque chose » est légitime).
{
  const items = [];
  // Des MOTS entiers du nom (casse chameau découpée), jamais une sous-chaîne : « maxDuration »
  // contient « ratio » et n'est pas un total (2 faux positifs sur 2 sur un dépôt réel).
  const MOTS_TOTAL = new Set(['total', 'totaux', 'count', 'compte', 'nombre', 'somme', 'sum', 'nb', 'montant', 'amount', 'ca', 'revenue', 'revenu', 'chiffre', 'taux', 'rate', 'ratio', 'pct', 'pourcentage', 'moyenne', 'avg', 'average', 'stat', 'stats', 'kpi', 'metric', 'metrics', 'score']);
  const motsDe = (nom) => String(nom || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+|\s+/).filter(Boolean).map((w) => w.toLowerCase());
  const TOTAL = { test: (nom) => motsDe(nom).some((w) => MOTS_TOTAL.has(w)) };
  const backend = live.filter((f) => /^(convex|server|src\/server|app\/api|src\/app\/api|lib|src\/lib)\//.test(f.rel) && /\.(ts|js|mjs)$/.test(f.rel) && !/\.test\.|_generated|schema\.ts$/.test(f.rel));
  for (const f of backend) {
    for (const m of f.txt.matchAll(/\.take\(\s*(\d+)\s*\)|\.slice\(\s*0\s*,\s*(\d+)\s*\)/g)) {
      const n = Number(m[1] || m[2]);
      if (!(n >= 3)) continue;
      // Le nom de la variable qui reçoit l'échantillon, dans la même instruction.
      const debutInstr = Math.max(f.txt.lastIndexOf(';', m.index), f.txt.lastIndexOf('\n\n', m.index), 0);
      const instr = f.txt.slice(debutInstr, m.index);
      const recoit = instr.match(/(?:const|let|var)\s+(\w+)\s*(?::[^=]{0,80})?=\s*[\s\S]*$/);
      const finFn = (() => { const k = f.txt.indexOf('\nexport const', m.index + 1); return k === -1 ? Math.min(f.txt.length, m.index + 2500) : Math.min(k, m.index + 2500); })();
      const suite = f.txt.slice(m.index, finFn);
      let agregat = null;
      // a) enchaîné directement : (await ….take(50)).length / .reduce(
      const direct = suite.match(/^\.(?:take|slice)\([^)]*\)\)?(?:\s*\.filter\([^)]*\))?\s*\.(reduce|length)\b/);
      if (direct) agregat = { ou: m.index, quoi: direct[1], nom: (recoit || [])[1] || null };
      // b) via la variable : X.reduce( / X.length / X.filter(…).length
      if (!agregat && recoit) {
        const X = recoit[1];
        const re = new RegExp(`\\b${X}(?:\\.filter\\([^)]*\\))?\\.(reduce|length)\\b`, 'g');
        const u = re.exec(suite.slice(m[0].length));
        if (u) {
          const at = m.index + m[0].length + u.index;
          const ligne = f.txt.slice(f.txt.lastIndexOf('\n', at) + 1, f.txt.indexOf('\n', at));
          const cible = ligne.match(/(?:const|let|var)\s+(\w+)\s*=|(\w+)\s*:\s*[^,]*$|return\b/);
          const nom = cible ? (cible[1] || cible[2] || null) : null;
          agregat = { ou: at, quoi: u[1], nom, retour: !!(cible && !cible[1] && !cible[2]) };
        }
      }
      // b') La lecture bornée est FILTRÉE ou TRIÉE en mémoire juste après : le filtre ne
      //     porte que sur les N premières lignes ramenées, et ce qu'on affiche ou compte
      //     ensuite est un sous-ensemble de l'échantillon, pas le résultat du filtre.
      //     C'est la forme la plus fréquente de l'agrégat partiel dans nos dépôts : les
      //     cas plantés à l'aveugle étaient 8 fois sur 8 de cette forme, jamais un
      //     `.length` nommé « total ».
      if (!agregat) {
        //     Seulement sur .take(n), une lecture de base : un .slice(0, n) porte aussi bien
        //     sur une chaîne ou un tableau en mémoire (3 faux sur 3 dans des routes d'API).
        if (m[1]) {
          const direct = suite.match(/^\.take\([^)]*\)\)?\s*\.(filter|sort)\(/);
          const viaVar = recoit && new RegExp(`\\b${recoit[1]}\\.(filter|sort)\\(`).test(suite.slice(m[0].length, m[0].length + 600));
          if (direct || viaVar) {
            const quoi = (direct ? direct[1] : 'filter') === 'sort' ? 'triée' : 'filtrée';
            items.push(`${f.rel}:${lineAt(f.txt, m.index)}  lecture bornée à ${n} lignes (.take(${n})) puis ${quoi} en mémoire : le résultat porte sur les ${n} premières lignes, pas sur l'ensemble`);
          }
        }
        continue;
      }
      // Le résultat sort-il sous un nom de total ? Sinon, le décompte est un simple test.
      const fnNom = nomFonctionEnglobante(f.txt, m.index);
      const porteur = agregat.nom || (agregat.retour ? fnNom : '');
      if (!TOTAL.test(porteur) && !(agregat.retour && TOTAL.test(fnNom))) continue;
      items.push(`${f.rel}:${lineAt(f.txt, m.index)}  « ${porteur || fnNom} » est un ${agregat.quoi === 'length' ? 'décompte' : 'agrégat'} calculé sur les ${n} premières lignes (.${m[1] ? 'take' : 'slice'}(${n})), pas sur l'ensemble`);
    }
  }
  add('C8', 'C', 'BLOQUANT', `Totaux calculés sur un échantillon (${items.length})`, items,
    "La lecture est bornée à N lignes, puis comptée ou sommée, et le résultat sort sous un nom de total. Le client lit un chiffre plausible qui est en réalité « parmi les N premières ». Il ne bougera jamais au-delà de N, et personne ne le remarque tant que le volume est petit.\nRègle : un total se calcule sur la population entière (ou par un compteur matérialisé), jamais sur la page ramenée pour l'affichage.");
}

// C9 · Le nom désigne le plus récent, la requête ne trie pas.
// `.first()` sur un index rend la PREMIÈRE ligne dans l'ordre de l'index, c'est-à-dire la
// plus ancienne. Si ce qu'on en fait s'appelle « dernier », « latest », « récent », l'écran
// montre la plus vieille valeur sous l'étiquette de la plus fraîche.
// LISTE NÉGATIVE (97 % de faux positifs si on signale tout .first() sans tri) : on exige
// un libellé de récence à portée de l'appel ; jamais sur .unique() (une seule ligne
// possible) ; jamais sur une recherche par _id ; jamais quand le libellé est un nom de
// champ sans rapport (lastName, currentUser…).
{
  const items = [];
  // Des mots de RÉCENCE seulement (pas « current / actuel » : « la connexion en vigueur »
  // n'est pas un tri, et une table à une ligne par espace se lit légitimement en .first()).
  const MOTS_RECENCE = 'dernier|derni[eè]re?s?|latest|last|newest|mostRecent|plusRecent|recent|récent|récente';
  const RECENCE = new RegExp(`\\b(${MOTS_RECENCE})\\w*`, 'i');
  const SANS_RAPPORT = /^(lastName|lastname|last_name|lastIndex|lastIndexOf)$/i;
  const backend = live.filter((f) => /^(convex|server|src\/server|app\/api|src\/app\/api)\//.test(f.rel) && /\.(ts|js|mjs)$/.test(f.rel) && !/\.test\.|_generated|schema\.ts$/.test(f.rel));
  for (const f of backend) {
    for (const m of f.txt.matchAll(/\.query\(\s*["'`](\w+)["'`]\s*\)/g)) {
      // La chaîne : jusqu'au point-virgule hors parenthèses, ou à la ligne vide.
      let prof = 0, fin = m.index;
      for (let k = m.index; k < Math.min(f.txt.length, m.index + 1200); k++) {
        const c = f.txt[k];
        if (c === '(' || c === '{' || c === '[') prof++;
        else if (c === ')' || c === '}' || c === ']') { prof--; if (prof < 0) { fin = k; break; } }
        else if ((c === ';' && prof <= 0) || (c === '\n' && f.txt[k + 1] === '\n')) { fin = k; break; }
        fin = k;
      }
      const chaine = f.txt.slice(m.index, fin);
      // .first(), ou .take(n) : « les 3 dernières recherches » sans tri rend les 3 plus vieilles.
      if (!/\.first\(\)|\.take\(/.test(chaine)) continue;
      if (/\.order\(|\.unique\(\)|by_id|"_id"|\.paginate\(/.test(chaine)) continue;
      // Une lecture par CLÉ (key, slug, provider, email…) est une recherche d'une ligne
      // unique : « le dernier appel » dans le commentaire parle de ce qu'on y écrit, pas de
      // l'ordre de lecture. Seuls les filtres par identifiant parent ou par catégorie
      // laissent plusieurs lignes candidates, donc un ordre qui compte.
      const eqs = [...chaine.matchAll(/\.eq\(\s*(?:q\.field\()?["'`](\w+)["'`]/g)].map((x) => x[1]);
      if (eqs.some((c) => !/Id$|^(status|statut|state|etat|type|kind|genre|categorie|category|clerkUserId|orgId|workspaceId|tenantId)$/i.test(c))) continue;
      // Le libellé doit porter sur le RÉSULTAT de la lecture, pas traîner dans le voisinage :
      // un `patch(conn._id, { lastSyncAt: now })` deux lignes plus bas ne dit rien de l'ordre
      // de lecture (16 faux positifs sur 16 au premier essai sur un dépôt réel). On accepte :
      // le nom de la variable qui reçoit la lecture, le nom de la fonction, une clé ou une
      // variable qui reçoit cette variable (`latestViews: m[0]`), ou le commentaire juste
      // au-dessus de la lecture.
      const debutInstr = Math.max(f.txt.lastIndexOf(';', m.index), f.txt.lastIndexOf('\n\n', m.index), 0);
      const instr = f.txt.slice(debutInstr, m.index);
      const X = (instr.match(/(?:const|let|var)\s+(\w+)\s*(?::[^=]{0,80})?=\s*[\s\S]*$/) || [])[1] || null;
      const fnNom = nomFonctionEnglobante(f.txt, m.index);
      const apres = f.txt.slice(fin, Math.min(f.txt.length, fin + 400));
      // Le dernier commentaire de l'instruction (« // Latest metrics » au-dessus de la lecture).
      const commentaires = [...instr.matchAll(/\/\/([^\n]*)|\/\*([\s\S]{0,200}?)\*\//g)];
      const commentaire = commentaires.length ? (commentaires[commentaires.length - 1][1] || commentaires[commentaires.length - 1][2] || '') : '';
      let mot = null;
      const ok = (w) => w && RECENCE.test(w) && !SANS_RAPPORT.test(w);
      if (ok(X)) mot = X;
      else if (ok(fnNom)) mot = fnNom;
      else if (X) {
        const r = apres.match(new RegExp(`(\\w*(?:${MOTS_RECENCE})\\w*)\\s*[:=]\\s*(?:await\\s+)?${X}\\b`, 'i'));
        if (r && ok(r[1])) mot = r[1];
      }
      if (!mot && commentaire) { const r = commentaire.match(RECENCE); if (r && ok(r[0])) mot = r[0]; }
      // Une constante en capitales (LAST_REQUIRED_STEP_INDEX) ou un champ d'horodatage écrit
      // (lastErrorMessage, lastSyncAt) n'étiquettent pas le résultat de la lecture.
      if (mot && (/^[A-Z0-9_]+$/.test(mot) || /(At|Le|Date|Time|Message|Error|Sync|Seen)$/.test(mot))) mot = null;
      if (!mot) continue;
      const prise = (chaine.match(/\.(first\(\)|take\([^)]*\))/) || [])[1] || 'first()';
      items.push(`${f.rel}:${lineAt(f.txt, m.index)}  « ${mot} » : .${prise} sur « ${m[1]} » sans .order("desc") rend la plus ANCIENNE ligne`);
    }
  }
  add('C9', 'C', 'BLOQUANT', `Le nom dit « le plus récent », la requête ne trie pas (${items.length})`, items,
    "Sans .order(\"desc\"), .first() rend la première ligne de l'index : la plus ancienne. L'écran affiche donc la plus vieille valeur sous l'étiquette « dernière », et la donnée semble ne jamais bouger.\nRègle : tout .first() qui prétend au plus récent porte un .order(\"desc\") explicite sur un index qui trie par date.");
}

/* ══════ AXE D — SURFACES FANTÔMES (l'écran qui n'a pas de source) ════════ */

{
  const { default: reglesSurfaces } = await import(pathToFileURL(path.join(HERE, 'rules-surfaces.mjs')).href);
  for (const [id, axe, gravite, titre, items, detail] of reglesSurfaces({ files: live, lineAt })) {
    add(id, axe, gravite, titre, items, detail);
  }
}

/* ═════ AXE E — LES PIÈGES QU'ON A DÉJÀ PAYÉS (tirés de nos incidents) ════ */

{
  const { default: reglesHistorique } = await import(pathToFileURL(path.join(HERE, 'rules-historique.mjs')).href);
  for (const [id, axe, gravite, titre, items, detail] of reglesHistorique({
    files: live, lineAt, read: ctx.read, exists: ctx.exists,
  })) add(id, axe, gravite, titre, items, detail);
}

/* ════ AXE F — CONTRATS D'APPEL : confronter les deux côtés d'un lien ═════ */

{
  const { default: reglesContrats } = await import(pathToFileURL(path.join(HERE, 'rules-contrats.mjs')).href);
  for (const [id, axe, gravite, titre, items, detail] of reglesContrats({ files: live, lineAt, root: ROOT })) {
    add(id, axe, gravite, titre, items, detail);
  }
}

/* ═══ AXE G — L'AUTHENTIFICATION QUI NE PROTÈGE RIEN (règles officielles) ═══ */

{
  const { default: reglesAuth } = await import(pathToFileURL(path.join(HERE, 'rules-auth.mjs')).href);
  for (const [id, axe, gravite, titre, items, detail] of reglesAuth({
    files: live, lineAt, exists: ctx.exists, read: ctx.read, gardes: GARDES.gardes, estGardee,
  })) add(id, axe, gravite, titre, items, detail);
}

/* ═════ AXE H — COHÉRENCE : le défaut vit dans l'écart entre deux lignes ═══ */

{
  const { default: reglesCoherence } = await import(pathToFileURL(path.join(HERE, 'rules-coherence.mjs')).href);
  for (const [id, axe, gravite, titre, items, detail] of reglesCoherence({ files: live, lineAt })) {
    add(id, axe, gravite, titre, items, detail);
  }
}

/* ═══ AXE I — RAYON D'ACTION : ce qui coûte l'entreprise, pas des jours ════ */

{
  const { default: reglesRayon } = await import(pathToFileURL(path.join(HERE, 'rules-rayon.mjs')).href);
  for (const [id, axe, gravite, titre, items, detail] of reglesRayon({
    files: live, lineAt, read: ctx.read, exists: ctx.exists, root: ROOT,
  })) add(id, axe, gravite, titre, items, detail);
}

/* ───────────────────────────────── Rapport ──────────────────────────────── */

const bloquants = findings.filter((f) => f.gravite === 'BLOQUANT');
process.exitCode = bloquants.length ? 1 : 0; // jamais process.exit() : tronque un gros stdout

if (AS_JSON) {
  process.stdout.write(JSON.stringify({
    root: ROOT, stacks: active.map((a) => a.name), units: units.length, entities: entities.length,
    incomprehensions, findings,
  }, null, 2) + '\n');
} else {
  const CAP = FULL ? 1e9 : 12;
  const axes = { A: 'CÂBLAGE — les liens perdus', B: "PORTES — contrat d'entrée et accès", C: 'SILENCE — ce qui casse sans bruit', D: "SURFACES FANTÔMES — l'écran sans source", E: "DÉJÀ PAYÉS — nos incidents passés", F: "CONTRATS — les deux côtés d'un lien", G: "AUTHENTIFICATION — les gardes qui ne gardent rien", H: "COHÉRENCE — deux endroits qui se contredisent", I: "RAYON D'ACTION — ce qui détruit pour de bon" };

  console.log(`\n╔══ AUDIT BACKEND ─ ${path.basename(ROOT)}`);
  console.log(`║  stack : ${active.map((a) => a.name).join(' + ')}`);
  console.log(`║  ${units.length} unités exposées · ${entities.length} entités de données · ${live.length} fichiers`);
  for (const t of incomprehensions) console.log(`║  ⚠️  ${t}`);
  console.log(`╚══ ${bloquants.length} défaut(s) BLOQUANT(S) · ${findings.length - bloquants.length} à traiter\n`);

  for (const axe of ['I', 'H', 'G', 'F', 'A', 'B', 'C', 'D', 'E']) {
    const list = findings.filter((f) => f.axe === axe);
    if (!list.length) continue;
    console.log(`\n━━━ ${axes[axe]} ━━━`);
    for (const f of list.sort((a, b) => (a.gravite === 'BLOQUANT' ? -1 : 1))) {
      console.log(`\n[${f.id}] ${f.gravite} · ${f.titre}`);
      console.log(f.detail.split('\n').map((l) => '     ' + l).join('\n'));
      for (const it of f.items.slice(0, CAP)) console.log(`       • ${it}`);
      if (f.items.length > CAP) console.log(`       … ${f.items.length - CAP} autres (relancer avec --full)`);
    }
  }
  console.log(`\n${bloquants.length ? '⚠️  Défauts bloquants présents : ne pas déclarer livrable.' : '✓ Aucun défaut bloquant.'}\n`);
}
