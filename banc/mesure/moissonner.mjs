#!/usr/bin/env node
/**
 * moissonner.mjs — Le corpus qu'on n'a pas écrit.
 *
 * Tout le reste du harnais est encore, à un degré ou un autre, de notre main : nous
 * écrivons les opérateurs, la vérité du banc figé, l'arbitrage. C'est la circularité de
 * troisième type d'Addy Osmani : on écrit l'épreuve et on se corrige soi-même.
 *
 * Il existe pourtant sur cette machine un corpus de défauts RÉELS dont la vérité n'a été
 * écrite par personne qui pensait aux détecteurs : l'historique git de nos SaaS. Chaque
 * commit « fix » qui touche convex/ ou une route d'API prouve qu'un défaut existait au
 * commit PARENT et n'existait plus après. La vérité terrain, c'est le DIFF, et il date de
 * mois avant que le skill existe.
 *
 * Le critère devient infalsifiable par nous :
 *
 *     l'auditeur signale-t-il, au commit cassé, quelque chose à l'endroit que le correctif
 *     a touché, ET ce signalement disparaît-il après le correctif ?
 *
 * Trois issues : VU, MANQUÉ, CRIE. La troisième est celle qu'aucun banc maison n'attrape :
 * un détecteur qui signale tout obtient un rappel parfait sur des défauts plantés, et
 * échoue ici, parce que le correctif humain ne le fait pas taire.
 *
 *   node moissonner.mjs --lister
 *   node moissonner.mjs --extraire --n=200
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const ARG = (n, d) => { const f = process.argv.find((a) => a.startsWith('--' + n + '=')); return f ? f.split('=')[1] : d; };
const A = (n) => process.argv.includes('--' + n);
const NUL = String.fromCharCode(0);
const SEP = String.fromCharCode(31);   // séparateur d'unité, absent des messages de commit

const SOURCES = JSON.parse(fs.readFileSync(path.join(ICI, 'sources.json'), 'utf8'))
  .map((s) => { try { return { ...s, git: execFileSync('git', ['-C', s.chemin, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim() }; } catch { return null; } })
  .filter(Boolean);

const git = (r, a) => execFileSync('git', ['-C', r, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/* Un commit est candidat s'il annonce une correction ET touche le backend. Le CSS, les
 * images et les libellés sont exclus : ce ne sont pas des défauts de câblage, et les
 * compter diluerait la mesure. Un correctif qui touche plus de 4 fichiers est une refonte,
 * pas un défaut localisé. */
const DIT_CORRIGE = /^(fix|corrige|corrig|répare|repare|hotfix|bug|patch)/i;
const BACKEND = /(^|\/)(convex\/(?!_generated).*\.ts|app\/api\/.*\.ts|lib\/.*\.ts|server\/.*\.ts)$/;

function candidats(repo) {
  const format = '%x00%H%x1f%at%x1f%s';
  const blocs = git(repo, ['log', '--format=' + format, '--name-only', '--no-merges', '-n', '4000'])
    .split(NUL).filter((b) => b.trim());
  const out = [];
  for (const b of blocs) {
    const [entete, ...fichiers] = b.trim().split('\n');
    if (!entete || !entete.includes(SEP)) continue;
    const [sha, ts, sujet] = entete.split(SEP);
    if (!DIT_CORRIGE.test(sujet)) continue;
    const touches = fichiers.filter((f) => BACKEND.test(f));
    if (!touches.length || touches.length > 4) continue;
    out.push({ sha, date: new Date(Number(ts) * 1000).toISOString().slice(0, 10), sujet, fichiers: touches });
  }
  return out;
}

const lignesTouchees = (repo, sha, f) => {
  try { return [...git(repo, ['diff', '-U0', sha + '^', sha, '--', f]).matchAll(/^@@ -(\d+)/gm)].map((m) => Number(m[1])).slice(0, 6); }
  catch { return []; }
};

if (A('lister') || process.argv.length === 2) {
  console.log('\nMOISSON DE L’HISTORIQUE — commits « fix » qui touchent le backend\n');
  let total = 0;
  for (const s of SOURCES) {
    const c = candidats(s.git); total += c.length;
    console.log(`  ${s.nom.padEnd(10)} ${String(c.length).padStart(4)} cas exploitables sur ${git(s.git, ['rev-list', '--count', 'HEAD'])} commits`);
    for (const x of c.slice(0, 3)) console.log(`     ${x.date}  ${x.sha.slice(0, 8)}  ${x.fichiers.join(', ').slice(0, 42).padEnd(42)}  ${x.sujet.slice(0, 58)}`);
  }
  console.log(`\n  TOTAL : ${total} défauts réels corrigés par un humain.`);
  console.log(`  Aucun n'a été choisi ni rédigé en pensant aux détecteurs.\n`);
}

if (A('extraire')) {
  const n = Number(ARG('n', 200));
  const cas = [];
  for (const s of SOURCES)
    for (const x of candidats(s.git).slice(0, Math.ceil(n / SOURCES.length)))
      cas.push({
        cas: `${s.nom}-${x.sha.slice(0, 7)}`, repo_git: s.git, commit_casse: x.sha + '^',
        commit_repare: x.sha, provenance: 'historique-git', exhaustive: false,
        defauts: x.fichiers.map((f, i) => ({
          id: `${s.nom}-${x.sha.slice(0, 7)}-${i}`, familles: ['A_CLASSER'], fichiers: [f],
          lignes: lignesTouchees(s.git, x.sha, f), symboles: [], resume: x.sujet,
          preuve: `corrigé par ${s.nom}@${x.sha} le ${x.date}`,
        })),
      });
  fs.mkdirSync(path.join(ICI, 'cas'), { recursive: true });
  fs.writeFileSync(path.join(ICI, 'cas', 'moisson.json'), JSON.stringify(cas, null, 2));
  console.log(`\n${cas.length} cas écrits dans cas/moisson.json.`);
  console.log(`Chacun se matérialise par « git archive <commit_casse> » : rien n'est copié ici.\n`);
}
