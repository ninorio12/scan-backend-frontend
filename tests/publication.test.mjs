/**
 * publication.test.mjs : le verrou qui manquait.
 *
 * POURQUOI CE FICHIER EXISTE. `npm test` était vert chez l'auteur et échouait 9 fois sur
 * 66 chez quiconque clonait le dépôt : le `.gitignore` contenait `.backend/`, qui avalait
 * `tests/fixtures/backend-sain/.backend/`, c'est-à-dire les fixtures du seul contrôle qui
 * prouve que le baromètre note juste. Personne ne pouvait le voir depuis le dossier
 * d'origine, où les fichiers sont là, simplement pas publiés.
 *
 * Un verrou qui ne tourne que sur la machine de l'auteur ne verrouille rien. Ce test
 * compare donc ce que les tests LISENT dans tests/fixtures/ à ce que git PUBLIE, et
 * échoue si l'écart réapparaît, quelle qu'en soit la cause (une règle d'ignorance, un
 * fichier oublié à l'ajout).
 *
 * Hors dépôt git (installation par archive), il n'y a rien à vérifier : le test le dit
 * et passe, il ne se saute pas en silence.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { SKILL, FIXTURES } from './aide.mjs';

const git = (...args) => spawnSync('git', ['-C', SKILL, ...args], { encoding: 'utf8' });

function fichiersSurDisque(racine) {
  const out = [];
  (function w(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) w(p);
      else out.push(path.relative(SKILL, p));
    }
  })(racine);
  return out;
}

test('tout ce que tests/fixtures/ contient est publié par git', () => {
  if (git('rev-parse', '--is-inside-work-tree').status !== 0) {
    console.log('    (pas un dépôt git : rien à vérifier ici)');
    return;
  }
  const publies = new Set(
    git('ls-files', 'tests/fixtures').stdout.split('\n').filter(Boolean),
  );
  const surDisque = fichiersSurDisque(FIXTURES);
  const manquants = surDisque.filter((f) => !publies.has(f));

  assert.deepEqual(manquants, [],
    'Ces fixtures existent ici mais ne sont PAS dans le dépôt publié : chez un tiers qui\n' +
    'clone, les tests qui les lisent échoueront. Soit les ajouter (git add -f), soit\n' +
    'lever la règle du .gitignore qui les avale :\n' +
    manquants.map((f) => '  ' + f).join('\n'));
});

test('la fixture du baromètre est complète : bilan.test.mjs a de quoi tourner', () => {
  const dossier = path.join(FIXTURES, 'backend-sain', '.backend');
  assert.ok(fs.existsSync(dossier),
    `${dossier} est absent. bilan.test.mjs le copie pour chacun de ses cas : sans lui, les\n` +
    'neuf tests du baromètre échouent en ENOENT. C\'est exactement le défaut qu\'un tiers a\n' +
    'rencontré sur un clone frais.');
  /* Les fichiers que bilan.mjs lit, et que chaque cas modifie d'une seule chose. */
  for (const f of ['couverture.json', 'scan.json', 'lexical.json', 'fausses.json',
    'liens.json', 'clics_accueil.json', 'questions.json']) {
    assert.ok(fs.existsSync(path.join(dossier, f)), `fixture backend-sain : ${f} manque`);
  }
});
