/**
 * apparence.test.mjs : apparence.mjs sur une page dont on connaît les défauts.
 *
 * Régression connue : un SVG de plus de 220×120 faisait planter le contrôle
 * (innerText n'existe pas sur un élément SVG). La page en contient un de 300×200.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancerAsync, lireJson, dossierJetable, supprimer, portFerme, navigateurDisponible, CONCLUSION_INTERDITE } from '../aide.mjs';
import { demarrerServeur } from '../fixtures/pages.mjs';

const manque = await navigateurDisponible();
const skip = manque ? `Playwright absent, les tests navigateur ne peuvent pas tourner : ${manque}` : false;

describe('apparence.mjs sur l\'écran de test (texte qui déborde, contraste illisible, SVG 300×200)', { skip }, () => {
  let srv, run, R;
  const json = path.join(dossierJetable(), 'apparence.json');
  before(async () => {
    srv = await demarrerServeur();
    run = await lancerAsync('apparence.mjs', [`${srv.url}/apparence`, '--json', json], { timeout: 40000 });
    R = fs.existsSync(json) ? lireJson(json) : null;
  }, { timeout: 45000 });
  after(async () => { await srv.fermer(); supprimer(path.dirname(json)); });

  test('ne plante pas sur le SVG de 300×200 : écrit son JSON et son bilan', { timeout: 30000 }, () => {
    assert.ok(R, `pas de JSON produit, le contrôle a planté. Sortie :\n${run.sortie}`);
    assert.match(run.stdout, /APPARENCE/, `la ligne de bilan manque :\n${run.sortie}`);
    assert.ok([0, 1].includes(run.code), `code ${run.code} : ni 0 ni 1. Sortie :\n${run.sortie}`);
  });

  test('signale le texte qui déborde de sa boîte', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const c = (R.constats || []).find((d) => /DÉBORDE|TRONQUÉ/.test(d.type) && /trop long/.test(d.quoi));
    assert.ok(c, `aucun constat DÉBORDE sur « Ce texte est beaucoup trop long… ». Constats : ${JSON.stringify(R.constats)}`);
  });

  test('signale le texte au contraste illisible', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const c = (R.constats || []).find((d) => d.type === 'INVISIBLE' && /quasi invisible/.test(d.quoi));
    assert.ok(c, `aucun constat INVISIBLE sur « Texte quasi invisible… ». Constats : ${JSON.stringify(R.constats)}`);
  });

  test('sort en code 1 puisqu\'il a des constats', { timeout: 30000 }, () => {
    assert.equal(run.code, 1, `code ${run.code}. Sortie :\n${run.sortie}`);
  });
});

describe('apparence.mjs refuse de conclure quand il n\'a pas de page', { skip }, () => {
  let srv;
  before(async () => { srv = await demarrerServeur(); });
  after(async () => { await srv.fermer(); });

  const refus = (nom, run) => {
    assert.equal(run.code, 2, `${nom} : code ${run.code} au lieu de 2. Sortie :\n${run.sortie}`);
    assert.ok(!CONCLUSION_INTERDITE.test(run.sortie), `${nom} : la sortie conclut alors qu'il n'y a pas de page :\n${run.sortie}`);
  };

  test('sur une URL qui ne répond pas : code 2, jamais « Rien à signaler »', { timeout: 30000 }, async () => {
    const port = await portFerme();
    refus('port fermé', await lancerAsync('apparence.mjs', [`http://127.0.0.1:${port}/`]));
  });

  test('sur une page 404 : code 2, jamais « Rien à signaler »', { timeout: 30000 }, async () => {
    refus('404', await lancerAsync('apparence.mjs', [`${srv.url}/inexistant`]));
  });

  test('sur une page de connexion : code 2 et dit qu\'il n\'est pas dans l\'application', { timeout: 30000 }, async () => {
    const run = await lancerAsync('apparence.mjs', [`${srv.url}/connexion`]);
    refus('connexion', run);
    assert.match(run.sortie, /connexion|login|sign.?in|authentif|pas dans l'application|hors de l'application/i,
      `la sortie ne dit pas qu'on est devant une page de connexion :\n${run.sortie}`);
  });

  test('sur une route qui répond du JSON brut en 400 : code 2, jamais « Rien à signaler »', { timeout: 30000 }, async () => {
    refus('json 400', await lancerAsync('apparence.mjs', [`${srv.url}/api/brut`]));
  });
});
