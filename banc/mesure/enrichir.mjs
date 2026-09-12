#!/usr/bin/env node
/**
 * enrichir.mjs — Quand Thomas trouve un bug qu'on n'avait pas vu.
 *
 * LE MOMENT LE PLUS IMPORTANT DU DISPOSITIF, et celui que tout le monde rate.
 *
 * Un bug que le client découvre est la seule preuve irréfutable d'un trou dans le
 * détecteur. S'il se corrige et s'oublie, le trou reste et le chiffre continue de dire
 * que tout va bien. La règle est donc l'inverse de l'intuition :
 *
 *     UN BUG DU TERRAIN ENTRE AU BANC AVANT D'ÊTRE CORRIGÉ,
 *     ET IL FAIT BAISSER LE CHIFFRE JUSQU'À CE QUE LE DÉTECTEUR EXISTE.
 *
 * La baisse n'est pas un accident, c'est l'information. Le cliquet la laisse passer
 * (un défaut AJOUTÉ ne bloque pas, un défaut RETIRÉ bloque) et la date.
 *
 * Le cas est figé à un COMMIT, pas à un état de travail : la correction du jour même ne
 * le fait pas disparaître du banc. C'est l'idée de SWE-bench, appliquée à nous.
 *
 * INTERDIT : ajouter au banc un défaut trouvé PAR l'auditeur. Ce serait le détecteur
 * écrivant sa propre épreuve. Un tel défaut va aux verdicts (crédit de justesse, légitime),
 * jamais à la vérité terrain.
 *
 *   node enrichir.mjs --repo=projet client C --fichier=convex/rush.ts --ligne=2955 \
 *     --famille=LOCATAIRE --resume="la vignette d'un autre client apparaît dans le lecteur" \
 *     [--symbole=listerVignettes] [--commit=HEAD]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FAMILLES } from './familles.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const ARG = (n, d) => { const f = process.argv.find((a) => a.startsWith('--' + n + '=')); return f ? f.split('=').slice(1).join('=') : d; };
const repo = ARG('repo'), fichier = ARG('fichier'), ligne = Number(ARG('ligne', 0));
const famille = ARG('famille'), resume = ARG('resume'), symbole = ARG('symbole'), commit = ARG('commit', 'HEAD');

if (!repo || !fichier || !famille || !resume) {
  console.error(`\nManque un argument. Minimum : --repo --fichier --famille --resume\n`);
  console.error(`Familles connues :\n  ${Object.keys(FAMILLES).join('\n  ')}\n`);
  console.error(`Si aucune ne colle, c'est une famille NEUVE : ajoute-la d'abord dans familles.mjs,`);
  console.error(`décrite par le symptôme vu par le client, et LAISSE-LA SANS RÈGLE. Une famille sans`);
  console.error(`détecteur est une information, pas un oubli : elle apparaît au rapport sous`);
  console.error(`« familles qu'aucune règle ne prétend couvrir ».\n`);
  process.exit(2);
}
if (!FAMILLES[famille]) { console.error(`Famille inconnue : ${famille}`); process.exit(2); }

const src = JSON.parse(fs.readFileSync(path.join(ICI, 'sources.json'), 'utf8')).find((s) => s.nom === repo);
if (!src) { console.error(`Dépôt inconnu : ${repo}`); process.exit(2); }

const racine = execFileSync('git', ['-C', src.chemin, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const sha = execFileSync('git', ['-C', racine, 'rev-parse', commit], { encoding: 'utf8' }).trim();

const fj = path.join(ICI, 'cas', 'terrain.json');
const liste = fs.existsSync(fj) ? JSON.parse(fs.readFileSync(fj, 'utf8')) : [];
const id = `${repo}-${sha.slice(0, 7)}-${path.basename(fichier, path.extname(fichier))}-${ligne || 0}`;
if (liste.some((c) => c.defauts.some((d) => d.id === id))) { console.log(`Déjà au banc : ${id}`); process.exit(0); }

liste.push({
  cas: id, repo_git: racine, sous_dossier: path.relative(racine, src.chemin), commit_casse: sha,
  provenance: 'terrain', trouve_le: new Date().toISOString().slice(0, 10), exhaustive: false,
  defauts: [{
    id, familles: [famille], fichiers: [fichier], lignes: ligne ? [ligne] : [],
    symboles: symbole ? [symbole] : [], resume, symptome: FAMILLES[famille],
  }],
});
fs.mkdirSync(path.dirname(fj), { recursive: true });
fs.writeFileSync(fj, JSON.stringify(liste, null, 2));

console.log(`\n✓ Cas ajouté : ${id}`);
console.log(`  figé au commit ${sha.slice(0, 12)} : la correction d'aujourd'hui ne l'effacera pas du banc.`);
console.log(`  famille ${famille} : ${FAMILLES[famille]}`);
console.log(`\n  Attendu : le rappel BAISSE à la prochaine mesure. C'est le but.`);
console.log(`  Il ne remontera que le jour où un détecteur attrapera vraiment ce cas.\n`);
console.log(`  Suite : node mesurer.mjs --enregistre  puis  node cliquet.mjs --verifier\n`);
