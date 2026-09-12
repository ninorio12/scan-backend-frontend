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
 *
 * COROLLAIRE DE LA RÈGLE 2, appliqué au chantier du 12/09/2026 : un résultat ne peut que
 * RETIRER une correspondance (« la règle avait raison par accident »), jamais en ajouter
 * une. Chaque ligne ci-dessous porte, en commentaire, le titre exact de la règle : c'est
 * la seule justification admise. Le détail du chantier : banc/audit/chantier-carte.md.
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
  // Glose élargie le 12/09/2026 au symptôme que la famille nomme déjà (« garde effacée »),
  // sur la foi de la vérité terrain du banc figé : B2-20 est classé GARDE_EFFACEE et son
  // résumé dit « aucune vérification de signature ni de secret sur le webhook public ».
  // La clé, elle, n'a pas changé : aucun appariement, aucun sceau n'est affecté.
  GARDE_EFFACEE:      'la vérification n’est pas là : porte publique sans garde, ou garde qui se désactive quand la config manque',
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

  /* TROIS FAMILLES AJOUTÉES LE 12/09/2026. Chacune décrit un symptôme client que la
     taxonomie ne nommait pas, et que des règles existantes prétendaient déjà chercher
     sans avoir où se ranger : elles étaient rangées de force dans une famille voisine,
     ce qui les rendait créditables par accident. Aucun opérateur de mutation ne plante
     ces trois familles : les ajouter ne peut pas faire monter le chiffre, seulement
     empêcher un crédit indu. */
  ACCES_NON_AUTORISE: 'connecté ne veut pas dire propriétaire : la donnée désignée par un identifiant fourni par l’appelant n’est pas la sienne',
  SATURATION_VOLUME:  'la lecture ramène toute la table : l’écran meurt le jour où le client a du volume',
  PERTE_IRREVERSIBLE: 'des données s’effacent sans filet : drapeau destructeur câblé, aucune sauvegarde, vidage avant remplissage',
};

/** Carte règle → famille, dérivée des titres que les 56 règles se donnent.
 *  Le commentaire de chaque ligne EST la justification : c'est le titre exact. */
export const REGLE_FAMILLE = {
  /* ── AXE A — chaînes mortes ───────────────────────────────────────────── */
  A1: 'CODE_MORT',          // « Unités backend que rien n'appelle »
  A2: 'CODE_MORT',          // « Entités de données orphelines »
  A3: 'CODE_MORT',          // « Champs de schéma jamais utilisés »
  A4: 'CIBLE_INEXISTANTE',  // « Tâches planifiées cassées » (cron sans route correspondante)
  A5: 'ENV_MANQUANTE',      // « Variables d'environnement non déclarées »

  /* ── AXE B — portes ───────────────────────────────────────────────────── */
  // B1 était cartographiée LOCATAIRE : faux. Son titre est « Portes publiques sans garde
  // d'identité » ; elle ne regarde ni table partagée ni filtre de locataire, elle regarde
  // si la porte atteint une garde résolue. « La garde n'est pas là » est GARDE_EFFACEE.
  B1: 'GARDE_EFFACEE',      // « Portes publiques sans garde d'identité »
  B2: 'ENTREE_NON_VALIDEE', // « Entrées publiques non validées »
  B3: 'PORTE_PARALLELE',    // « Appels internes passant par la porte publique »
  B4: 'SECRET_EXPOSE',      // « Secrets en dur dans le code »

  /* ── AXE C — exécution ────────────────────────────────────────────────── */
  C1:  'PANNE_DEGUISEE',    // « Pannes masquées par un catch muet »
  C1b: 'PANNE_DEGUISEE',    // « Catch muets anodins » (même défaut que C1, seau à faible gravité)
  C1c: 'PANNE_DEGUISEE',    // « Échecs déguisés en succès »
  C2:  'ECRITURE_VOLANTE',  // « Écritures sans await »
  // C3 et C6 étaient cartographiées AGREGAT_PARTIEL : faux, et c'est l'inverse. Leurs
  // titres disent « non bornées » : elles cherchent une lecture qui ramène TOUT, pas un
  // total calculé sur un échantillon (ça, c'est C8). Le symptôme est la saturation.
  C3:  'SATURATION_VOLUME', // « Lectures non bornées »
  C4:  'PERIODE_DIVERGENTE',// « Temps lu dans une query réactive » (« aujourd'hui » figé au premier abonnement)
  C5:  'PANNE_DEGUISEE',    // « Appels externes sans filet »
  C6:  'SATURATION_VOLUME', // « Collectes non bornées »
  C7:  'IDEMPOTENCE',       // « Entrées rejouables sans idempotence »
  C8:  'AGREGAT_PARTIEL',   // « Totaux calculés sur un échantillon »
  C9:  'ORDRE_IMPLICITE',   // « Le nom dit “le plus récent”, la requête ne trie pas »

  /* ── AXE D — surfaces ─────────────────────────────────────────────────── */
  D1:  'CHIFFRE_INVENTE',   // « Champs pré-remplis d'une donnée écrite en dur »
  // D1b « Autres valeurs de champ en dur » : VOLONTAIREMENT SANS FAMILLE. C'est le seau
  // que la règle déclare elle-même « souvent légitime (unité, devise, langue par défaut),
  // à vérifier une fois » : elle ne prétend donc aucun défaut. Lui donner une famille
  // reviendrait à rendre créditable une règle qui parle sur presque chaque `value="…"`.
  D2:  'ACTION_MUETTE',     // « Actions qui annoncent un succès sans rien écrire »
  D3:  'CONTRAT',           // « Écrans de données sans aucune lecture de source »
  D4:  'CHIFFRE_INVENTE',   // « Jeux de données de démonstration en dur »
  D5:  'CHIFFRE_INVENTE',   // « Identité écrite en dur dans la logique »
  D6:  'ACTION_MUETTE',     // « Boutons et liens qui ne font rien »
  D7:  'CHIFFRE_INVENTE',   // « Chiffres affichés en dur »
  D9:  'PANNE_DEGUISEE',    // « États dégradés sans écran dédié »

  /* ── AXE E — historique et vocabulaire ────────────────────────────────── */
  E1: 'PLANIFIE_INERTE',    // « Tâches planifiées vouées à échouer sur l'authentification »
  E2: 'LOCATAIRE',          // « Tables partagées lues sans leur discriminant »
  E3: 'DEFINITION_DOUBLE',  // « Registres parallèles désynchronisés »
  E4: 'VOCABULAIRE',        // « Valeurs écrites ou comparées hors du vocabulaire déclaré »
  E5: 'UNITE_DIVERGENTE',   // « Argent additionné sans conversion »
  E6: 'CHIFFRE_INVENTE',    // « Données de démonstration comptées comme réelles »

  /* ── AXE F — contrats d'appel ─────────────────────────────────────────── */
  F1: 'CIBLE_INEXISTANTE',  // « Appels réseau vers une cible inexistante »
  F2: 'CIBLE_INEXISTANTE',  // « Liens vers une page inexistante »
  F3: 'CODE_MORT',          // « Routes que rien n'appelle depuis le repo »
  F4: 'CIBLE_INEXISTANTE',  // « Appels et routes qui se ratent d'un segment »

  /* ── AXE G — authentification et autorisation ─────────────────────────── */
  G1: 'GARDE_EFFACEE',      // « Gardes d'identité sans configuration d'authentification »
  G2: 'GARDE_EFFACEE',      // « Jetons d'authentification jamais envoyés au backend »
  G3: 'GARDE_EFFACEE',      // « Authentification qui s'efface selon l'environnement »
  // G4 était cartographiée LOCATAIRE : faux. Elle ne parle pas de table partagée ni de
  // filtre, elle parle de l'identité que l'appelant DÉCLARE. G4 à G7 sont les quatre
  // formes d'un même symptôme, qui n'avait pas de famille : connecté ≠ propriétaire.
  G4: 'ACCES_NON_AUTORISE', // « Identité fournie par l'appelant, jamais vérifiée »
  G5: 'ACCES_NON_AUTORISE', // « Lignes modifiées ou rendues sans vérification de propriété »
  G6: 'ACCES_NON_AUTORISE', // « Données sensibles servies sur un identifiant fourni, sans garde »
  G7: 'ACCES_NON_AUTORISE', // « Écritures dans un conteneur dont la propriété n'est pas vérifiée »

  /* ── AXE H — cohérence des chiffres ───────────────────────────────────── */
  H1: 'DEFINITION_DOUBLE',  // « Critères de sélection incohérents sur une même table »
  H2: 'PERIODE_DIVERGENTE', // « Grilles de jours incohérentes »
  H3: 'PERIODE_DIVERGENTE', // « Total et détail sur des périodes différentes »
  H4: 'UNITE_DIVERGENTE',   // « Mises en forme divergentes d'une même grandeur »
  H5: 'DEFINITION_DOUBLE',  // « Constantes métier divergentes »

  /* ── AXE I — rayon de souffle ─────────────────────────────────────────── */
  // I1, I3 et I5 étaient cartographiées CASCADE_MANQUANTE : faux. Aucune ne parle de la
  // suppression d'un parent qui laisse ses enfants orphelins ; toutes les trois parlent
  // de données qui s'effacent en masse sans filet. CASCADE_MANQUANTE redevient donc une
  // famille qu'aucune règle ne prétend couvrir, ce qui est la vérité.
  I1: 'PERTE_IRREVERSIBLE', // « Drapeaux destructeurs câblés dans un script ou une configuration »
  I2: 'SECRET_EXPOSE',      // « Identifiants d'infrastructure lisibles depuis le dépôt »
  I3: 'PERTE_IRREVERSIBLE', // « Projet avec base de données et sans aucune trace de sauvegarde »
  I4: 'ENTREE_NON_VALIDEE', // « Listes noires là où il faut une liste blanche »
  I5: 'PERTE_IRREVERSIBLE', // « Séquences “on vide puis on remplit” sans garde sur le vide »

  /* Règles de l'APPARIEUR (banc/apparieur/DOSSIER.md). Même discipline que
     ci-dessus : la famille est écrite à partir du titre que la règle se donne.
     Aucune n'est émise par scripts/audit-backend.mjs à ce jour : elles ne pèsent
     donc sur aucun chiffre de mesurer.mjs.
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
