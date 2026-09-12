/**
 * lexique.test.mjs : le socle linguistique : jetons, normalisation, synonymes, unités.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SCRIPTS } from './aide.mjs';

const { jetons, cleNorm, chaineNorm, normJetons, unite, unitesEnDesaccord, jaroWinkler, jaccard, levenshteinNorm } =
  await import(path.join(SCRIPTS, 'lexique.mjs'));

test('cleNorm(« rendezVous ») === cleNorm(« rdv ») : deux graphies, un concept', () => {
  assert.equal(cleNorm('rendezVous'), cleNorm('rdv'));
  assert.equal(cleNorm('rendezVous'), 'rdv');
  assert.equal(cleNorm('rendez_vous'), 'rdv');
  assert.equal(cleNorm('appointment'), 'rdv');
});

test('« largeur » ne contient pas « eur » : ni devise, ni unité monétaire', () => {
  assert.equal(unite('largeur'), null);
  assert.equal(unite('hauteurLigne'), null);
  assert.equal(cleNorm('largeur'), 'largeur');
  assert.ok(!normJetons('largeurColonne').includes('eur'));
});

test('jetons découpe camelCase avant de passer en minuscules (régression : « eventId » restait un seul jeton)', () => {
  assert.deepEqual(jetons('eventId'), ['event', 'id']);
  assert.deepEqual(jetons('montantHT'), ['montant', 'ht']);
  assert.deepEqual(jetons('crm_evenements'), ['crm', 'evenements']);
  assert.deepEqual(jetons('HTMLParser'), ['html', 'parser']);
});

test('les mots vides et les préfixes techniques (get, fetch, use) disparaissent de la clé', () => {
  assert.equal(cleNorm('getVisitesDeLaSemaine'), cleNorm('visitesSemaine'));
  assert.equal(cleNorm('useClient'), 'client');
});

test('cleNorm est indépendante de l\'ordre, chaineNorm ne l\'est pas', () => {
  assert.equal(cleNorm('prixMoyen'), cleNorm('moyenPrix'));
  assert.notEqual(chaineNorm('prixMoyen'), chaineNorm('moyenPrix'));
});

test('les synonymes métier généraux se rejoignent (bien / property, client / customer, tâche / task)', () => {
  assert.equal(cleNorm('property'), cleNorm('bien'));
  assert.equal(cleNorm('customers'), cleNorm('client'));
  assert.equal(cleNorm('tasks'), cleNorm('tache'));
});

test('montantHT et montantTTC ont la même famille et des unités en désaccord', () => {
  assert.equal(unite('montantHT'), 'monnaie.ht');
  assert.equal(unite('montantTTC'), 'monnaie.ttc');
  assert.ok(unitesEnDesaccord(unite('montantHT'), unite('montantTTC')));
});

test('une unité monétaire indéterminée n\'est jamais en désaccord (on ne sait pas, on ne crie pas)', () => {
  assert.equal(unite('montant'), 'monnaie.indeterminee');
  assert.ok(!unitesEnDesaccord(unite('montant'), unite('montantHT')));
});

test('des familles différentes ne sont pas en désaccord', () => {
  assert.ok(!unitesEnDesaccord('monnaie.ht', 'temps.jours'));
  assert.ok(!unitesEnDesaccord(null, 'monnaie.ht'));
});

test('jaroWinkler : 1 pour deux chaînes égales, 0 pour une chaîne vide, entre les deux sinon', () => {
  assert.equal(jaroWinkler('visite', 'visite'), 1);
  assert.equal(jaroWinkler('', 'visite'), 0);
  const s = jaroWinkler('visites', 'visite');
  assert.ok(s > 0.9 && s < 1, `score ${s}`);
  assert.ok(jaroWinkler('visite', 'offre') < 0.7);
});

test('jaccard et levenshteinNorm : les cas limites', () => {
  assert.equal(jaccard(['a', 'b'], ['a', 'b']), 1);
  assert.equal(jaccard(['a'], ['b']), 0);
  assert.equal(jaccard([], ['b']), 0);
  assert.equal(levenshteinNorm('export', 'export'), 1);
  assert.ok(levenshteinNorm('export', 'exports') > 0.8);
  assert.equal(levenshteinNorm('', 'x'), 0);
});
