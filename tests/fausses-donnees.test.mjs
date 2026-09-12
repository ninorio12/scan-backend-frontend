/**
 * fausses-donnees.test.mjs : la fausse donnée, trouvée à la source.
 *
 * Le projet figé n'a pas de fichier semeur (vérifié : aucun seed/mock/fixture dans
 * banc2). Le semeur se teste donc sur fixtures/projet-fausses, un dépôt minuscule qui
 * contient exactement les pièges connus : le vrai client listé dans une config, un nom
 * de service (« Google Calendar »), un marqueur affiché en dur dans un écran.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, lireJson, copieProjetFige, supprimer, dossierJetable, FIXTURES } from './aide.mjs';

describe('fausses-donnees.mjs sur le projet piège', () => {
  let run, R;
  const json = path.join(dossierJetable(), 'fausses.json');
  before(() => {
    run = lancer('fausses-donnees.mjs', [path.join(FIXTURES, 'projet-fausses'), '--json', json]);
    R = fs.existsSync(json) ? lireJson(json) : null;
  });
  after(() => supprimer(path.dirname(json)));

  test('trouve le semeur convex/seed.ts', () => {
    assert.ok(R, `pas de JSON produit. Sortie :\n${run.sortie}`);
    assert.deepEqual(R.semeurs, ['convex/seed.ts']);
  });

  test('sort les marqueurs du semeur : noms et emails de fiction', () => {
    assert.ok(R, 'pas de JSON produit');
    const valeurs = R.marqueurs.map((m) => m.valeur);
    for (const v of ['Marc Lefèvre', 'Sophie Martin', 'marc.lefevre@example.com']) {
      assert.ok(valeurs.includes(v), `« ${v} » manque parmi : ${valeurs.join(', ')}`);
    }
    assert.equal(R.marqueurs.find((m) => m.valeur === 'Marc Lefèvre').type, 'nom');
    assert.equal(R.marqueurs.find((m) => m.valeur === 'marc.lefevre@example.com').type, 'email');
  });

  test('n\'inclut pas les personnes présentes dans une config client : ce sont les vrais', () => {
    assert.ok(R, 'pas de JSON produit');
    const valeurs = R.marqueurs.map((m) => m.valeur);
    assert.ok(!valeurs.includes('Claire Fontaine'), '« Claire Fontaine » est le client (clients/agence.config.json), pas une fausse donnée');
    assert.ok(!valeurs.includes('contact@agence.example'), 'l\'email du client est sorti comme fausse donnée');
  });

  test('n\'inclut pas « Google Calendar » comme personne', () => {
    assert.ok(R, 'pas de JSON produit');
    const valeurs = R.marqueurs.map((m) => m.valeur);
    assert.ok(!valeurs.some((v) => /Google Calendar/.test(v)), `un nom de service est sorti comme personne : ${valeurs.join(', ')}`);
  });

  test('voit le marqueur affiché en dur dans un écran, et sort en code 1', () => {
    assert.ok(R, 'pas de JSON produit');
    const a = R.affiches.find((x) => x.valeur === 'Marc Lefèvre');
    assert.ok(a, `« Marc Lefèvre » est écrit en dur dans app/page.tsx et n'est pas signalé : ${JSON.stringify(R.affiches)}`);
    assert.match(a.ou, /^app\/page\.tsx:\d+$/);
    assert.equal(run.code, 1);
  });
});

describe('fausses-donnees.mjs sur le projet figé', () => {
  let repo, run, R;
  before(() => {
    repo = copieProjetFige();
    const json = path.join(repo, 'fausses.json');
    run = lancer('fausses-donnees.mjs', [repo, '--json', json]);
    R = fs.existsSync(json) ? lireJson(json) : null;
  });
  after(() => supprimer(repo));

  test('tourne sans planter et écrit un JSON aux quatre clés', () => {
    assert.ok(R, `pas de JSON produit. Sortie :\n${run.sortie}`);
    for (const k of ['semeurs', 'marqueurs', 'affiches', 'motifs']) assert.ok(Array.isArray(R[k]), `clé ${k} absente`);
    assert.ok([0, 1].includes(run.code), `code ${run.code}`);
  });

  test('sans semeur, ne signale aucune valeur affichée en dur (rien à comparer)', () => {
    assert.ok(R, 'pas de JSON produit');
    assert.deepEqual(R.semeurs, []);
    assert.deepEqual(R.affiches, []);
    assert.equal(run.code, 0);
  });
});
