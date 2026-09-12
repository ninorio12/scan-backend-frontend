/**
 * dialogue.test.mjs : la règle cardinale : l'apparieur ne supprime jamais, il classe.
 *
 * Régression payée : une version qui laissait l'apparieur écarter ce qu'il jugeait sain
 * est tombée de 23 défauts retrouvés à 2 sur le banc figé. Depuis, tout ce que le
 * scanner a désigné reste dans les constats. Ce test le vérifie endroit par endroit.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, lireJson, copieProjetFige, supprimer, endroitsDuScanner } from './aide.mjs';

describe('dialogue.mjs sur le projet figé', () => {
  let repo, cands, run, D;
  before(() => {
    repo = copieProjetFige();
    cands = endroitsDuScanner(repo);
    const json = path.join(repo, 'dialogue.json');
    run = lancer('dialogue.mjs', [repo, '--json', json], { timeout: 300000 });
    D = fs.existsSync(json) ? lireJson(json) : null;
  }, { timeout: 320000 });
  after(() => supprimer(repo));

  test('le scanner seul désigne des dizaines d\'endroits (sinon le test suivant ne prouve rien)', () => {
    assert.ok(cands.length >= 20, `${cands.length} endroits`);
  });

  test('après ordonnancement, il y a au moins autant de constats que d\'endroits du scanner seul (incident 23 → 2)', () => {
    assert.ok(D, `pas de JSON produit. Sortie :\n${run.sortie}`);
    assert.ok(D.constats.length >= cands.length, `${D.constats.length} constats pour ${cands.length} endroits désignés : l'apparieur a supprimé`);
    assert.equal(D.stats.candidats, cands.length, 'le dialogue ne compte pas les mêmes endroits que le scanner');
  });

  test('chaque endroit désigné par le scanner est encore là, avec sa règle, son fichier et sa ligne', () => {
    assert.ok(D, 'pas de JSON produit');
    const perdus = cands.filter((c) => !D.constats.some((k) => k.regle === c.regle && k.fichier === c.fichier && k.ligne === c.ligne));
    assert.deepEqual(perdus, [], `${perdus.length} endroit(s) perdus :\n${perdus.map((p) => `  ${p.regle} ${p.fichier}:${p.ligne}`).join('\n')}`);
  });

  test('ce que l\'apparieur comprend monte en tête : les DÉSACCORD précèdent les ACCORD', () => {
    assert.ok(D, 'pas de JSON produit');
    const rangs = D.constats.map((c) => c.reponse);
    const dernierDesaccord = rangs.lastIndexOf('DÉSACCORD');
    const premierAccord = rangs.indexOf('ACCORD');
    assert.ok(dernierDesaccord >= 0, 'aucun DÉSACCORD sur un banc qui en a 26');
    assert.ok(premierAccord < 0 || premierAccord > dernierDesaccord, 'un ACCORD précède un DÉSACCORD');
  });

  test('aucune réponse n\'est « je ne sais pas » : chaque constat a une réponse parmi les quatre', () => {
    assert.ok(D, 'pas de JSON produit');
    const autres = D.constats.filter((c) => !['DÉSACCORD', 'SEUL', 'ACCORD', 'HORS CHAMP'].includes(c.reponse));
    assert.deepEqual(autres, []);
  });
});
