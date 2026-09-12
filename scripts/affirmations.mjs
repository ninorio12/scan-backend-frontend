#!/usr/bin/env node
/**
 * affirmations.mjs — le catalogue des affirmations typées, et rien d'autre.
 *
 * LE PROBLÈME QU'IL RÈGLE. Un agent lâché dans l'application rend de la prose :
 * « le bouton Enregistrer ne sauvegarde pas », « 5 793 documents sont inatteignables ».
 * Personne ne vérifie. Le 12/09/2026, sur un projet client, un agent a déclaré mort
 * quatre fois un bouton « Aujourd'hui » qui marchait, et un autre a compté six boutons
 * enfants d'un <Link> comme morts sur huit. Leurs erreurs sont devenues notre constat.
 *
 * LA RÈGLE. Un agent ne rend plus de la prose : il rend des AFFIRMATIONS TYPÉES, et
 * verifier-affirmation.mjs les tranche mécaniquement, sans LLM et sans réseau sortant.
 * Un type qui ne peut pas être tranché mécaniquement n'entre pas au catalogue. C'est
 * cette règle-là qui fait toute la valeur : elle interdit l'affirmation invérifiable
 * plutôt que de la juger « probablement vraie ».
 *
 * QUATRE DISPOSITIONS, jamais une cinquième :
 *   confirmée    la vérification a eu lieu, l'affirmation tient.
 *   infirmée     la vérification a eu lieu, l'affirmation est fausse.
 *   invérifiable il manque un moyen : application éteinte, fichier absent, écriture
 *                non consentie. Ce n'est PAS un demi-point : c'est « on ne sait pas ».
 *   hors-sujet   l'affirmation ne relève pas de ce type : champ manquant, type inconnu,
 *                ou le terrain rend la question sans objet (un écran paginé).
 *
 *     node affirmations.mjs                 le catalogue, en clair
 *     node affirmations.mjs --json          le catalogue, pour une machine
 *     node affirmations.mjs --valider lot.json    la FORME du lot, sans rien vérifier
 *
 * CODES DE SORTIE : 0 tout va bien · 1 au moins une affirmation mal formée · 2 usage.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ── Les quatre dispositions. Toute autre valeur est un bug, pas une nuance. ── */
export const DISPOSITIONS = ['confirmée', 'infirmée', 'invérifiable', 'hors-sujet'];
export const estDisposition = (d) => DISPOSITIONS.includes(d);

/* ── Les seuils du lot ───────────────────────────────────────────────────────
   Deux taux, parce qu'un agent peut rater de deux façons : se tromper, ou noyer
   le vérificateur sous des affirmations qu'on ne peut pas trancher.

   SEUIL_CONFIRMATION = 0,70 sur ce qui a été TRANCHÉ (confirmées + infirmées).
   Justification, pas un chiffre rond tiré au sort : les deux incidents réels du
   12/09/2026 donnent 2 bonnes affirmations sur 8 pour les « boutons sans action »
   (0,25) et 0 sur 4 pour le bouton « Aujourd'hui » (0,00) ; un lot honnête du même
   jour (parcours agent 1, projet inconnu) tenait 9 constats sur 10. Le seuil doit
   donc couper franchement entre 0,25 et 0,90. À 0,70, un lot de dix affirmations
   supporte trois erreurs et pas quatre : c'est le point où retrier coûte plus cher
   que refaire. Plus haut (0,85) on rejetterait des lots utiles pour une bévue ;
   plus bas (0,50) on accepterait un lot dont une moitié est fausse, c'est-à-dire
   exactement ce qu'on veut arrêter.

   SEUIL_JUGEABLE = 0,50 sur le lot entier. Sans lui, un agent rendrait vingt
   affirmations invérifiables et sortirait avec un taux de confirmation de 100 %
   sur la seule qui a pu être tranchée. Un lot dont la moitié n'est pas jugeable
   n'est pas un rapport, c'est un brouillon.                                      */
export const SEUIL_CONFIRMATION = 0.70;
export const SEUIL_JUGEABLE = 0.50;

/* ── Le catalogue ─────────────────────────────────────────────────────────────
   Chaque type porte EXACTEMENT les champs qui permettent de le rejouer, et la
   phrase qui dit comment le vérificateur tranche. Si on ne sait pas écrire cette
   phrase, le type n'entre pas.                                                   */
export const TYPES = {

  /* ── Côté écran : il faut un navigateur et l'application allumée ──────────── */

  bouton_ne_persiste_pas: {
    moyen: 'écran',
    ecrit: true,
    quoi: "On modifie un champ, on clique le bouton qui enregistre, on recharge : la valeur d'avant est revenue.",
    requis: ['url', 'libelle', 'champ'],
    optionnels: ['valeur_test'],
    champs: {
      url: "adresse de l'écran (chemin ou URL complète)",
      libelle: "libellé exact du bouton qui est censé enregistrer",
      champ: "sélecteur CSS du champ à modifier (input, textarea)",
      valeur_test: "valeur à écrire ; si absente, le vérificateur en fabrique une reconnaissable",
    },
    tranche: "confirmée si le champ est revenu à sa valeur d'avant après rechargement ; infirmée s'il a gardé la valeur écrite ; invérifiable sans --ecriture-permise (ce bouton écrit chez le client), si l'écran ne charge pas, ou si le champ ou le bouton est introuvable.",
    exemple: { type: 'bouton_ne_persiste_pas', url: '/modules/parametres', libelle: 'Enregistrer', champ: 'input[name="prenom"]' },
  },

  bouton_sans_effet: {
    moyen: 'écran',
    ecrit: false,
    quoi: "On clique : aucune requête, aucun changement à l'écran, aucun message, aucune erreur.",
    requis: ['url', 'libelle'],
    optionnels: [],
    champs: {
      url: "adresse de l'écran",
      libelle: "libellé exact du bouton",
    },
    tranche: "on relève l'URL, la taille du texte, les requêtes et les erreurs, on clique, on recompare. Si rien ne bouge, CONTRE-ÉPREUVE obligatoire : on clique six autres commandes pour sortir l'écran de l'état visé, puis on re-clique. Confirmée seulement si rien ne bouge les deux fois ET qu'aucun gestionnaire n'est attaché ; infirmée dès que quelque chose bouge, ou que le bouton est inclus dans un lien ou un bouton parent (c'est le parent qui reçoit le clic) ; invérifiable si l'écran ne charge pas, si le bouton est introuvable, ou s'il détruit (supprimer, vider, déconnecter) : celui-là n'est jamais cliqué.",
    exemple: { type: 'bouton_sans_effet', url: '/modules/calendrier', libelle: "Aujourd'hui" },
  },

  valeur_en_dur: {
    moyen: 'écran',
    ecrit: false,
    quoi: "Une valeur affichée ne vient pas de la source : elle survit à la coupure de la source.",
    requis: ['url', 'texte'],
    optionnels: [],
    champs: {
      url: "adresse de l'écran",
      texte: "la valeur telle qu'elle s'affiche (« Sophie », « CHF 47'375'000 »)",
    },
    tranche: "on charge deux fois : une fois normalement, une fois en coupant tout ce qui porte la donnée (Convex, /api/, GraphQL, Supabase, Firebase, WebSocket). Confirmée si le texte est là dans les deux cas ; infirmée s'il disparaît à la coupure (il venait donc bien de la source) ; invérifiable si l'écran ne charge pas, ou si le texte n'est même pas présent sans coupure.",
    exemple: { type: 'valeur_en_dur', url: '/modules/parametres', texte: 'Sophie' },
  },

  compteur_faux: {
    moyen: 'écran',
    ecrit: false,
    quoi: "Un nombre affiché ne correspond pas à ce qu'on compte sur le même écran.",
    requis: ['url', 'affiche', 'selecteur', 'compte'],
    optionnels: [],
    champs: {
      url: "adresse de l'écran",
      affiche: "le nombre affiché, en chiffres (7885, pas « 7'885 »)",
      selecteur: "sélecteur CSS des éléments à recompter (les lignes, les cartes)",
      compte: "le nombre que l'agent a compté",
    },
    tranche: "on relit le nombre affiché (séparateurs d'espace, d'apostrophe ou de virgule tolérés) et on recompte le sélecteur. Confirmée si le nombre affiché est bien celui annoncé, que le recomptage donne bien celui annoncé, et que les deux diffèrent ; infirmée si le nombre affiché n'est pas sur l'écran, si le recomptage contredit l'agent, ou si les deux nombres coïncident en réalité ; hors-sujet si l'écran est paginé (« 1–50 sur 7'885 », « page 2 ») : un total et le nombre de lignes visibles n'ont alors aucune raison de coïncider, et c'est le faux positif classique.",
    exemple: { type: 'compteur_faux', url: '/modules/biens', affiche: 195, selecteur: 'table tbody tr', compte: 21 },
  },

  page_inatteignable: {
    moyen: 'écran',
    ecrit: false,
    quoi: "Une adresse du produit ne mène pas à un écran de l'application.",
    requis: ['url'],
    optionnels: [],
    champs: { url: "adresse à ouvrir" },
    tranche: "on ouvre l'adresse dans le navigateur et on suit les redirections. Confirmée si la réponse finale est ≥ 400, si la navigation échoue, si on atterrit sur un autre domaine, ou si le corps est un 404 du framework ; infirmée si l'écran de l'application s'affiche ; invérifiable si le serveur ne répond pas du tout (l'application est éteinte : ce n'est pas la page qui est morte).",
    exemple: { type: 'page_inatteignable', url: '/modules/integrations' },
  },

  texte_present: {
    moyen: 'écran',
    ecrit: false,
    quoi: "Un texte est bien lisible sur un écran (texte de la page ou valeur d'un champ).",
    requis: ['url', 'texte'],
    optionnels: [],
    champs: { url: "adresse de l'écran", texte: "le texte cherché, au moins deux caractères" },
    tranche: "confirmée si le texte apparaît dans document.body.innerText ou dans la valeur d'un input/textarea/select ; infirmée sinon ; invérifiable si l'écran ne charge pas ; hors-sujet si le texte fait moins de deux caractères (on ne prouve rien avec « 0 »).",
    exemple: { type: 'texte_present', url: '/modules/parametres', texte: 'Sophie' },
  },

  texte_absent: {
    moyen: 'écran',
    ecrit: false,
    quoi: "Un texte n'est nulle part sur un écran.",
    requis: ['url', 'texte'],
    optionnels: [],
    champs: { url: "adresse de l'écran", texte: "le texte qu'on dit absent" },
    tranche: "l'inverse exact de texte_present : confirmée si le texte n'est ni dans le texte de la page ni dans la valeur d'un champ ; infirmée s'il y est (le vérificateur rend alors l'endroit où il l'a trouvé).",
    exemple: { type: 'texte_absent', url: '/modules/calendrier', texte: 'Erreur' },
  },

  element_hors_ecran: {
    moyen: 'écran',
    ecrit: false,
    quoi: "Un élément sort de l'écran à une largeur donnée et force la page à défiler de côté.",
    requis: ['url', 'selecteur', 'largeur'],
    optionnels: [],
    champs: {
      url: "adresse de l'écran",
      selecteur: "sélecteur CSS de l'élément",
      largeur: "largeur de la fenêtre en pixels (390 pour un téléphone)",
    },
    tranche: "confirmée si l'élément est visible, que son bord droit dépasse la fenêtre, ET que la page elle-même défile de côté ; infirmée s'il tient dans la fenêtre, s'il est invisible, ou s'il déborde à l'intérieur d'un conteneur qui défile (un tableau dans un overflow-x) pendant que la page, elle, ne défile pas : c'est le faux positif le plus fréquent ; invérifiable si le sélecteur ne trouve rien ou si l'écran ne charge pas.",
    exemple: { type: 'element_hors_ecran', url: '/modules/contacts', selecteur: 'header .actions', largeur: 390 },
  },

  /* ── Côté réseau : une requête, sans navigateur ───────────────────────────── */

  requete_en_echec: {
    moyen: 'réseau',
    ecrit: false,
    quoi: "Une adresse répond en échec avec un statut précis.",
    requis: ['url', 'statut'],
    optionnels: [],
    champs: {
      url: "adresse de la requête",
      statut: "le statut HTTP annoncé (404, 500…)",
    },
    tranche: "une requête GET, sans suivre les redirections (on juge CETTE réponse, pas la destination finale). Confirmée si le statut obtenu est celui annoncé et qu'il vaut 400 ou plus ; infirmée si le statut obtenu est autre, ou s'il est inférieur à 400 (la requête n'est pas en échec) ; invérifiable si le serveur ne répond pas.",
    exemple: { type: 'requete_en_echec', url: '/modules/integrations', statut: 404 },
  },

  lien_mort: {
    moyen: 'réseau',
    ecrit: false,
    quoi: "Un lien du produit mène à une page qui n'existe pas.",
    requis: ['href', 'statut'],
    optionnels: [],
    champs: {
      href: "le href du lien, tel qu'il est écrit dans la page",
      statut: "le statut annoncé au bout du lien",
    },
    tranche: "une requête GET EN SUIVANT les redirections, parce que c'est ce que fait un humain qui clique. Confirmée si le statut final est celui annoncé et qu'il vaut 400 ou plus ; infirmée sinon ; invérifiable si le serveur ne répond pas ; hors-sujet si le href sort du produit (autre domaine, mailto:, tel:) : le vérificateur n'appelle jamais l'extérieur.",
    exemple: { type: 'lien_mort', href: '/integrations', statut: 404 },
  },

  /* ── Côté code : on lit les fichiers, rien d'autre ────────────────────────── */

  fichier_contient: {
    moyen: 'code',
    ecrit: false,
    quoi: "Un fichier contient un motif.",
    requis: ['chemin', 'motif'],
    optionnels: [],
    champs: {
      chemin: "chemin relatif au dépôt audité",
      motif: "texte littéral, ou /expression/drapeaux pour une expression régulière",
    },
    tranche: "confirmée si le motif est dans le fichier ; infirmée sinon ; invérifiable si le fichier n'existe pas ou n'est pas lisible ; hors-sujet si le motif n'est qu'un nombre (« 306 » est un numéro de ligne recopié, pas un motif).",
    exemple: { type: 'fichier_contient', chemin: 'app/modules/parametres/page.tsx', motif: 'defaultValue="Sophie"' },
  },

  fichier_ne_contient_pas: {
    moyen: 'code',
    ecrit: false,
    quoi: "Un fichier ne contient pas un motif. C'est l'affirmation d'absence, la plus facile à bâcler.",
    requis: ['chemin', 'motif'],
    optionnels: [],
    champs: { chemin: "chemin relatif au dépôt audité", motif: "texte littéral, ou /expression/drapeaux" },
    tranche: "confirmée si le motif est bien absent ; infirmée s'il est là (le vérificateur rend la première ligne où il l'a trouvé) ; invérifiable si le fichier n'existe pas : l'absence dans un fichier absent ne prouve rien.",
    exemple: { type: 'fichier_ne_contient_pas', chemin: 'convex/contacts.ts', motif: 'getUserIdentity' },
  },

  symbole_appele: {
    moyen: 'code',
    ecrit: false,
    quoi: "Un symbole est appelé un nombre précis de fois dans le dépôt. Zéro appel, c'est du code mort.",
    requis: ['nom', 'appels_attendus'],
    optionnels: ['chemin'],
    champs: {
      nom: "le nom du symbole, tel quel",
      appels_attendus: "le nombre d'appels annoncé (0 pour « rien ne l'appelle »)",
      chemin: "facultatif : limiter le comptage à un sous-dossier du dépôt",
    },
    tranche: "on parcourt les fichiers source du dépôt (node_modules, .next, _generated, dist et build exclus) et on compte les occurrences du nom, en retirant sa déclaration et ses lignes d'import ou de ré-export. Confirmée si le compte tombe juste ; infirmée sinon, avec les endroits trouvés ; invérifiable si le dépôt est introuvable ; hors-sujet si le nom fait moins de trois caractères (trop court pour être compté sans bruit).",
    exemple: { type: 'symbole_appele', nom: 'etiquettesDisponibles', appels_attendus: 0 },
  },

  route_existe: {
    moyen: 'code',
    ecrit: false,
    quoi: "Une route du produit a bien un fichier qui la sert.",
    requis: ['route'],
    optionnels: [],
    champs: { route: "le chemin de la route (/modules/calendrier)" },
    tranche: "on résout la route dans l'arborescence du dépôt : app/**/page.tsx et route.ts (segments dynamiques [x] et attrape-tout [...x] compris), ou pages/**. Confirmée si un fichier la sert ; infirmée si aucun ne la sert ; invérifiable si le dépôt n'a ni app/ ni pages/ (ce n'est pas un projet à routes de fichiers, il faut un autre moyen).",
    exemple: { type: 'route_existe', route: '/modules/integrations' },
  },
};

/* ── Forme d'une affirmation ──────────────────────────────────────────────────
   On valide la FORME ici, jamais le fond : dire si un lot est recevable ne
   demande ni navigateur ni dépôt, et un agent doit pouvoir se relire tout seul. */

export function valider(affirmation) {
  if (!affirmation || typeof affirmation !== 'object' || Array.isArray(affirmation)) {
    return { ok: false, raison: "ce n'est pas un objet" };
  }
  const def = TYPES[affirmation.type];
  if (!def) {
    return { ok: false, raison: `type inconnu : ${JSON.stringify(affirmation.type)}. Les types du catalogue : ${Object.keys(TYPES).join(', ')}` };
  }
  const manquants = def.requis.filter((c) => {
    const v = affirmation[c];
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  });
  if (manquants.length) {
    return { ok: false, raison: `champ${manquants.length > 1 ? 's' : ''} manquant${manquants.length > 1 ? 's' : ''} : ${manquants.join(', ')}`, manquants };
  }
  const connus = new Set([...def.requis, ...def.optionnels, 'type', 'id', 'dit', 'agent', 'ecriture_permise']);
  const inconnus = Object.keys(affirmation).filter((c) => !connus.has(c));
  return { ok: true, raison: 'forme correcte', inconnus };
}

/* Un lot, c'est soit un tableau, soit { agent, affirmations: [...] }. */
export function lireLot(brut) {
  const o = typeof brut === 'string' ? JSON.parse(brut) : brut;
  if (Array.isArray(o)) return { agent: null, affirmations: o };
  if (o && Array.isArray(o.affirmations)) return { agent: o.agent ?? null, affirmations: o.affirmations };
  throw new Error('lot illisible : attendu un tableau d\'affirmations, ou { "agent": "...", "affirmations": [...] }');
}

/* ── Le taux ──────────────────────────────────────────────────────────────────
   Ce qui manquait à toute la chaîne : un lot n'est pas une opinion, il a un taux,
   et sous le seuil il repart chez l'agent.                                       */
export function taux(resultats) {
  const n = (d) => resultats.filter((r) => r.disposition === d).length;
  const confirmees = n('confirmée');
  const infirmees = n('infirmée');
  const inverifiables = n('invérifiable');
  const horsSujet = n('hors-sujet');
  const total = resultats.length;
  const tranchees = confirmees + infirmees;

  const tauxConfirmation = tranchees ? confirmees / tranchees : null;
  const tauxJugeable = total ? tranchees / total : null;

  const motifs = [];
  if (!total) motifs.push('lot vide');
  else if (!tranchees) motifs.push("aucune affirmation n'a pu être tranchée : rien n'est jugeable");
  else {
    if (tauxJugeable < SEUIL_JUGEABLE) {
      motifs.push(`seulement ${pourcent(tauxJugeable)} du lot est jugeable (seuil ${pourcent(SEUIL_JUGEABLE)}) : reformuler en types vérifiables, ou rallumer ce qui manque`);
    }
    if (tauxConfirmation < SEUIL_CONFIRMATION) {
      motifs.push(`taux de confirmation ${pourcent(tauxConfirmation)} sous le seuil ${pourcent(SEUIL_CONFIRMATION)} : ${infirmees} affirmation${infirmees > 1 ? 's' : ''} fausse${infirmees > 1 ? 's' : ''} sur ${tranchees} tranchée${tranchees > 1 ? 's' : ''}`);
    }
  }
  return {
    total, confirmees, infirmees, inverifiables, horsSujet, tranchees,
    tauxConfirmation, tauxJugeable,
    verdict: motifs.length ? 'REJETÉ' : 'ACCEPTÉ',
    motifs,
  };
}

export const pourcent = (x) => (x == null ? '—' : `${Math.round(x * 1000) / 10} %`);

/* ── En ligne de commande ─────────────────────────────────────────────────── */

const lanceDirectement = !!process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (lanceDirectement) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--valider');

  if (i >= 0) {
    const fichier = args[i + 1];
    if (!fichier) { console.error('usage: node affirmations.mjs --valider <lot.json>'); process.exit(2); }
    let lot;
    try { lot = lireLot(fs.readFileSync(fichier, 'utf-8')); }
    catch (e) { console.error(`  ✗ ${e.message}`); process.exit(2); }
    let mauvais = 0;
    console.log(`\n  ${lot.affirmations.length} affirmation${lot.affirmations.length > 1 ? 's' : ''}${lot.agent ? ` de ${lot.agent}` : ''}\n`);
    lot.affirmations.forEach((a, k) => {
      const v = valider(a);
      const nom = a?.id || `#${k + 1}`;
      if (!v.ok) { mauvais++; console.log(`  ✗ ${nom.padEnd(10)} ${v.raison}`); }
      else console.log(`  ✓ ${nom.padEnd(10)} ${a.type}${v.inconnus?.length ? `   (champs ignorés : ${v.inconnus.join(', ')})` : ''}`);
    });
    console.log(`\n  ${lot.affirmations.length - mauvais} recevable${lot.affirmations.length - mauvais > 1 ? 's' : ''} · ${mauvais} à refaire\n`);
    console.log('  La forme seulement. Pour trancher le fond : node verifier-affirmation.mjs <lot.json>\n');
    process.exit(mauvais ? 1 : 0);
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify({ dispositions: DISPOSITIONS, seuils: { confirmation: SEUIL_CONFIRMATION, jugeable: SEUIL_JUGEABLE }, types: TYPES }, null, 2));
    process.exit(0);
  }

  const parMoyen = { code: [], écran: [], réseau: [] };
  for (const [nom, d] of Object.entries(TYPES)) parMoyen[d.moyen].push([nom, d]);
  console.log(`\n  CATALOGUE DES AFFIRMATIONS  ·  ${Object.keys(TYPES).length} types  ·  4 dispositions : ${DISPOSITIONS.join(', ')}`);
  console.log(`  Seuils : confirmation ${pourcent(SEUIL_CONFIRMATION)} sur les tranchées · ${pourcent(SEUIL_JUGEABLE)} du lot jugeable\n`);
  for (const [moyen, liste] of Object.entries(parMoyen)) {
    if (!liste.length) continue;
    const comment = { code: 'lecture de fichiers', écran: 'navigateur, application allumée', réseau: 'une requête GET' }[moyen];
    console.log(`  ── ${moyen.toUpperCase()}  (${comment})`);
    for (const [nom, d] of liste) {
      console.log(`\n  ${nom}${d.ecrit ? '   ⚠️ écrit chez le client : demande --ecriture-permise' : ''}`);
      console.log(`      ${d.quoi}`);
      console.log(`      champs : ${d.requis.join(', ')}${d.optionnels.length ? ` [+ ${d.optionnels.join(', ')}]` : ''}`);
      console.log(`      ${d.tranche}`);
    }
    console.log('');
  }
  console.log('  Le mode d\'emploi pour les agents : references/affirmations.md\n');
}
