/**
 * liens.test.mjs : liens.mjs sur une page de liens dont on connaît les cibles.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancerAsync, lireJson, dossierJetable, supprimer, portFerme, navigateurDisponible, CONCLUSION_INTERDITE } from '../aide.mjs';
import { demarrerServeur } from '../fixtures/pages.mjs';

const manque = await navigateurDisponible();
const skip = manque ? `Playwright absent, les tests navigateur ne peuvent pas tourner : ${manque}` : false;

describe('liens.mjs sur la page de liens', { skip }, () => {
  let srv, run, R;
  const json = path.join(dossierJetable(), 'liens.json');
  before(async () => {
    srv = await demarrerServeur();
    run = await lancerAsync('liens.mjs', [srv.url, '--depart', '/liens', '--json', json], { timeout: 40000 });
    R = fs.existsSync(json) ? lireJson(json) : null;
  }, { timeout: 45000 });
  after(async () => { await srv.fermer(); supprimer(path.dirname(json)); });

  test('le lien vers /inexistant est MORT', { timeout: 30000 }, () => {
    assert.ok(R, `pas de JSON produit. Sortie :\n${run.sortie}`);
    const v = R.verdicts.find((x) => x.href === '/inexistant');
    assert.ok(v && v.verdict === 'MORT', `/inexistant : ${JSON.stringify(v)} (verdicts : ${JSON.stringify(R.verdicts)})`);
  });

  test('le lien vers /vide est VIDE', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const v = R.verdicts.find((x) => x.href === '/vide');
    assert.ok(v && v.verdict === 'VIDE', `/vide : ${JSON.stringify(v)}`);
  });

  test('le lien vers /autre, qui existe, n\'est pas signalé', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    assert.ok(!R.verdicts.some((x) => x.href === '/autre'), `/autre signalé : ${JSON.stringify(R.verdicts.find((x) => x.href === '/autre'))}`);
  });

  test('le lien externe n\'est jamais suivi', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    assert.ok(!run.sortie.includes('exemple.invalid') && !JSON.stringify(R).includes('exemple.invalid'));
  });

  test('sort en code 1 puisqu\'un lien est mort', { timeout: 30000 }, () => {
    assert.equal(run.code, 1, `code ${run.code}. Sortie :\n${run.sortie}`);
  });
});

describe('liens.mjs refuse de conclure quand il n\'a pas de page', { skip }, () => {
  let srv;
  before(async () => { srv = await demarrerServeur(); });
  after(async () => { await srv.fermer(); });

  const refus = (nom, run) => {
    assert.equal(run.code, 2, `${nom} : code ${run.code} au lieu de 2. Sortie :\n${run.sortie}`);
    assert.ok(!CONCLUSION_INTERDITE.test(run.sortie), `${nom} : la sortie conclut alors qu'il n'y a pas de page :\n${run.sortie}`);
  };

  test('sur une base qui ne répond pas : code 2, jamais « Tous les liens mènent quelque part »', { timeout: 30000 }, async () => {
    const port = await portFerme();
    refus('port fermé', await lancerAsync('liens.mjs', [`http://127.0.0.1:${port}`]));
  });

  test('sur un départ en 404 : code 2, jamais « Tous les liens mènent quelque part »', { timeout: 30000 }, async () => {
    refus('404', await lancerAsync('liens.mjs', [srv.url, '--depart', '/inexistant']));
  });

  test('sur une page de connexion : code 2 et dit qu\'il n\'est pas dans l\'application', { timeout: 30000 }, async () => {
    const run = await lancerAsync('liens.mjs', [srv.url, '--depart', '/connexion']);
    refus('connexion', run);
    assert.match(run.sortie, /connexion|login|sign.?in|authentif|pas dans l'application|hors de l'application/i,
      `la sortie ne dit pas qu'on est devant une page de connexion :\n${run.sortie}`);
  });

  test('sur une route qui répond du JSON brut en 400 : code 2, jamais « Tous les liens mènent quelque part »', { timeout: 30000 }, async () => {
    refus('json 400', await lancerAsync('liens.mjs', [srv.url, '--depart', '/api/brut']));
  });
});
