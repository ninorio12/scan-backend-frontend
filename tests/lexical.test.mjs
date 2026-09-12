/**
 * lexical.test.mjs : un concept, une source. Sur le projet figé.
 *
 * Trois choses à prouver : il sort les concepts lus depuis plusieurs tables ; il ne
 * prend jamais un verbe pour un concept (régression : 130 faux constats dont les cinq
 * premiers étaient des verbes) ; le lexique métier du projet (.backend/lexique.json)
 * fusionne bien deux mots en un concept.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, lireJson, ecrireJson, copieProjetFige, supprimer } from './aide.mjs';

const VERBES = ['creer', 'enregistrer', 'supprimer', 'modifier', 'lister', 'liste', 'obtenir', 'chercher',
  'compter', 'basculer', 'archiver', 'envoyer', 'ouvrir', 'fermer', 'ajouter', 'retirer', 'marquer',
  'valider', 'annuler', 'charger', 'maj', 'creation'];

describe('lexical.mjs sur le projet figé', () => {
  let repo, sans, avec, runSans, runAvec;
  before(() => {
    repo = copieProjetFige();
    const j1 = path.join(repo, 'lexical-sans.json');
    runSans = lancer('lexical.mjs', [repo, '--json', j1]);
    sans = fs.existsSync(j1) ? lireJson(j1) : null;

    ecrireJson(path.join(repo, '.backend', 'lexique.json'), { visite: 'rdv', visites: 'rdv' });
    const j2 = path.join(repo, 'lexical-avec.json');
    runAvec = lancer('lexical.mjs', [repo, '--json', j2]);
    avec = fs.existsSync(j2) ? lireJson(j2) : null;
  });
  after(() => supprimer(repo));

  test('sort des concepts lus depuis plusieurs sources, chacun avec au moins deux tables', () => {
    assert.ok(sans, `pas de JSON produit. Sortie :\n${runSans.sortie}`);
    assert.ok(sans.sourcesMultiples.length >= 1, 'aucun concept à sources multiples sur un projet qui en a (« bien » est lu depuis biens, proprietaires, tableauBord…)');
    for (const c of sans.sourcesMultiples) assert.ok(c.sources.length >= 2, `« ${c.concept} » n'a qu'une source`);
    assert.ok(sans.sourcesMultiples.some((c) => c.concept === 'bien'), `« bien » absent : ${sans.sourcesMultiples.map((c) => c.concept).join(', ')}`);
    assert.equal(runSans.code, 1, 'des constats → code 1');
  });

  test('ne prend jamais un verbe (créer, supprimer, lister…) pour un concept', () => {
    assert.ok(sans, 'pas de JSON produit');
    const concepts = sans.sourcesMultiples.map((c) => c.concept);
    const verbes = concepts.filter((c) => VERBES.includes(c) || c.split('|').some((j) => VERBES.includes(j)));
    assert.deepEqual(verbes, [], `verbes sortis comme concepts : ${verbes.join(', ')}`);
  });

  test('avec un lexique déclarant visite = rdv, « visites » et « rdv » fusionnent en un seul concept', () => {
    assert.ok(avec, `pas de JSON produit. Sortie :\n${runAvec.sortie}`);
    const concepts = avec.sourcesMultiples.map((c) => c.concept);
    assert.ok(concepts.includes('rdv'), `« rdv » absent après fusion : ${concepts.join(', ')}`);
    assert.ok(!concepts.includes('visites') && !concepts.includes('visite'), `« visites » survit à côté de « rdv » : ${concepts.join(', ')}`);
    const rdv = avec.sourcesMultiples.find((c) => c.concept === 'rdv');
    const tables = rdv.sources.map((s) => s.table);
    assert.ok(tables.includes('visites'), `les lectures de la table visites ne sont pas rattachées à rdv : ${tables.join(', ')}`);
    assert.ok(tables.length >= 2);
  });

  test('sans lexique, « rdv » n\'existe pas : la fusion vient bien du fichier du projet', () => {
    assert.ok(sans, 'pas de JSON produit');
    assert.ok(!sans.sourcesMultiples.some((c) => c.concept === 'rdv'));
  });
});
