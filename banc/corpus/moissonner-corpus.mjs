#!/usr/bin/env node
/**
 * moissonner-corpus.mjs — La moisson élargie : nos VRAIS défauts, écrits par nous, des mois
 * avant que ce skill existe.
 *
 * Reprend le critère de banc/mesure/moissonner.mjs (scellé, on ne le touche pas) et l'élargit
 * là où le chantier « corpus » le demande :
 *   — le câblage compte autant que le backend (un écran qui appelle mal est un défaut réel) ;
 *   — le filtre de taille porte sur les LIGNES changées (< 60), pas seulement sur le nombre
 *     de fichiers : un correctif d'une ligne dans 6 fichiers reste lisible ;
 *   — on extrait l'AVANT et l'APRÈS, pas seulement les numéros de ligne.
 *
 * Tout se fait dans les clones de l'atelier (hors du skill, cf. atelier.mjs) : les dépôts d'origine sont lus une
 * seule fois, au clonage, et jamais écrits.
 *
 *   node moissonner-corpus.mjs              → moissonne et écrit travail/candidats.json
 *   node moissonner-corpus.mjs --resume     → relit le fichier et résume
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TRAVAIL, CLONES } from './atelier.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const A = (n) => process.argv.includes('--' + n);
const NUL = String.fromCharCode(0);
const SEP = String.fromCharCode(31);

/* CORPUS_SUFFIXE : chaque processus de mesure travaille sur SON clone (clones/qos-p3…), sinon
 * deux « git worktree add » simultanés se disputent le verrou du même dépôt. */
const SUF = process.env.CORPUS_SUFFIXE || '';

export const DEPOTS = [
  { nom: 'qos', clone: path.join(CLONES, 'qos' + SUF), origine: '/root/QOS' },
  { nom: 'brvndlab', clone: path.join(CLONES, 'brvndlab' + SUF), origine: '/home/hermes/workspace/brvndlab' },
  // agci : 14 commits, aucun « fix » — moissonné, vide, gardé pour mémoire.
  { nom: 'agci', clone: '/chemin/vers/projet-c', origine: '/chemin/vers/projet-c', lectureSeule: true },
];

const git = (r, a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();

/* Un commit annonce une correction. Élargi au vocabulaire réel de nos messages :
 * « fix », « corrige », « répare », mais aussi « ne … plus », « remet », « rétablit ». */
export const DIT_CORRIGE = /^(fix|corrig|répar|repar|hotfix|bug|patch|résou|resou|rétabli|retabli|remet en|rattrape)/i;

/* Backend et câblage. On exclut le généré, les tests, les migrations de données, le style. */
export const BACKEND = /(^|\/)(convex\/(?!_generated)[^/]*\.ts|app\/api\/.+\.tsx?|src\/lib\/.+\.tsx?|lib\/.+\.tsx?|server\/.+\.ts|src\/app\/api\/.+\.tsx?|src\/hooks\/.+\.tsx?|src\/services\/.+\.ts|scripts\/.+\.(ts|mjs|js))$/;
const EXCLU = /(\.test\.|\.spec\.|_generated|node_modules|\.d\.ts$)/;

export function candidats(repo, nom) {
  const format = '%x00%H%x1f%P%x1f%at%x1f%s';
  const blocs = git(repo, ['log', '--format=' + format, '--name-only', '--no-merges'])
    .split(NUL).filter((b) => b.trim());
  const out = [];
  for (const b of blocs) {
    const [entete, ...fichiers] = b.trim().split('\n');
    if (!entete || !entete.includes(SEP)) continue;
    const [sha, parents, ts, sujet] = entete.split(SEP);
    if (!DIT_CORRIGE.test(sujet)) continue;
    if (!parents.trim()) continue;                       // commit racine : pas d'état AVANT
    const touches = fichiers.filter((f) => BACKEND.test(f) && !EXCLU.test(f));
    if (!touches.length || touches.length > 6) continue;
    out.push({ depot: nom, sha, parent: parents.split(' ')[0],
      date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), sujet, fichiers: touches });
  }
  return out;
}

/** numstat sur les seuls fichiers retenus : combien de lignes le correctif a bougé. */
function taille(repo, c) {
  const brut = git(repo, ['diff', '--numstat', c.parent, c.sha, '--', ...c.fichiers]);
  let add = 0, del = 0;
  for (const l of brut.split('\n')) {
    const [a, d] = l.split('\t');
    if (a && a !== '-') add += Number(a);
    if (d && d !== '-') del += Number(d);
  }
  return { ajoutees: add, supprimees: del, total: add + del };
}

const lignesTouchees = (repo, c, f) => {
  try {
    return [...git(repo, ['diff', '-U0', c.parent, c.sha, '--', f]).matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)/gm)]
      .map((m) => ({ avant: Number(m[1]), apres: Number(m[3]) }));
  } catch { return []; }
};

export function moissonner() {
  const cas = [];
  const stats = [];
  for (const d of DEPOTS) {
    if (!fs.existsSync(d.clone)) { stats.push({ depot: d.nom, erreur: 'clone absent' }); continue; }
    const tousCommits = Number(git(d.clone, ['rev-list', '--count', 'HEAD']));
    const c0 = candidats(d.clone, d.nom);
    let tropGros = 0;
    for (const c of c0) {
      const t = taille(d.clone, c);
      if (t.total === 0) continue;
      if (t.total >= 60) { tropGros++; continue; }
      const corps = git(d.clone, ['log', '-1', '--format=%b', c.sha]).slice(0, 600);
      cas.push({
        id: `${d.nom}-${c.sha.slice(0, 8)}`,
        depot: d.nom, sha: c.sha, parent: c.parent, date: c.date,
        message: c.sujet, corps, fichiers: c.fichiers, taille: t,
        ancres: Object.fromEntries(c.fichiers.map((f) => [f, lignesTouchees(d.clone, c, f)])),
      });
    }
    stats.push({ depot: d.nom, commits: tousCommits, annoncentCorrection: c0.length, tropGros, retenus: cas.filter((x) => x.depot === d.nom).length });
  }
  return { cas, stats };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  fs.mkdirSync(TRAVAIL, { recursive: true });
  if (A('resume')) {
    const j = JSON.parse(fs.readFileSync(path.join(TRAVAIL, 'candidats.json'), 'utf8'));
    console.log(JSON.stringify(j.stats, null, 2));
    console.log(`${j.cas.length} candidats.`);
  } else {
    const r = moissonner();
    fs.writeFileSync(path.join(TRAVAIL, 'candidats.json'), JSON.stringify(r, null, 2));
    console.log('\nMOISSON ÉLARGIE — commits qui annoncent une correction, sur du backend ou du câblage, < 60 lignes\n');
    for (const s of r.stats)
      console.log(`  ${String(s.depot).padEnd(10)} ${String(s.commits ?? '—').padStart(5)} commits   ${String(s.annoncentCorrection ?? 0).padStart(4)} annoncent une correction   ${String(s.tropGros ?? 0).padStart(3)} trop gros   ${String(s.retenus ?? 0).padStart(4)} candidats`);
    console.log(`\n  TOTAL CANDIDATS : ${r.cas.length}\n`);
  }
}
