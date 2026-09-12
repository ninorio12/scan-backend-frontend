/**
 * familles-corpus.mjs — Ce que le corpus réel a fait apparaître et que la taxonomie des 26
 * familles ne nommait pas.
 *
 * MÊME DISCIPLINE QUE banc/mesure/familles.mjs : une famille est nommée d'après le SYMPTÔME
 * VU PAR LE CLIENT, jamais d'après un détecteur. Aucune règle n'est écrite pour elles : c'est
 * précisément ce qu'on veut pouvoir mesurer.
 *
 * Les huit classeurs du corpus ont proposé 24 noms. Beaucoup décrivaient le même symptôme sous
 * des mots différents : la table FUSION ci-dessous ramène ces propositions à 13 familles, et
 * chaque fusion porte sa justification. Le nombre de familles nouvelles n'est pas un trophée :
 * une famille à un cas est une famille à un cas, elle est écrite comme telle.
 */

export const FAMILLES_CORPUS = {
  CONSIGNE_IA_NON_TENUE:
    'une règle du produit est confiée à la consigne d’un modèle au lieu d’être appliquée par le code : le modèle tourne en rond, s’arrête, récite, invente, ou rend toujours la même chose',
  ETAT_TRANSITOIRE_TROMPEUR:
    'pendant le chargement, l’écran montre une valeur périmée, un substitut ou une valeur tirée au hasard, puis bascule visiblement sur la vraie',
  ECRITURE_PARTIELLE:
    'l’écriture change un champ et oublie ce qui en dépend : une branche omet ce que l’autre fait, une donnée dérivée n’est pas propagée, les dates de l’état précédent restent',
  GARDE_EXCESSIVE:
    'la garde refuse à qui a le droit : le verrou est posé plus large que le périmètre qu’il devait protéger',
  ETAT_PREEXISTANT_IGNORE:
    'le code refait ce qui est déjà fait : la session est déjà ouverte, il tente d’en créer une et affiche une erreur',
  TYPE_DIVERGENT:
    'le type réellement stocké contredit le type déclaré : la valeur est rejetée à l’écriture ou lue comme vide',
  ETAT_PERIME:
    'le serveur reçoit une version périmée de l’objet : ce que l’écran affiche ne lui est jamais transmis',
  SOURCE_PARTIELLE:
    'une seule des liaisons possibles est lue : des comptes bien connectés sont déclarés absents',
  LIEN_EXTERNE_PERISSABLE:
    'on stocke un lien signé du fournisseur au lieu de copier le média : l’écran se vide avec le temps',
  DONNEE_DEGRADEE:
    'la vignette du fournisseur est présentée comme l’original : l’agrandissement affiche du 64×64',
  RATTRAPAGE_INERTE:
    'un enregistrement créé avant un changement de règle ne rattrape jamais le nouveau format, et la régénération ne le rattrape pas non plus',
  FILTRE_TEXTE_INEXACT:
    'un nettoyage de texte est trop large ou trop étroit : il laisse passer des bribes inventées, ou mange du contenu réel',
  GESTE_INERTE:
    'le geste est écouté d’une manière qui interdit d’y répondre (écouteur passif, ressource non libérée) : le bouton ou le tirer-pour-rafraîchir semble mort',
  ALERTE_FAUSSE:
    'un contrôle automatique du projet signale comme cassé un élément qui fonctionne',
};

/** Propositions des classeurs → famille retenue. Chaque ligne dit pourquoi. */
export const FUSION = {
  // — Le modèle ne fait pas ce que le produit promet. Vingt-deux commits, un seul symptôme :
  //   la règle vit dans une consigne, donc elle n'est pas tenue.
  DERIVE_MODELE_IA: 'CONSIGNE_IA_NON_TENUE',
  CONSIGNE_IA_CONTRE_PRODUCTIVE: 'CONSIGNE_IA_NON_TENUE',
  CONSIGNE_IA_NON_TENUE: 'CONSIGNE_IA_NON_TENUE',
  ENTREE_PRISE_POUR_CONSIGNE: 'CONSIGNE_IA_NON_TENUE',   // la dictée prise pour un ordre : même cause
  GENERATION_REPETEE: 'CONSIGNE_IA_NON_TENUE',           // toujours le même persona : la variété était laissée au modèle
  ETAPE_VALIDEE_TROP_TOT: 'CONSIGNE_IA_NON_TENUE',       // le critère « bloc terminé » vivait dans la consigne

  // — L'écran montre autre chose que la donnée, le temps d'un chargement ou d'un rendu.
  ETAT_TRANSITOIRE_TROMPEUR: 'ETAT_TRANSITOIRE_TROMPEUR',
  RENDU_NON_DETERMINISTE: 'ETAT_TRANSITOIRE_TROMPEUR',   // la photo change à chaque rendu : même instabilité vue de l'écran

  // — L'écriture est incomplète. Trois formulations, un symptôme : le champ principal bouge,
  //   ses satellites non.
  DERIVE_NON_PROPAGEE: 'ECRITURE_PARTIELLE',
  BRANCHE_INCOMPLETE: 'ECRITURE_PARTIELLE',
  ETAT_RESIDUEL: 'ECRITURE_PARTIELLE',

  // — Le miroir de GARDE_EFFACEE, qu'aucune règle ne cherche : la garde de trop.
  GARDE_EXCESSIVE: 'GARDE_EXCESSIVE',
  GARDE_TROP_LARGE: 'GARDE_EXCESSIVE',

  // — Les deux cas de session déjà ouverte, même fichier, même aveuglement.
  ETAT_PREEXISTANT_IGNORE: 'ETAT_PREEXISTANT_IGNORE',
  AIGUILLAGE_ERRONE: 'ETAT_PREEXISTANT_IGNORE',

  // — Une seule fusion vers une famille EXISTANTE, et elle est littérale : le titre de la règle
  //   E2 est « Tables partagées lues sans leur discriminant ». Le compteur d'abonnés LinkedIn
  //   écrit sur la ligne YouTube EST ce symptôme, le discriminant n'étant pas le client mais la
  //   plateforme. Aucune autre proposition n'est reversée dans les 26 familles : gonfler une
  //   famille existante reviendrait à créditer un détecteur qui ne cherche pas ce cas-là.
  FILTRE_SOURCE_MANQUANT: 'LOCATAIRE',

  // — Restent telles quelles, un cas chacune. On ne les grossit pas artificiellement.
  TYPE_DIVERGENT: 'TYPE_DIVERGENT',
  ETAT_PERIME: 'ETAT_PERIME',
  SOURCE_PARTIELLE: 'SOURCE_PARTIELLE',
  LIEN_EXTERNE_PERISSABLE: 'LIEN_EXTERNE_PERISSABLE',
  DONNEE_DEGRADEE: 'DONNEE_DEGRADEE',
  RATTRAPAGE_INERTE: 'RATTRAPAGE_INERTE',
  FILTRE_TEXTE_INEXACT: 'FILTRE_TEXTE_INEXACT',
  GESTE_INERTE: 'GESTE_INERTE',
  RESSOURCE_NON_LIBEREE: 'GESTE_INERTE',                 // le micro mort au second clic : le geste ne répond plus
  ALERTE_FAUSSE: 'ALERTE_FAUSSE',
};

/** Nom de famille final pour une étiquette de classeur (« NOUVELLE:X » ou une famille connue). */
export function familleFinale(brut) {
  const s = String(brut || '').trim();
  const nom = s.startsWith('NOUVELLE:') ? s.slice(9).trim() : s;
  return FUSION[nom] || nom;
}
