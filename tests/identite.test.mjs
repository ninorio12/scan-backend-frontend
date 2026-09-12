/**
 * identite.test.mjs : on ne clique QUE dans l'application de ce projet.
 *
 * Le 12/09/2026, `couverture.mjs` a cliqué 15 éléments dans l'application d'un client
 * qui tournait sur :3000, alors que `reconnaitre.mjs` avait écrit « non confirmée ».
 * Il fabriquait `http://localhost:3000` par défaut et se contentait de vérifier que
 * quelque chose répondait. Ce fichier verrouille la règle, dans les deux sens : une
 * application non confirmée n'ouvre rien, une application confirmée ouvre bien.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { porteIdentite } from '../scripts/identite.mjs';

const CONFIRMEE = {
  urlVivante: 'http://localhost:3000/',
  application: { url: 'http://localhost:3000', statut: 'confirmée', detail: 'titre « Tableau de bord » déclaré par ce projet' },
};
const ETRANGERE = {
  urlVivante: null,
  commandeDev: 'npm run dev',
  application: { url: 'http://localhost:3000', statut: 'non confirmée', detail: 'la page servie a pour titre « Autre produit »' },
};
const ETEINTE = { urlVivante: null, commandeDev: 'npm run dev', application: { statut: 'éteinte' } };

describe('la porte d\'identité', () => {
  test('une application confirmée ouvre le côté écran', () => {
    const p = porteIdentite(CONFIRMEE, null);
    assert.equal(p.ok, true);
    assert.equal(p.url, 'http://localhost:3000', 'la barre finale est retirée');
  });

  test('une application ÉTRANGÈRE qui répond n\'ouvre rien, et aucune URL n\'est inventée', () => {
    const p = porteIdentite(ETRANGERE, null);
    assert.equal(p.ok, false, 'c\'est le défaut du 12/09 : vivante mais non confirmée');
    assert.equal(p.url, '', 'aucune URL par défaut ne doit être fabriquée');
    assert.match(p.raison, /NON CONFIRMÉE/);
    assert.match(p.raison, /Autre produit/, 'la raison nomme ce qui a été servi');
  });

  test('application éteinte : refus, avec la commande pour la lancer', () => {
    const p = porteIdentite(ETEINTE, null);
    assert.equal(p.ok, false);
    assert.match(p.raison, /ne répond sur aucun port/);
    assert.match(p.raison, /npm run dev/);
  });

  test('sans reconnaissance du tout : refus, jamais un localhost:3000 de confiance', () => {
    const p = porteIdentite(null, null);
    assert.equal(p.ok, false);
    assert.equal(p.url, '');
  });

  test('--url explicite : la personne qui lance assume, même sur une application étrangère', () => {
    const p = porteIdentite(ETRANGERE, 'http://localhost:3100/');
    assert.equal(p.ok, true);
    assert.equal(p.url, 'http://localhost:3100');
    assert.match(p.raison, /assumée/);
  });
});
