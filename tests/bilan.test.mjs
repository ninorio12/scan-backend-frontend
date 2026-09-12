/**
 * bilan.test.mjs : le baromètre, sur des .backend/ fabriqués.
 *
 * fixtures/backend-sain/.backend/ décrit un projet entièrement regardé et propre. Chaque
 * cas part de là et n'y change qu'une chose, pour que le niveau obtenu soit imputable à
 * cette seule chose. Les niveaux sont reconnus à un mot stable (INCONNU, NE PAS LIVRER,
 * RÉSERVES, DETTE, SAIN), pas à leur formulation complète. Les libellés du tableau sont
 * ceux du design validé : « trompe l'utilisateur », « non regardé ».
 */
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { lancer, lireJson, ecrireJson, dossierJetable, supprimer, FIXTURES } from './aide.mjs';

const jetables = [];
after(() => jetables.forEach(supprimer));

function projetAvec(modifs = {}) {
  const repo = dossierJetable('scan-bilan-');
  jetables.push(repo);
  const src = path.join(FIXTURES, 'backend-sain', '.backend');
  fs.mkdirSync(path.join(repo, '.backend'));
  for (const f of fs.readdirSync(src)) fs.copyFileSync(path.join(src, f), path.join(repo, '.backend', f));
  for (const [f, contenu] of Object.entries(modifs)) {
    const p = path.join(repo, '.backend', f);
    if (contenu === null) fs.unlinkSync(p);
    else ecrireJson(p, typeof contenu === 'function' ? contenu(lireJson(p)) : contenu);
  }
  return repo;
}

const bilan = (repo) => {
  const run = lancer('bilan.mjs', [repo]);
  const md = path.join(repo, '.backend', 'BILAN.md');
  return { ...run, md: fs.existsSync(md) ? fs.readFileSync(md, 'utf8') : '' };
};

describe('bilan.mjs', () => {
  test('un projet entièrement regardé et sans défaut est SAIN, code 0', () => {
    const r = bilan(projetAvec());
    assert.equal(r.code, 0, r.sortie);
    assert.match(r.stdout, /SAIN/);
    assert.doesNotMatch(r.stdout, /INCONNU|DETTE|RÉSERVES|NE PAS LIVRER/);
  });

  test('avec un « non couvert » non vide, le niveau est INCONNU et le code de sortie 2', () => {
    const r = bilan(projetAvec({ 'couverture.json': (c) => ({ ...c, raccourcis: ['l\'écran /modules/visites n\'a pas été cliqué'] }) }));
    assert.equal(r.code, 2, r.sortie);
    assert.match(r.stdout, /INCONNU/);
    assert.match(r.md, /modules\/visites n'a pas été cliqué/);
  });

  test('un outil qui n\'a pas tourné (pas de liens.json) rend aussi le niveau INCONNU', () => {
    const r = bilan(projetAvec({ 'liens.json': null }));
    assert.equal(r.code, 2, r.sortie);
    assert.match(r.stdout, /INCONNU/);
  });

  test('avec un défaut « fausse donnée affichée », le niveau est rouge : À NE PAS LIVRER (trompe l\'utilisateur)', () => {
    const r = bilan(projetAvec({ 'fausses.json': (f) => ({ ...f, affiches: [{ valeur: 'Marc Lefèvre', type: 'nom', semeur: 'convex/seed.ts', ou: 'app/page.tsx:12' }] }) }));
    assert.equal(r.code, 1, r.sortie);
    assert.match(r.stdout, /NE PAS LIVRER|TROMPE/i);
    assert.match(r.stdout, /trompe l'utilisateur\s+1\b/);
    assert.doesNotMatch(r.stdout, /INCONNU|DETTE/);
  });

  test('avec seulement des « plusieurs sources », le niveau est DETTE', () => {
    const r = bilan(projetAvec({ 'lexical.json': (l) => ({ ...l, sourcesMultiples: [{ concept: 'bien', sources: [{ table: 'biens', n: 5, ou: ['convex/biens.ts:72'] }, { table: 'offres', n: 1, ou: ['convex/offres.ts:104'] }] }] }) }));
    assert.equal(r.code, 1, r.sortie);
    assert.match(r.stdout, /DETTE/);
    assert.doesNotMatch(r.stdout, /INCONNU|NE PAS LIVRER|RÉSERVES/);
  });

  test('avec seulement un bouton mort, le niveau est orange : LIVRABLE AVEC RÉSERVES', () => {
    const r = bilan(projetAvec({ 'clics_accueil.json': (c) => ({ ...c, verdicts: [...c.verdicts, { libelle: 'Exporter', verdict: 'MORT', pourquoi: 'aucune requête, aucun changement, aucun message', href: null }] }) }));
    assert.equal(r.code, 1, r.sortie);
    assert.match(r.stdout, /RÉSERVES/);
    assert.doesNotMatch(r.stdout, /INCONNU|NE PAS LIVRER|DETTE/);
  });

  test('« annonce un succès sans écrire » (D2) trompe l\'utilisateur : rouge, pas dette', () => {
    const r = bilan(projetAvec({ 'scan.json': (s) => ({ ...s, constats: [{
      regle: 'D2', fichier: 'app/modules/biens/page.tsx', ligne: 40, reponse: 'DÉSACCORD', attribut: 'existence',
      titre: '« Enregistrer » annonce un succès sans rien écrire', ou: 'app/modules/biens/page.tsx:40',
      detail: 'le toast « Enregistré » part avant toute mutation, et aucune mutation ne suit',
    }] }) }));
    assert.equal(r.code, 1, r.sortie);
    assert.match(r.stdout, /NE PAS LIVRER|TROMPE/i, `un bouton qui ment est classé ailleurs qu'en tromperie :\n${r.stdout}`);
  });

  test('la tromperie l\'emporte sur la quantité : 1 fausse donnée affichée + 50 dettes = rouge', () => {
    const dettes = Array.from({ length: 50 }, (_, i) => ({ concept: `concept${i}`, sources: [{ table: 'a', n: 1, ou: [] }, { table: 'b', n: 1, ou: [] }] }));
    const r = bilan(projetAvec({
      'lexical.json': (l) => ({ ...l, sourcesMultiples: dettes }),
      'fausses.json': (f) => ({ ...f, affiches: [{ valeur: 'Sophie Martin', type: 'nom', semeur: 'convex/seed.ts', ou: 'app/page.tsx:3' }] }),
    }));
    assert.match(r.stdout, /NE PAS LIVRER|TROMPE/i);
    assert.match(r.stdout, /dette\s+50\b/);
  });

  test('écrit BILAN.md avec ses trois sections : Trouvé, Résolu, Non regardé', () => {
    const r = bilan(projetAvec());
    assert.match(r.md, /## Trouvé/);
    assert.match(r.md, /## Résolu/);
    assert.match(r.md, /## Non regardé/);
  });
});
