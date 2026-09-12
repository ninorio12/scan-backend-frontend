/**
 * identite.mjs : QUI a le droit d'être cliqué.
 *
 * POURQUOI CE FICHIER EXISTE
 *
 * Le 12/09/2026, `couverture.mjs` a cliqué 15 éléments dans l'application d'un CLIENT
 * qui tournait sur le port 3000, alors que `reconnaitre.mjs` avait écrit noir sur blanc
 * « non confirmée ». Il ne lisait pas ce verdict : il fabriquait `http://localhost:3000`
 * par défaut et se contentait de vérifier que quelque chose répondait. Les gardes de
 * `clics.mjs` ont tenu (rien d'écrit, rien de détruit), mais c'est la deuxième barrière
 * qui a tenu quand la première avait manqué.
 *
 * La règle, sortie ici pour être vérifiable en une ligne et partagée par tout ce qui
 * ouvre un navigateur :
 *
 *   1. `--url` explicite : la personne qui lance assume, on y va.
 *   2. Sinon, l'application doit être CONFIRMÉE par reconnaitre.mjs (`urlVivante`).
 *   3. Sinon : rien n'est cliqué, et on dit pourquoi. Aucune URL n'est inventée.
 */

/**
 * @param {object|null} carte  le contenu de .backend/reconnaissance.json
 * @param {string|null} urlDemandee  la valeur de --url, si elle a été donnée
 * @returns {{ok: boolean, url: string, raison: string}}
 */
export function porteIdentite(carte, urlDemandee = null) {
  const url = (urlDemandee || carte?.urlVivante || '').replace(/\/$/, '');
  if (urlDemandee) return { ok: true, url, raison: `--url ${url} : assumée par la personne qui lance` };
  if (url) return { ok: true, url, raison: `application confirmée : ${carte?.application?.detail || 'reconnue par reconnaitre.mjs'}` };

  const ap = carte?.application;
  if (!carte || !ap || ap.statut === 'éteinte') {
    return { ok: false, url: '',
      raison: `l'application ne répond sur aucun port de ce projet${carte?.commandeDev ? ` (la lancer : ${carte.commandeDev})` : ''}` };
  }
  return { ok: false, url: '',
    raison: `application NON CONFIRMÉE sur ${ap.url || 'le port testé'} : ${ap.detail || 'ce n\'est pas ce projet'}` };
}
