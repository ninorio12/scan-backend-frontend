#!/usr/bin/env node
/**
 * flux.mjs — Analyse de flux de données par AST. Le vrai moteur.
 *
 * POURQUOI IL REMPLACE LES EXPRESSIONS RÉGULIÈRES
 *
 * Tous les autres détecteurs lisent le code comme du texte. Ils confondent le « > » d'une
 * fonction fléchée avec la fin d'une balise, ne savent pas qu'un bouton appelle une
 * fonction qui appelle une mutation, et ne peuvent pas dire d'où vient la valeur qu'un
 * champ affiche. Chaque faux positif use la confiance, et un outil auquel on ne croit
 * plus n'est jamais relancé.
 *
 * Celui-ci parse le code avec le compilateur TypeScript du projet lui-même (aucune
 * dépendance à installer : tout projet TS en a un) et fait ce que la sécurité appelle
 * une ANALYSE DE TEINTE, à l'envers.
 *
 *   En sécurité : on suit une donnée non fiable depuis sa SOURCE jusqu'à un PUITS
 *   dangereux, et on alerte si elle y arrive sans avoir été nettoyée.
 *
 *   Ici, exactement le miroir : les SOURCES sont les vraies lectures de données
 *   (useQuery, fetch, la session…), les PUITS sont les endroits où le produit affiche
 *   quelque chose à l'utilisateur, et on alerte quand un puits N'EST PAS alimenté par
 *   une source. On ne cherche pas la donnée sale qui arrive au mauvais endroit : on
 *   cherche l'endroit d'affichage que rien n'alimente.
 *
 * La teinte se propage par affectation, déstructuration, appel de fonction locale,
 * ternaire, template, .map() — calculée par points fixes jusqu'à stabilité.
 *
 *   node flux.mjs <repo>                → chaque affichage, et d'où il vient
 *   node flux.mjs <repo> --divergences  → la même donnée affichée depuis deux sources
 *   node flux.mjs <repo> --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const FLAGS = process.argv.slice(2).filter((a) => a.startsWith('--'));
const AS_JSON = FLAGS.includes('--json');
const SEUL_DIVERGENCES = FLAGS.includes('--divergences');
const FULL = FLAGS.includes('--full');

/* ── Le compilateur du projet audité ─────────────────────────────────────── */

let ts;
try {
  ts = createRequire(path.join(ROOT, 'package.json'))('typescript');
} catch {
  try { ts = createRequire(import.meta.url)('typescript'); } catch {
    console.error(`TypeScript introuvable dans ${ROOT}/node_modules ni globalement.`);
    console.error(`Lancer « npm install » dans le projet, ou utiliser inventaire.mjs (analyse textuelle, moins précise).`);
    process.exit(2);
  }
}

/* ── Fichiers ────────────────────────────────────────────────────────────── */

const IGNORED = new Set(['node_modules', '_generated', '.next', '.git', 'dist', 'build', '.vercel', 'coverage', 'out']);
const LEGACY = /(^|\/)(_?legacy|archive|old|backup|deprecated)\//i;

function walk(dir, out = []) {
  let e;
  try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const x of e) {
    if (IGNORED.has(x.name) || x.name.startsWith('.')) continue;
    const p = path.join(dir, x.name);
    if (x.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(x.name)) out.push(p);
  }
  return out;
}

const fichiers = walk(ROOT)
  .map((p) => path.relative(ROOT, p).split(path.sep).join('/'))
  .filter((r) => !LEGACY.test(r) && !/\.(test|spec|stories)\./.test(r));

/* ── Ce qui compte comme SOURCE de données réelles ───────────────────────── */

const SOURCES = /^(useQuery|usePaginatedQuery|useSuspenseQuery|useSWR|useSWRInfinite|useFetch|useSession|useUser|useAuth|useOrganization|usePreloadedQuery|useLiveQuery|useForm|useFormState|useSearchParams|useParams|usePathname|fetch|preloadQuery)$/;
const SOURCES_MEMBRE = /^(prisma|supabase|db|sql|api|convex)$/;

/* ── Analyse d'un fichier ────────────────────────────────────────────────── */

const resultats = [];
const affichages = [];       // chaque puits, avec sa provenance
const erreursParse = [];

// Pour distinguer « Jean Dupont » (une personne) de « Nouvelle Activité » (un
// libellé) : seule la première apparaît ailleurs derrière une clé d'identité.
const CORPUS = fichiers.map((r) => { try { return fs.readFileSync(path.join(ROOT, r), 'utf8'); } catch { return ''; } }).join('\n');
const CLE_IDENTITE = /(nom|name|prenom|firstName|lastName|assigne|auteur|author|owner|utilisateur|user|membre|courtier|agent|responsable|contact|createdBy)\s*[:=]\s*["'`]/i;
function estIdentiteConnue(t) {
  if (!/^[A-ZÀ-Ÿ][\wà-ÿ'-]+(?:\s+[A-ZÀ-Ÿ][\wà-ÿ'-]+)+$/u.test(t)) return false;
  return new RegExp(CLE_IDENTITE.source + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(CORPUS);
}

for (const rel of fichiers) {
  const abs = path.join(ROOT, rel);
  let sf;
  try {
    sf = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch (e) { erreursParse.push(`${rel} : ${e.message}`); continue; }

  // 1. Table des déclarations locales : nom → nœud d'initialisation.
  const decl = new Map();       // nom → { init, node }
  const propsDuComposant = new Set();
  const teintees = new Set();   // noms alimentés par une source
  const origine = new Map();    // nom → texte de la source racine

  const marquerSource = (nom, source) => { teintees.add(nom); if (!origine.has(nom)) origine.set(nom, source); };

  // Déstructuration : const { a, b } = X  →  a et b héritent de X.
  function nomsLies(nameNode, cb) {
    if (ts.isIdentifier(nameNode)) return cb(nameNode.text);
    if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
      for (const el of nameNode.elements) {
        if (ts.isBindingElement(el)) nomsLies(el.name, cb);
      }
    }
  }

  const estAppelSource = (init) => {
    if (!init) return null;
    if (ts.isCallExpression(init)) {
      const e = init.expression;
      if (ts.isIdentifier(e) && SOURCES.test(e.text)) return e.text;
      if (ts.isPropertyAccessExpression(e)) {
        const racine = racineDe(e);
        if (racine && SOURCES_MEMBRE.test(racine)) return e.getText().slice(0, 40);
        if (/^(useQuery|fetch|query|mutation)$/.test(e.name.text)) return e.getText().slice(0, 40);
      }
      if (ts.isAwaitExpression(init.expression)) return 'await';
    }
    if (ts.isAwaitExpression(init)) {
      const inner = init.expression;
      if (ts.isCallExpression(inner)) {
        const racine = ts.isPropertyAccessExpression(inner.expression) ? racineDe(inner.expression) : null;
        if (racine && SOURCES_MEMBRE.test(racine)) return inner.expression.getText().slice(0, 40);
        if (ts.isIdentifier(inner.expression) && SOURCES.test(inner.expression.text)) return inner.expression.text;
      }
      return 'await';
    }
    return null;
  };

  function racineDe(node) {
    let n = node;
    while (ts.isPropertyAccessExpression(n) || ts.isCallExpression(n) || ts.isElementAccessExpression(n)) n = n.expression;
    return ts.isIdentifier(n) ? n.text : null;
  }

  // Parcours : déclarations, paramètres de composant, puis puits JSX.
  const puits = [];

  function visiter(node) {
    // const X = …
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const src = estAppelSource(node.initializer);
      nomsLies(node.name, (nom) => {
        decl.set(nom, node.initializer);
        if (src) marquerSource(nom, src);
      });
    }

    // Paramètres d'un composant : ce sont des props, l'origine est chez le parent.
    if ((ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && node.parameters) {
      for (const p of node.parameters) nomsLies(p.name, (nom) => propsDuComposant.add(nom));
    }

    // Puits : contenu textuel et expressions du JSX.
    if (ts.isJsxText(node)) {
      const t = node.text.trim();
      if (t && estDonneeAffichee(t)) puits.push({ genre: 'texte', expr: t, node });
    }
    if (ts.isJsxExpression(node) && node.expression && node.parent && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // {" "} et consorts : de la mise en forme, pas de la donnée.
      const brut = node.expression.getText().trim();
      const typographie = /^["'`][\s\u00a0·•—–|,:;.]*["'`]$/.test(brut);
      if (!typographie) puits.push({ genre: 'expression', expr: brut.slice(0, 60), node, ex: node.expression });
    }
    if (ts.isJsxAttribute(node) && node.name) {
      const attr = node.name.getText();
      // Un attribut de DONNÉE : un littéral y est toujours suspect.
      // Un attribut de LIBELLÉ (title, label, placeholder) : un littéral y est normal,
      // sauf s'il a la forme d'une donnée (email, téléphone, montant, identité).
      const estDonnee = /^(value|defaultValue|checked|defaultChecked)$/.test(attr);
      const estLibelle = /^(children|label|title|placeholder|alt|aria-label)$/.test(attr);
      if (!estDonnee && !estLibelle) { /* attribut technique : hors sujet */ }
      else {
        const init = node.initializer;
        if (!init) { /* attribut booléen */ }
        else if (ts.isStringLiteral(init)) {
          const t = init.text.trim();
          // « nom@exemple.ch » dans un placeholder est un exemple assumé, pas une donnée.
          const exemple = /exemple|example|ex\.|votre|your|placeholder|xxx|000|123/i.test(t);
          if (t && (estDonnee || (estDonneeAffichee(t) && !exemple))) {
            puits.push({ genre: `attribut ${attr}`, expr: `"${init.text}"`, node, litteral: true });
          }
        } else if (ts.isJsxExpression(init) && init.expression && estDonnee) {
          puits.push({ genre: `attribut ${attr}`, expr: init.expression.getText().slice(0, 60), node, ex: init.expression });
        }
      }
    }

    ts.forEachChild(node, visiter);
  }
  visiter(sf);

  // 2. Propagation de la teinte, par points fixes.
  for (let passe = 0; passe < 6; passe++) {
    let change = false;
    for (const [nom, init] of decl) {
      if (teintees.has(nom) || !init) continue;
      const refs = identifiantsDe(init);
      for (const r of refs) {
        if (teintees.has(r)) { marquerSource(nom, origine.get(r) || r); change = true; break; }
      }
    }
    if (!change) break;
  }

  function identifiantsDe(node) {
    const out = new Set();
    const rec = (n) => {
      if (ts.isIdentifier(n)) out.add(n.text);
      ts.forEachChild(n, rec);
    };
    rec(node);
    return out;
  }

  // 3. Verdict de chaque puits.
  for (const p of puits) {
    const ligne = sf.getLineAndCharacterOfPosition(p.node.getStart()).line + 1;
    if (p.genre === 'texte' || p.litteral) {
      affichages.push({ fichier: rel, ligne, genre: p.genre, valeur: p.expr, verdict: 'en dur', source: null });
      continue;
    }
    const ids = [...identifiantsDe(p.ex)];
    const teinte = ids.find((i) => teintees.has(i));
    const viaProps = ids.find((i) => propsDuComposant.has(i));
    const litteralPur = p.ex && (ts.isStringLiteral(p.ex) || ts.isNumericLiteral(p.ex));
    let verdict = 'non tracé', source = null;
    if (litteralPur) verdict = 'en dur';
    else if (teinte) { verdict = 'relié'; source = origine.get(teinte); }
    else if (viaProps) verdict = 'via props';
    else if (ids.some((i) => decl.has(i))) verdict = 'calcul local';
    affichages.push({ fichier: rel, ligne, genre: p.genre, valeur: p.expr, verdict, source, chemin: cheminDeDonnee(p.expr) });
  }

  resultats.push({ fichier: rel, sources: [...origine.entries()].map(([k, v]) => `${k} ← ${v}`), puits: puits.length });
}

// Une donnée affichée en texte brut : un nombre, un email, un téléphone. Pas un libellé.
function estDonneeAffichee(t) {
  return /^\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d+)?\s*(%|€|\$|CHF|k|M)?$/.test(t) && !/^[01]$/.test(t)
    || /^[\w.+-]+@[\w-]+\.[a-z]{2,}$/i.test(t)
    || /^\+?\d[\d\s().-]{8,}$/.test(t)
    || estIdentiteConnue(t);
}

// « user.prenom » → le nom logique du champ affiché, pour comparer entre écrans.
function cheminDeDonnee(expr) {
  const m = String(expr).match(/\b\w+\.(\w+)(?:\.(\w+))?/);
  return m ? (m[2] || m[1]) : null;
}

/* ── Divergences : la même donnée affichée depuis deux sources différentes ── */

const CHAMPS_IDENTITE = /^(prenom|nom|firstName|lastName|name|email|mail|telephone|phone|societe|company|role|poste|avatar|photo|fullName|displayName)$/i;
const parChamp = new Map();
for (const a of affichages) {
  if (!a.chemin || !CHAMPS_IDENTITE.test(a.chemin)) continue;
  if (!parChamp.has(a.chemin)) parChamp.set(a.chemin, []);
  parChamp.get(a.chemin).push(a);
}
// « via props » et « calcul local » ne sont pas des origines : ce sont des aveux
// d'ignorance. Une divergence ne se déclare qu'entre deux origines réellement connues
// (deux lectures différentes), ou entre une lecture et une valeur écrite en dur.
const divergences = [];
for (const [champ, liste] of parChamp) {
  const connues = new Set(liste.filter((a) => a.verdict === 'relié' && a.source).map((a) => a.source));
  const enDur = liste.filter((a) => a.verdict === 'en dur');
  const motif = connues.size > 1 ? 'deux lectures différentes'
    : (connues.size >= 1 && enDur.length) ? 'une lecture d\'un côté, une valeur en dur de l\'autre'
    : null;
  if (!motif) continue;
  divergences.push({
    champ, motif, sources: [...connues, ...(enDur.length ? ['écrit en dur'] : [])],
    endroits: liste.filter((a) => a.verdict === 'relié' || a.verdict === 'en dur')
      .map((a) => `${a.fichier}:${a.ligne} (${a.source || 'écrit en dur'})`),
  });
}

/* ── Rapport ─────────────────────────────────────────────────────────────── */

const stat = {
  total: affichages.length,
  relies: affichages.filter((a) => a.verdict === 'relié').length,
  enDur: affichages.filter((a) => a.verdict === 'en dur').length,
  viaProps: affichages.filter((a) => a.verdict === 'via props').length,
  calculLocal: affichages.filter((a) => a.verdict === 'calcul local').length,
  nonTrace: affichages.filter((a) => a.verdict === 'non tracé').length,
};

if (AS_JSON) {
  process.stdout.write(JSON.stringify({ root: ROOT, stat, divergences, affichages }, null, 2) + '\n');
  process.exitCode = stat.enDur ? 1 : 0;
} else if (SEUL_DIVERGENCES) {
  console.log(`\n╔══ DIVERGENCES ─ ${path.basename(ROOT)}`);
  console.log(`╚══ ${divergences.length} donnée(s) affichée(s) depuis des origines différentes\n`);
  for (const d of divergences) {
    console.log(`« ${d.champ} » : ${d.motif}`);
    for (const e of d.endroits.slice(0, 10)) console.log(`     • ${e}`);
    console.log();
  }
  console.log(`Deux écrans qui affichent le même champ depuis deux origines finissent toujours`);
  console.log(`par se contredire. Une donnée, une source.\n`);
} else {
  console.log(`\n╔══ FLUX DE DONNÉES ─ ${path.basename(ROOT)}  (AST, TypeScript ${ts.version})`);
  console.log(`║  ${fichiers.length} fichiers d'interface · ${stat.total} affichages analysés`);
  console.log(`╚══ ${stat.relies} reliés à une source · ${stat.enDur} en dur · ${stat.viaProps} via props · ${stat.calculLocal} calcul local · ${stat.nonTrace} non tracés\n`);

  const enDur = affichages.filter((a) => a.verdict === 'en dur');
  console.log(`━━━ AFFICHÉ EN DUR (${enDur.length}) ━━━\n`);
  for (const a of enDur.slice(0, FULL ? 1e9 : 20)) {
    console.log(`  ${a.fichier}:${a.ligne}`);
    console.log(`     ${a.genre} = ${a.valeur}`);
  }
  if (!FULL && enDur.length > 20) console.log(`  … ${enDur.length - 20} autres (--full)`);

  if (divergences.length) {
    console.log(`\n\n━━━ DIVERGENCES (${divergences.length}) ─ même donnée, origines différentes ━━━\n`);
    for (const d of divergences.slice(0, 8)) {
      console.log(`  « ${d.champ} » : ${d.motif} — ${d.sources.join(' / ')}`);
      for (const e of d.endroits.slice(0, 4)) console.log(`       ${e}`);
    }
    console.log(`\n  C'est le défaut que rien d'autre ne voit : deux écrans affichent le même champ`);
    console.log(`  depuis deux origines, et finissent par se contredire.`);
  }

  console.log(`\n\nCe que « non tracé » veut dire : l'expression ne remonte à aucune déclaration locale`);
  console.log(`(import, variable de module, contexte). Ce n'est pas un bug, c'est une limite de`);
  console.log(`l'analyse intra-fichier, et elle se lève en passant dans l'application.\n`);
  process.exitCode = stat.enDur ? 1 : 0;
}
