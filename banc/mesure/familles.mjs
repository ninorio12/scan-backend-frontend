/**
 * familles.mjs — La taxonomie des défauts de câblage, et la carte règle → famille.
 *
 * DEUX RÈGLES D'ÉCRITURE, qui font tout l'intérêt du fichier :
 *
 * 1. Les FAMILLES sont nommées d'après le SYMPTÔME VU PAR LE CLIENT, jamais d'après un
 *    détecteur. Une famille peut donc exister sans qu'aucune règle ne la couvre : c'est
 *    exactement ce qu'on veut pouvoir mesurer. Une taxonomie dérivée des détecteurs aurait,
 *    par construction, 100 % de couverture, et ne dirait rien.
 * 2. La carte REGLE → FAMILLE est écrite à partir du TITRE que la règle se donne (ce qu'elle
 *    prétend chercher), jamais à partir de ce qu'on l'a vue sortir.
 */

export const FAMILLES = {
  CONTRAT:            'la colonne affichée n’est pas dans la projection renvoyée',
  ACTION_MUETTE:      'le bouton annonce un succès, rien n’est écrit côté serveur',
  PLANIFIE_INERTE:    'la tâche planifiée ne fait pas ce que son nom dit',
  PORTE_PARALLELE:    'la garde existe sur un chemin, un second chemin l’ignore',
  CHIFFRE_INVENTE:    'un cas limite produit un chiffre fabriqué (0 lead → 100 %)',
  PERIODE_DIVERGENTE: 'deux fenêtres temporelles différentes sur le même écran',
  LOCATAIRE:          'lecture d’une table partagée sans son filtre de locataire',
  DRILLDOWN:          'le chiffre cliqué ne se retrouve pas dans l’écran de destination',
  IDEMPOTENCE:        'la déduplication ne dédoublonne rien (clé jamais écrite)',
  VOCABULAIRE:        'une valeur envoyée hors du vocabulaire du schéma → liste vide',
  ECRITURE_VOLANTE:   'écriture lancée sans être attendue (await manquant)',
  PANNE_DEGUISEE:     'une panne ressort en donnée neutre ou en succès',
  UNITE_DIVERGENTE:   'deux grandeurs (HT/TTC, €/cts) sous un même libellé',
  GARDE_EFFACEE:      'la vérification se désactive quand la config manque',
  REGLAGE_INERTE:     'un réglage stocké et affiché que rien ne lit',
  DEFINITION_DOUBLE:  'deux définitions du même terme métier, deux chiffres',
  CIBLE_INEXISTANTE:  'appel vers une route, une page ou une fonction qui n’existe pas',
  AGREGAT_PARTIEL:    'le total est calculé sur l’échantillon ramené, pas sur la période',
  ORDRE_IMPLICITE:    'first() sans tri : on montre la plus ancienne pour la dernière',
  CASCADE_MANQUANTE:  'suppression d’un parent sans ses enfants → orphelins comptés',
  CODE_MORT:          'une unité ou une table que plus rien ne relie à l’interface',
  ENV_MANQUANTE:      'une variable attendue par le code, absente du déploiement',
  SECRET_EXPOSE:      'un secret lisible depuis le dépôt ou le bundle client',
  ENTREE_NON_VALIDEE: 'une porte publique qui accepte n’importe quel corps',
  ETAT_ECRASE:        'une écriture de statut ignore l’état courant et fait revivre un objet clos',
  RECHERCHE_MUETTE:   'un champ de recherche ne trouve jamais ce qui existe (casse, accent, trim)',
};

/** Carte règle → famille, dérivée des titres que les 48 règles se donnent. */
export const REGLE_FAMILLE = {
  A1: 'CODE_MORT', A2: 'CODE_MORT', A3: 'CODE_MORT', A4: 'CIBLE_INEXISTANTE', A5: 'ENV_MANQUANTE',
  B1: 'LOCATAIRE', B2: 'ENTREE_NON_VALIDEE', B3: 'PORTE_PARALLELE', B4: 'SECRET_EXPOSE',
  C1: 'PANNE_DEGUISEE', C2: 'ECRITURE_VOLANTE', C3: 'AGREGAT_PARTIEL', C4: 'PERIODE_DIVERGENTE',
  C5: 'PANNE_DEGUISEE', C6: 'AGREGAT_PARTIEL', C7: 'IDEMPOTENCE',
  D1: 'CHIFFRE_INVENTE', D2: 'ACTION_MUETTE', D3: 'CONTRAT', D4: 'CHIFFRE_INVENTE',
  D5: 'CHIFFRE_INVENTE', D6: 'ACTION_MUETTE', D7: 'CHIFFRE_INVENTE', D9: 'PANNE_DEGUISEE',
  E1: 'PLANIFIE_INERTE', E2: 'LOCATAIRE', E3: 'DEFINITION_DOUBLE', E4: 'VOCABULAIRE',
  E5: 'UNITE_DIVERGENTE', E6: 'CHIFFRE_INVENTE',
  F1: 'CIBLE_INEXISTANTE', F2: 'CIBLE_INEXISTANTE', F3: 'CODE_MORT', F4: 'CIBLE_INEXISTANTE',
  G1: 'GARDE_EFFACEE', G2: 'GARDE_EFFACEE', G3: 'GARDE_EFFACEE', G4: 'LOCATAIRE',
  H1: 'DEFINITION_DOUBLE', H2: 'PERIODE_DIVERGENTE', H3: 'PERIODE_DIVERGENTE',
  H4: 'UNITE_DIVERGENTE', H5: 'DEFINITION_DOUBLE',
  I1: 'CASCADE_MANQUANTE', I2: 'SECRET_EXPOSE', I3: 'CASCADE_MANQUANTE',
  I4: 'ENTREE_NON_VALIDEE', I5: 'CASCADE_MANQUANTE',

  /* Règles de l'APPARIEUR (banc/apparieur/apparier.mjs). Même discipline que
     ci-dessus : la famille est écrite à partir du titre que la règle se donne.
     X1 « la seule mutation du module à n'être protégée par rien »   */
  X1: 'PORTE_PARALLELE',
  /* X2 « l'argument accepté et jamais lu : l'écran croit l'avoir enregistré » */
  X2: 'ACTION_MUETTE',
  /* X3 « un côté de la recherche n'est pas à la même graduation que l'autre » */
  X3: 'RECHERCHE_MUETTE',
  /* X4 « le repli en dur qui a la forme de la vraie donnée serveur » */
  X4: 'CHIFFRE_INVENTE',
  /* X5 « le décompte affiché et le détail du même écran ne comptent pas pareil » */
  X5: 'DRILLDOWN',
  /* X6 « une table écrite depuis plusieurs endroits et lue par aucun » */
  X6: 'CODE_MORT',
  /* X7 « le catch qui avale la panne et répond quand même succès » */
  X7: 'PANNE_DEGUISEE',
  /* X8 « une moyenne dont la somme et l'effectif ne portent pas sur le même ensemble » */
  X8: 'CHIFFRE_INVENTE',
  /* X9 « une somme de montants qui ne regarde pas la devise du voisin de schéma » */
  X9: 'UNITE_DIVERGENTE',
  /* X10 « le compteur écarte des lignes que la liste du même module rend » */
  X10: 'DRILLDOWN',
  /* X11 « un cas limite (population vide, NaN, division non finie) affiche un chiffre fabriqué » */
  X11: 'CHIFFRE_INVENTE',
  /* X12 « une division dont le dénominateur n'est pas protégé, quand une sœur du fichier le protège » */
  X12: 'CHIFFRE_INVENTE',
  /* X13 « une écriture d'état revient en arrière dans le vocabulaire sans lire l'état courant » */
  X13: 'ETAT_ECRASE',
  /* X14 « un réglage stocké, exposé, modifiable, que rien ne consulte » */
  X14: 'REGLAGE_INERTE',
  /* X15 « le nom désigne le plus récent, la requête ne trie pas » */
  X15: 'ORDRE_IMPLICITE',
};

export const familleDeRegle = (id) => REGLE_FAMILLE[id] || null;

/** Familles qu'AUCUNE règle ne prétend couvrir : le trou déclaré du skill. */
export function famillesNonCouvertes() {
  const c = new Set(Object.values(REGLE_FAMILLE));
  return Object.keys(FAMILLES).filter((f) => !c.has(f));
}
