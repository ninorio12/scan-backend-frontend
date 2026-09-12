#!/usr/bin/env node
/**
 * boucle.mjs — l'orchestrateur : découpe en lots disjoints, ouvre un worktree par
 * lot, impose le bail, et rend un verdict que l'ouvrier ne peut pas écrire.
 *
 * LES QUATRE CONTRAINTES, CHACUNE PAYÉE PAR UN INCIDENT
 *
 * 1. PÉRIMÈTRES DISJOINTS, IMPOSÉS MÉCANIQUEMENT. Deux agents lancés en parallèle
 *    se sont écrasés. La consigne ne suffit pas : chaque lot reçoit son propre
 *    worktree git (donc son propre répertoire de travail) et un bail écrit. À la
 *    sortie, `git diff --name-only` est confronté au bail ; un seul fichier hors
 *    bail révoque le lot ENTIER. Pas de rattrapage partiel : un lot qui a débordé
 *    a pu lire et écrire n'importe quoi, on ne sait plus ce qui est sûr dedans.
 *
 * 2. IDENTITÉ AVANT BOUCLE. Les défauts sont appelés par leur empreinte, jamais par
 *    leur numéro de ligne, que la première correction décale. Voir empreintes.mjs.
 *
 * 3. LE JUGE N'EST JAMAIS L'OUVRIER. L'agent qui corrige ne rend pas le verdict.
 *    Le juge est un contexte FRAIS qui reçoit trois choses et rien d'autre : le
 *    contrat du défaut, le diff, et le résultat des invariants. Il ne voit pas le
 *    raisonnement de l'ouvrier, donc il ne peut pas en hériter la conviction.
 *
 * 4. UN INVARIANT INDÉPENDANT DU SCANNER. Le recompte ne prouve rien puisque
 *    l'ouvrier peut faire taire le scanner. Voir invariants.mjs et diff-garde.mjs.
 *
 *   node boucle.mjs <repo> preparer    → empreintes, frontière, découpe en lots
 *   node boucle.mjs <repo> lots        → les lots, leur bail, leur mode
 *   node boucle.mjs <repo> ouvrir <lot>→ crée le worktree et écrit le bail dedans
 *   node boucle.mjs <repo> juger <lot> → garde + invariants + verdict
 *   node boucle.mjs <repo> fermer <lot>→ retire le worktree (après verdict)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { calculer } from './empreintes.mjs';
import { FRONTIERE, repartir } from './frontiere.mjs';
import { verifierTous } from './invariants.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const RACINE = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const CMD = process.argv[3] || 'preparer';
const NOM_LOT = process.argv[4];
const DOSSIER = path.join(RACINE, '.backend');
const PLAN = path.join(DOSSIER, 'lots.json');
const CHANTIERS = path.join(RACINE, '..', `${path.basename(RACINE)}-chantiers`);

const git = (args, cwd = RACINE) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

/* ── Découpe en lots ───────────────────────────────────────────────────────
   Le FICHIER est l'unité, pas la règle : on ouvre un fichier une fois et on y
   corrige tout. Découper par règle ferait rouvrir vingt fois les mêmes fichiers,
   et surtout ferait se marcher dessus deux agents sur le même fichier.

   Deux fichiers vont dans le même lot quand ils sont liés par une correction
   commune (l'écran et le composant qu'il monte). Sinon, un lot par fichier. */

function decouper(empreintes) {
  const parFichier = new Map();
  for (const e of empreintes) {
    if (!parFichier.has(e.fichier)) parFichier.set(e.fichier, []);
    parFichier.get(e.fichier).push(e);
  }

  const lots = [];
  for (const [fichier, defauts] of parFichier) {
    const modes = new Set(defauts.map((d) => FRONTIERE[d.regle]?.mode || 'inconnu'));
    const bloquants = defauts.filter((d) => d.gravite === 'BLOQUANT').length;
    // Un lot purement mécanique se traite sans agent : il porte le nom de son codemod.
    const codemods = [...new Set(defauts.map((d) => FRONTIERE[d.regle]?.codemod).filter(Boolean))];
    lots.push({
      nom: fichier.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 60),
      bail: { lot: fichier, fichiers: [fichier] },
      fichier,
      mode: modes.size === 1 ? [...modes][0] : 'mixte',
      codemods,
      bloquants,
      defauts: defauts.map((d) => ({ id: d.id, regle: d.regle, gravite: d.gravite, item: d.item, ancre: d.ancre })),
      instables: defauts.filter((d) => !d.stable).length,
    });
  }

  /* L'ordre : ce qui fait le plus de dégâts chez le client d'abord, et le
     mécanique avant l'agent à gravité égale (il coûte trois secondes et réduit la
     surface que l'agent devra lire). */
  const RANG = { humain: 0, mecanique: 1, mixte: 2, agent: 3, inconnu: 4 };
  lots.sort((a, b) => b.bloquants - a.bloquants || RANG[a.mode] - RANG[b.mode]);
  return lots;
}

/* ── Commandes ─────────────────────────────────────────────────────────────── */

if (CMD === 'preparer') {
  const res = calculer(RACINE);
  const lots = decouper(res.empreintes);
  const par = repartir(res.empreintes);
  fs.mkdirSync(DOSSIER, { recursive: true });
  fs.writeFileSync(path.join(DOSSIER, 'empreintes.json'), JSON.stringify(res, null, 2) + '\n');
  fs.writeFileSync(PLAN, JSON.stringify({ date: res.date, base: safeHead(), lots }, null, 2) + '\n');

  console.log(`\n╔══ CHANTIER ─ ${path.basename(RACINE)}`);
  console.log(`║  ${res.empreintes.length} défauts identifiés · ${lots.length} lots disjoints`);
  console.log(`║  ${par.mecanique.length} mécaniques · ${par.agent.length} pour un agent · ${par.humain.length} pour un humain`);
  const instables = res.empreintes.filter((e) => !e.stable).length;
  if (instables) console.log(`║  ⚠️  ${instables} défauts sans identité stable : à traiter seuls, jamais en parallèle d'un autre du même fichier`);
  console.log(`╚══ plan : ${path.relative(RACINE, PLAN)}\n`);
  console.log(`Ouvrir le premier lot : node boucle.mjs ${RACINE} ouvrir ${lots[0]?.nom}\n`);
}

function safeHead() { try { return git(['rev-parse', 'HEAD']); } catch { return null; } }
function lirePlan() {
  if (!fs.existsSync(PLAN)) { console.error(`Pas de plan. Lancer : node boucle.mjs ${RACINE} preparer`); process.exit(2); }
  return JSON.parse(fs.readFileSync(PLAN, 'utf8'));
}

if (CMD === 'lots') {
  const { lots } = lirePlan();
  console.log(`\n${lots.length} lots, dans l'ordre où les traiter :\n`);
  for (const [i, l] of lots.slice(0, 25).entries()) {
    console.log(`  ${String(i + 1).padStart(3)}. ${l.mode.padEnd(10)} ${String(l.bloquants).padStart(3)} bloq  ${l.fichier}`);
    console.log(`       ${l.defauts.length} défaut(s) : ${[...new Set(l.defauts.map((d) => d.regle))].join(' ')}${l.codemods.length ? `   codemods : ${l.codemods.join(', ')}` : ''}`);
  }
  if (lots.length > 25) console.log(`\n  … ${lots.length - 25} autres.`);
  console.log();
}

if (CMD === 'ouvrir') {
  const { lots, base } = lirePlan();
  const lot = lots.find((l) => l.nom === NOM_LOT || l.fichier === NOM_LOT);
  if (!lot) { console.error(`Lot inconnu : ${NOM_LOT}`); process.exit(2); }

  fs.mkdirSync(CHANTIERS, { recursive: true });
  const chantier = path.join(CHANTIERS, lot.nom);
  if (fs.existsSync(chantier)) { console.error(`Le chantier ${chantier} existe déjà : le fermer d'abord.`); process.exit(2); }

  /* Le worktree EST le périmètre : deux lots ouverts en parallèle ne partagent
     aucun fichier sur le disque. C'est la seule façon d'empêcher mécaniquement
     deux agents de s'écraser ; une consigne ne l'empêche pas. */
  git(['worktree', 'add', '--detach', chantier, base || 'HEAD']);
  const bail = { ...lot.bail, ouvertLe: new Date().toISOString(), base: base || 'HEAD' };
  fs.writeFileSync(path.join(chantier, 'bail.json'), JSON.stringify(bail, null, 2) + '\n');
  fs.writeFileSync(path.join(chantier, 'contrat.json'), JSON.stringify({ lot: lot.nom, defauts: lot.defauts, invariants: [] }, null, 2) + '\n');

  console.log(`\n╔══ LOT OUVERT ─ ${lot.nom}`);
  console.log(`║  chantier : ${chantier}`);
  console.log(`║  bail     : ${lot.bail.fichiers.join(', ')}`);
  console.log(`║  mode     : ${lot.mode}${lot.codemods.length ? `   codemods : ${lot.codemods.join(', ')}` : ''}`);
  console.log(`╚══ ${lot.defauts.length} défaut(s)\n`);
  for (const d of lot.defauts) console.log(`  [${d.regle}] ${d.id}  ${d.item.slice(0, 90)}`);
  console.log(`\n  Compléter contrat.json avec les invariants du défaut, PUIS lancer l'ouvrier.`);
  console.log(`  Juger : node boucle.mjs ${RACINE} juger ${lot.nom}\n`);
}

if (CMD === 'juger') {
  const { lots } = lirePlan();
  const lot = lots.find((l) => l.nom === NOM_LOT || l.fichier === NOM_LOT);
  if (!lot) { console.error(`Lot inconnu : ${NOM_LOT}`); process.exit(2); }
  const chantier = path.join(CHANTIERS, lot.nom);
  if (!fs.existsSync(chantier)) { console.error(`Chantier absent : ${chantier}`); process.exit(2); }

  const bail = path.join(chantier, 'bail.json');
  const contrat = JSON.parse(fs.readFileSync(path.join(chantier, 'contrat.json'), 'utf8'));

  /* 1. Le garde. En premier : un lot hors bail est révoqué avant toute mesure. */
  let garde = { code: 0, sortie: '' };
  try {
    garde.sortie = execFileSync('node', [path.join(ICI, 'diff-garde.mjs'), chantier, '--bail', bail, '--json'],
      { encoding: 'utf8' });
  } catch (e) { garde.code = e.status; garde.sortie = e.stdout || ''; }
  const g = JSON.parse(garde.sortie || '{}');

  /* 2. Les invariants. Ils ne demandent rien au scanner. */
  const inv = contrat.invariants?.length ? verifierTous(chantier, contrat.invariants) : { ok: false, resultats: [] };

  const verdict = {
    lot: lot.nom,
    horsBail: (g.violations || []).filter((v) => v.regle === 'hors-bail').length,
    triches: (g.violations || []).filter((v) => v.regle !== 'hors-bail'),
    fichiersTouches: g.fichiers || [],
    invariants: inv.resultats,
    contratVide: !contrat.invariants?.length,
    verdict:
      (g.violations || []).length ? 'REFUSÉ'
        : !contrat.invariants?.length ? 'INJUGEABLE'
          : inv.ok ? 'ACCEPTÉ' : 'REFUSÉ',
  };
  fs.writeFileSync(path.join(chantier, 'verdict.json'), JSON.stringify(verdict, null, 2) + '\n');

  console.log(`\n╔══ VERDICT ─ ${lot.nom} : ${verdict.verdict}`);
  console.log(`╚══ ${verdict.fichiersTouches.length} fichier(s) touché(s)\n`);
  if (verdict.horsBail) console.log(`  ⛔ ${verdict.horsBail} fichier(s) hors bail → le lot ENTIER est révoqué.`);
  for (const t of verdict.triches) console.log(`  ⛔ [${t.regle}] ${t.fichier} : ${t.texte}`);
  if (verdict.contratVide) console.log(`  ⛔ Aucun invariant au contrat : rien ne peut être prouvé, donc rien n'est accepté.`);
  for (const r of verdict.invariants) console.log(`  ${r.ok ? '✓' : '✗'} ${String(r.nom).padEnd(40)} ${r.mesure}`);
  console.log(`\n  Le juge ne lit ni le raisonnement de l'ouvrier ni le recompte du scanner : le diff, le contrat, les invariants.\n`);
  process.exitCode = verdict.verdict === 'ACCEPTÉ' ? 0 : 1;
}

if (CMD === 'fermer') {
  const chantier = path.join(CHANTIERS, NOM_LOT);
  git(['worktree', 'remove', '--force', chantier]);
  console.log(`chantier ${NOM_LOT} fermé.`);
}
