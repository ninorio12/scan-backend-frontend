/**
 * scan.test.mjs : le point d'entrée du scan de code : il enchaîne, il écrit dans
 * .backend/, et il ne perd rien de ce que le scanner a désigné.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, lireJson, copieProjetFige, supprimer, endroitsDuScanner } from './aide.mjs';

describe('scan.mjs sur le projet figé', () => {
  let repo, run, cands, D;
  before(() => {
    repo = copieProjetFige();
    cands = endroitsDuScanner(repo);
    run = lancer('scan.mjs', [repo], { timeout: 300000 });
    const json = path.join(repo, '.backend', 'dialogue.json');
    D = fs.existsSync(json) ? lireJson(json) : null;
  }, { timeout: 320000 });
  after(() => supprimer(repo));

  test('écrit le détail machine dans <repo>/.backend/dialogue.json', () => {
    assert.ok(D, `pas de .backend/dialogue.json. Sortie :\n${run.sortie}`);
  });

  test('ne perd aucun endroit désigné par le scanner (règle cardinale)', () => {
    assert.ok(D, 'pas de JSON produit');
    assert.ok(D.constats.length >= cands.length, `${D.constats.length} constats pour ${cands.length} endroits`);
  });

  test('le rapport lisible a ses deux sections : ce qu\'on comprend, ce qui reste à regarder', () => {
    assert.match(run.stdout, /CE QU'ON COMPREND/);
    assert.match(run.stdout, /À REGARDER, PAS ENCORE EXPLIQUÉ/);
  });

  test('sort en code 1 puisqu\'il a compris des désaccords', () => {
    assert.equal(run.code, 1, `code ${run.code}`);
  });

  test('sur un dépôt introuvable, sort en code 2 et le dit', () => {
    const r = lancer('scan.mjs', ['/nulle/part/ici']);
    assert.equal(r.code, 2);
    assert.match(r.sortie, /introuvable/);
  });
});
