/**
 * clics.test.mjs : ce que clics.mjs doit prouver sur une page qu'on maîtrise.
 *
 * La page est servie par node:http (fixtures/pages.mjs) : 25 éléments cliquables dont
 * on connaît le comportement un par un. Le serveur enregistre toute écriture reçue :
 * c'est la preuve, indépendante du format de sortie, que le script n'a rien écrit.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancerAsync, lireJson, dossierJetable, supprimer, portFerme, navigateurDisponible, CONCLUSION_INTERDITE } from '../aide.mjs';
import { demarrerServeur, BOUTONS } from '../fixtures/pages.mjs';

const manque = await navigateurDisponible();
const skip = manque ? `Playwright absent, les tests navigateur ne peuvent pas tourner : ${manque}` : false;

const par = (R, v) => (R?.verdicts || []).filter((x) => x.verdict === v).map((x) => x.libelle);
const libellesCliques = (R) => (R?.verdicts || []).map((x) => x.libelle);
/* Contrat imposé au JSON de clics : `cliques` (nombre), et tout élément non cliqué est
   EXPLIQUÉ dans une liste nommée : `ecartes` (ce qui écrit ou détruit), `non_cliques`
   (avec sa raison), `inclus` (dans un parent cliquable). Un nombre seul compte aussi,
   mais n'explique rien. */
const taille = (x) => Array.isArray(x) ? x.length : Number(x) || 0;
const nbExpliques = (R) => taille(R?.ecartes) + taille(R?.non_cliques) + taille(R?.inclus);

describe('clics.mjs sur la page de 25 boutons', { skip }, () => {
  let srv, run, R;
  const json = path.join(dossierJetable(), 'clics.json');

  before(async () => {
    srv = await demarrerServeur();
    run = await lancerAsync('clics.mjs', [`${srv.url}/`, '--json', json], { timeout: 80000 });
    R = fs.existsSync(json) ? lireJson(json) : null;
  }, { timeout: 90000 });
  after(async () => { await srv.fermer(); supprimer(path.dirname(json)); });

  test('écrit son JSON et recense les 25 éléments cliquables', { timeout: 30000 }, () => {
    assert.ok(R, `pas de JSON produit. Sortie :\n${run.sortie}`);
    assert.equal(R.recenses, BOUTONS.total);
  });

  test('clique ou explique au moins 23 des 25 (le bug des 16 : abandon silencieux après une mutation du DOM)', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const comptes = R.cliques + nbExpliques(R);
    assert.ok(comptes >= 23,
      `${R.cliques} cliqués + ${nbExpliques(R)} expliqués = ${comptes} sur ${R.recenses} recensés. `
      + `Les ${R.recenses - comptes} autres ont disparu sans explication (le bouton « ${BOUTONS.replie} » replie une section de ${BOUTONS.sectionB.length} boutons).`);
  });

  test('les trois boutons sans effet sortent en MORT, et aucun autre', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const morts = par(R, 'MORT').sort();
    assert.deepEqual(morts, [...BOUTONS.morts].sort());
  });

  test('les deux boutons qui affichent une erreur sortent en ERREUR', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const erreurs = par(R, 'ERREUR');
    for (const l of BOUTONS.erreurs) assert.ok(erreurs.includes(l), `« ${l} » n'est pas en ERREUR (verdicts : ${JSON.stringify(R.verdicts.filter((v) => v.libelle === l))})`);
  });

  test('ne clique jamais ce qui écrit : le serveur ne reçoit aucune écriture', { timeout: 30000 }, () => {
    assert.equal(srv.ecritures.length, 0,
      `le serveur a reçu ${srv.ecritures.length} écriture(s) : ${srv.ecritures.map((e) => `${e.methode} ${e.label}`).join(', ')}`);
  });

  test('« Enregistrer », le type=submit et le bouton dans un <form> sont écartés nommément, jamais cliqués', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const cliques = libellesCliques(R);
    const texte = run.sortie + '\n' + JSON.stringify(R);
    for (const l of BOUTONS.ecrivent) {
      assert.ok(!cliques.includes(l), `« ${l} » a été cliqué (verdict ${JSON.stringify(R.verdicts.find((v) => v.libelle === l))})`);
      assert.ok(texte.includes(l), `« ${l} » n'est nommé nulle part : un bouton non cliqué doit être écarté nommément, pas passé sous silence`);
    }
  });

  test('sort en code 1 quand des erreurs ont été vues à l\'écran', { timeout: 30000 }, () => {
    assert.equal(run.code, 1, `code ${run.code}. Sortie :\n${run.sortie}`);
  });
});

describe('clics.mjs refuse de conclure quand il n\'a pas de page', { skip }, () => {
  let srv;
  before(async () => { srv = await demarrerServeur(); });
  after(async () => { await srv.fermer(); });

  const refus = (nom, run) => {
    assert.equal(run.code, 2, `${nom} : code ${run.code} au lieu de 2. Sortie :\n${run.sortie}`);
    assert.ok(!CONCLUSION_INTERDITE.test(run.sortie), `${nom} : la sortie conclut alors qu'il n'y a pas de page :\n${run.sortie}`);
  };

  test('sur une URL qui ne répond pas : code 2, ni « OK » ni « Rien à signaler »', { timeout: 30000 }, async () => {
    const port = await portFerme();
    refus('port fermé', await lancerAsync('clics.mjs', [`http://127.0.0.1:${port}/`]));
  });

  test('sur une page 404 : code 2, ni « OK » ni « Rien à signaler »', { timeout: 30000 }, async () => {
    refus('404', await lancerAsync('clics.mjs', [`${srv.url}/inexistant`]));
  });

  test('sur une page de connexion (Sign in, clerk.accounts.dev) : code 2 et dit qu\'il n\'est pas dans l\'application', { timeout: 30000 }, async () => {
    const run = await lancerAsync('clics.mjs', [`${srv.url}/connexion`]);
    refus('connexion', run);
    assert.match(run.sortie, /connexion|login|sign.?in|authentif|pas dans l'application|hors de l'application/i,
      `la sortie ne dit pas qu'on est devant une page de connexion :\n${run.sortie}`);
  });

  test('sur une route qui répond du JSON brut en 400 : code 2, ni « OK » ni « Rien à signaler »', { timeout: 30000 }, async () => {
    refus('json 400', await lancerAsync('clics.mjs', [`${srv.url}/api/brut`]));
  });
});

describe('clics.mjs et le bouton enfant d\'un lien', { skip }, () => {
  let srv, run, R;
  const json = path.join(dossierJetable(), 'clics-enfant.json');
  before(async () => {
    srv = await demarrerServeur();
    run = await lancerAsync('clics.mjs', [`${srv.url}/enfant-lien`, '--json', json], { timeout: 40000 });
    R = fs.existsSync(json) ? lireJson(json) : null;
  }, { timeout: 45000 });
  after(async () => { await srv.fermer(); supprimer(path.dirname(json)); });

  test('le bouton seul et sans effet est MORT, le bouton « Voir » dans un lien ne l\'est pas', { timeout: 30000 }, () => {
    assert.ok(R, `pas de JSON produit. Sortie :\n${run.sortie}`);
    const morts = par(R, 'MORT');
    assert.ok(morts.includes('Sans effet'), `« Sans effet » devrait être MORT (verdicts : ${JSON.stringify(R.verdicts)})`);
    assert.ok(!morts.includes('Voir'), `« Voir » est déclaré MORT alors qu'il est l'enfant d'un lien vers /ailleurs`);
  });

  test('le bouton enfant est rattaché à son lien parent (« inclus dans »), pas jugé une seconde fois seul', { timeout: 30000 }, () => {
    assert.ok(R, 'pas de JSON produit');
    const voir = (R.verdicts || []).filter((v) => v.libelle === 'Voir');
    const rattache = voir.some((v) => /inclus/i.test(`${v.verdict} ${v.pourquoi || ''}`))
      || (R.inclus || []).some((x) => x.libelle === 'Voir');
    assert.ok(voir.length <= 1 && rattache,
      `« Voir » a ${voir.length} verdicts distincts (${voir.map((v) => v.verdict).join(', ')}) : le lien et son bouton enfant sont jugés comme deux éléments indépendants`);
  });
});
