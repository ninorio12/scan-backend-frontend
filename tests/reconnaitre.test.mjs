/**
 * reconnaitre.test.mjs : le skill lit le projet figé et dit ce qu'il a compris.
 *
 * Attendus relevés à la main dans fixtures/fige-attendu.json. Le projet figé n'est
 * jamais lancé. Pour prouver qu'un port qui répond n'est pas attribué au projet, le
 * test sert lui-même une application étrangère (un écran de connexion d'un autre
 * produit) sur l'un des ports que reconnaitre sonde : elle doit être nommée, marquée
 * « NON CONFIRMÉE » avec sa raison, et jamais prise pour ce projet. C'est le trou payé
 * quand une instance a failli auditer l'écran d'un autre client.
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { lancerAsync, lireJson, copieProjetFige, supprimer, FIXTURES } from './aide.mjs';

const attendu = lireJson(path.join(FIXTURES, 'fige-attendu.json'));

/* Les ports que reconnaitre sonde en plus de celui du projet. On en prend un de libre. */
const PORTS_SONDES = [3100, 3001, 8080, 5173];
const PAGE_ETRANGERE = `<!doctype html><html><head><title>Autre produit</title></head>
<body><h1>Sign in</h1><form><input type="email"><input type="password"><button>Sign in</button></form>
<p>Welcome back to Autre produit. Please sign in to continue.</p></body></html>`;

function servirEtrangere() {
  return new Promise((resolve) => {
    const essayer = (i) => {
      if (i >= PORTS_SONDES.length) return resolve(null);
      const s = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(PAGE_ETRANGERE); });
      s.once('error', () => essayer(i + 1));
      s.listen(PORTS_SONDES[i], '127.0.0.1', () => resolve({ port: PORTS_SONDES[i], fermer: () => new Promise((r) => s.close(() => r())) }));
    };
    essayer(0);
  });
}

describe('reconnaitre.mjs sur le projet figé', () => {
  let repo, run, C, etrangere;
  before(async () => {
    etrangere = await servirEtrangere();
    repo = copieProjetFige();
    const json = path.join(repo, 'reconnaissance.json');
    // lancerAsync, pas lancer : le serveur étranger vit dans ce processus, spawnSync le gèlerait.
    run = await lancerAsync('reconnaitre.mjs', [repo, '--json', json]);
    C = fs.existsSync(json) ? lireJson(json) : null;
  });
  after(async () => { supprimer(repo); if (etrangere) await etrangere.fermer(); });

  test('reconnaît le cadre Next.js et la base Convex', () => {
    assert.ok(C, `pas de JSON produit. Sortie :\n${run.sortie}`);
    assert.equal(C.cadre, attendu.cadre);
    assert.equal(C.base, attendu.base);
  });

  test(`trouve les ${attendu.pages} pages, dont ${attendu.pagesDynamiques} à identifiant`, () => {
    assert.ok(C, 'pas de JSON produit');
    assert.equal(C.pages.length, attendu.pages, `pages : ${C.pages.map((p) => p.route).join(', ')}`);
    assert.equal(C.pages.filter((p) => p.dynamique).length, attendu.pagesDynamiques);
  });

  test(`trouve les ${attendu.tables} tables du schéma`, () => {
    assert.ok(C, 'pas de JSON produit');
    assert.deepEqual([...C.tables].sort(), [...attendu.nomsTables].sort());
  });

  test('ne trouve aucune authentification, et le dit', () => {
    assert.ok(C, 'pas de JSON produit');
    assert.equal(C.auth, null);
    assert.match(run.stdout, /aucune authentification/);
  });

  test('n\'attribue à ce projet aucune application qui répond : rien ne tourne pour lui', () => {
    assert.ok(C, 'pas de JSON produit');
    assert.equal(C.urlVivante, null, `attribuée : ${C.urlVivante}`);
    const confirmees = (C.applications || []).filter((a) => /^confirm/i.test(a.statut || ''));
    assert.deepEqual(confirmees, [], `application(s) confirmée(s) à tort : ${JSON.stringify(confirmees)}`);
  });

  test('une application étrangère qui répond sur un port sondé est nommée « NON CONFIRMÉE », avec sa raison', (t) => {
    if (!etrangere) return t.skip(`aucun port libre parmi ${PORTS_SONDES.join(', ')} pour servir l'application étrangère`);
    assert.ok(C, 'pas de JSON produit');
    const url = `http://localhost:${etrangere.port}`;
    const app = (C.applications || []).find((a) => a.url === url);
    assert.ok(app, `l'application étrangère sur ${url} n'est pas listée : ${JSON.stringify(C.applications)}`);
    assert.match(app.statut || '', /non confirm/i, `statut « ${app.statut} »`);
    assert.ok(app.detail && app.detail.length > 10, 'aucune raison donnée');
    assert.match(run.stdout, /NON CONFIRMÉE/);
    /* Le titre de la page étrangère est porté par la carte (JSON). Sur la sortie lisible,
       seule la première application non confirmée est détaillée : si d'autres ports
       répondent sur la machine, celle du test peut ne pas y figurer. */
    assert.equal(app.titre, 'Autre produit', 'le titre de la page étrangère doit être relevé, pour qu\'on voie tout de suite que ce n\'est pas ce projet');
  });

  test('ne trouve aucun fichier d\'injection de fausses données dans ce projet', () => {
    assert.ok(C, 'pas de JSON produit');
    assert.deepEqual(C.semeurs, []);
  });
});
