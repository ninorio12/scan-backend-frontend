/**
 * decisions.test.mjs : une question posée une fois vaut un détecteur pour toujours.
 *
 * Sur une copie du projet figé, avec le lexique visite = rdv : on déclare que « rdv »
 * fait foi depuis `rendezVous`. Toute lecture ailleurs doit être signalée, code 1.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, lireJson, ecrireJson, copieProjetFige, supprimer } from './aide.mjs';

describe('decisions.mjs sur le projet figé', () => {
  let repo, prepa, verif;
  before(() => {
    repo = copieProjetFige();
    ecrireJson(path.join(repo, '.backend', 'lexique.json'), { visite: 'rdv', visites: 'rdv' });
    prepa = lancer('decisions.mjs', [repo]);
    ecrireJson(path.join(repo, '.backend', 'decisions.json'),
      { rdv: { source: 'rendezVous', decide: '2026-09-12', par: 'test' } });
    verif = lancer('decisions.mjs', [repo, '--verifier']);
  });
  after(() => supprimer(repo));

  test('sans décision, prépare les questions dans .backend/questions.json, dont celle sur « rdv »', () => {
    const q = path.join(repo, '.backend', 'questions.json');
    assert.ok(fs.existsSync(q), `questions.json absent. Sortie :\n${prepa.sortie}`);
    const questions = lireJson(q);
    const rdv = questions.find((x) => x.concept === 'rdv');
    assert.ok(rdv, `pas de question sur rdv : ${questions.map((x) => x.concept).join(', ')}`);
    assert.ok(rdv.options.length >= 2);
    assert.equal(prepa.code, 1, 'des questions en attente → code 1');
  });

  test('avec rdv → rendezVous déclaré, --verifier signale toute lecture de rdv ailleurs et sort en code 1', () => {
    assert.equal(verif.code, 1, `code ${verif.code}. Sortie :\n${verif.sortie}`);
    assert.match(verif.stdout, /« rdv » doit venir de rendezVous/);
    assert.match(verif.stdout, /prennent visites/);
    assert.match(verif.stdout, /convex\/visites\.ts:\d+/);
  });

  test('--verifier ne repose pas la question déjà tranchée', () => {
    assert.doesNotMatch(verif.stdout, /Lequel fait foi/);
  });

  test('une décision qui désigne la source réellement dominante ne signale que les autres lectures', () => {
    ecrireJson(path.join(repo, '.backend', 'decisions.json'),
      { rdv: { source: 'visites', decide: '2026-09-12', par: 'test' } });
    const r = lancer('decisions.mjs', [repo, '--verifier']);
    assert.equal(r.code, 1);
    assert.doesNotMatch(r.stdout, /prennent visites/);
    assert.match(r.stdout, /prennent (biens|tableauBord)/);
  });

  test('sans aucune décision, --verifier ne signale rien et sort en code 0', () => {
    fs.unlinkSync(path.join(repo, '.backend', 'decisions.json'));
    const r = lancer('decisions.mjs', [repo, '--verifier']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Aucune décision/);
  });
});
