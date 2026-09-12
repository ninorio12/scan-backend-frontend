/**
 * audit-backend.test.mjs : le scanner seul : il tourne, il désigne, et il ne prend pas
 * « largeur » pour une devise.
 *
 * Régression connue : la règle E5 cherchait « eur » n'importe où dans un nom de
 * constante (`const largeurColonne = 0.125` sortait en « taux de change écrit en dur »).
 */
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lancer, copieProjetFige, supprimer, FIXTURES } from './aide.mjs';

const lireFindings = (run) => {
  try { return JSON.parse(run.stdout).findings || []; } catch { return null; }
};

describe('audit-backend.mjs sur le projet largeur', () => {
  let run, findings;
  before(() => {
    run = lancer('audit-backend.mjs', [path.join(FIXTURES, 'projet-largeur'), '--json', '--full']);
    findings = lireFindings(run);
  });

  test('détecte la stack Convex du projet', () => {
    const l = lancer('audit-backend.mjs', [path.join(FIXTURES, 'projet-largeur'), '--list-stacks']);
    assert.match(l.stdout, /Détectés dans projet-largeur : .*convex/i, l.sortie);
  });

  test('E5 signale le vrai taux de change écrit en dur (0.7961)', () => {
    assert.ok(findings, `sortie JSON illisible :\n${run.sortie}`);
    const e5 = findings.find((f) => f.id === 'E5');
    assert.ok(e5, 'E5 absent : le taux USD→CHF écrit en dur n\'est pas vu');
    assert.ok(e5.items.some((i) => /conversion\.ts:\d+.*0\.7961/.test(i)), e5.items.join('\n'));
  });

  test('E5 ne prend pas « largeur » ni « hauteur » pour une devise', () => {
    assert.ok(findings, 'sortie JSON illisible');
    const e5 = findings.find((f) => f.id === 'E5');
    const faux = (e5?.items || []).filter((i) => /mise-en-page|0\.125|1\.333/.test(i));
    assert.deepEqual(faux, [], `faux positifs E5 :\n${faux.join('\n')}`);
  });
});

describe('audit-backend.mjs sur le projet figé', () => {
  let repo, run, findings;
  before(() => {
    repo = copieProjetFige();
    run = lancer('audit-backend.mjs', [repo, '--json', '--full']);
    findings = lireFindings(run);
  });
  after(() => supprimer(repo));

  test('sort du JSON avec des findings, chacun portant un identifiant de règle et des endroits', () => {
    assert.ok(findings && findings.length > 0, `pas de findings :\n${run.sortie.slice(0, 500)}`);
    for (const f of findings) {
      assert.match(f.id, /^[A-Z]\d+[a-z]?$/, `règle sans identifiant : ${JSON.stringify(f).slice(0, 120)}`);
      assert.ok(f.items.length > 0, `${f.id} sans endroit`);
    }
  });

  test('désigne des endroits fichier:ligne, et sort en code 1 puisqu\'il a trouvé', () => {
    const endroits = findings.flatMap((f) => f.items).filter((i) => /[\w./-]+\.\w+:\d+/.test(String(i)));
    assert.ok(endroits.length >= 20, `${endroits.length} endroits désignés seulement`);
    assert.equal(run.code, 1);
  });
});
