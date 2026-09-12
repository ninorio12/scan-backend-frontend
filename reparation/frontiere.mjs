#!/usr/bin/env node
/**
 * frontiere.mjs — qui répare quoi : la machine ou l'agent.
 *
 * LA QUESTION À TRANCHER, RÈGLE PAR RÈGLE
 * « Peut-on écrire la correction sans comprendre l'intention du code ? »
 *   oui  → codemod déterministe. Trois secondes, zéro jeton, résultat identique
 *          à chaque passage, diff relisible d'un coup d'œil.
 *   non  → agent. Il faut lire le nom d'un écran, deviner quelle requête alimente
 *          quel champ, écrire une mutation qui n'existe pas.
 *   ni l'un ni l'autre → humain. Révoquer une clé chez un fournisseur, décider
 *          d'installer une authentification : ce ne sont pas des corrections de
 *          code, ce sont des décisions. Les faire passer pour des défauts
 *          réparables est ce qui gonfle les rapports et les rend illisibles.
 *
 * Le coût de se tromper n'est pas symétrique. Confier du mécanique à un agent coûte
 * des jetons et introduit de la variance. Confier à un codemod ce qui demande une
 * intention produit une correction fausse mais qui compile, donc invisible : c'est
 * exactement le mode d'échec qu'on essaie d'éliminer. Dans le doute : agent.
 *
 *   node frontiere.mjs                       → la table
 *   node frontiere.mjs <repo>                → la répartition réelle du projet
 */

import fs from 'node:fs';
import path from 'node:path';

const ICI = path.dirname(new URL(import.meta.url).pathname);

/* ── La table ───────────────────────────────────────────────────────────────
   `mode`      mecanique | agent | humain
   `codemod`   fichier de reparation/codemods/, ou null
   `condition` ce qui doit être vrai pour que le mécanique soit sûr ; si la
               condition tombe, le défaut redescend chez l'agent
   `invariant` le modèle d'invariant qui prouvera la correction, sans le scanner */

export const FRONTIERE = {

  /* ══ MÉCANIQUE ═══════════════════════════════════════════════════════════ */

  A5: {
    mode: 'mecanique', codemod: 'a5-env-example.mjs',
    quoi: "Variable d'environnement lue par le code et absente de .env.example",
    pourquoi: "Déclarer une variable est une écriture de fichier, pas une décision. Le nom est déjà dans le code.",
    condition: '.env.example existe ou peut être créé',
    invariant: { type: 'texte-present', portee: '.env.example' },
  },

  B3: {
    mode: 'mecanique', codemod: 'b3-basculer-interne.mjs',
    quoi: 'Fonction publique appelée uniquement par une autre fonction serveur',
    pourquoi: "convex-authz appelle ça « internalize-and-defer » : basculer en internal* retire l'atteignabilité publique sans toucher au comportement. Aucune intention à comprendre, le graphe d'appel suffit.",
    condition: 'zéro appel depuis app/ ou components/ (sinon la bascule casse un écran)',
    invariant: { type: 'texte-absent', litteral: 'api.<module>.<fn>', portee: 'app/**' },
  },

  B1: {
    mode: 'mecanique', codemod: 'b3-basculer-interne.mjs', variante: 'sans fondation',
    quoi: "Porte publique sans garde d'identité",
    pourquoi: "⚠️ CAS projet client A. Sur un projet sans convex/auth.config.ts, ctx.auth.getUserIdentity() renvoie TOUJOURS null : ajouter requireIdentity CRÉE un défaut (chaque appel tombe en 401) au lieu d'en corriger un. La seule correction sûre et sans fondation est de basculer en internal* ce qui n'a pas besoin d'être public. Le reste est une dette d'authentification, déclarée une fois, pas 219 fois.",
    condition: "zéro appel client ET pas de fondation d'authentification ; avec fondation, c'est l'agent qui pose la garde et son cloisonnement",
    invariant: { type: 'garde-en-tete' },
    renvoiSkill: 'convex-authz',
  },

  F1: {
    mode: 'mecanique', codemod: 'f1-route-introuvable.mjs',
    quoi: 'Appel réseau vers une route qui n\'existe pas',
    pourquoi: "Quand une seule route existante correspond au chemin de queue (« /modules/parametres/etat » contre « /modules/integrations/etat »), la correction est une réécriture de chaîne. Le risque d'erreur est nul et vérifiable : la route existe ou non.",
    condition: 'exactement une route candidate, appariée par le suffixe du chemin',
    invariant: { type: 'routes-resolues' },
  },

  C2: {
    mode: 'mecanique', codemod: 'c2-await-manquant.mjs (À ÉCRIRE)',
    quoi: 'Écriture en base sans await',
    pourquoi: "Le await manquant devant un ctx.db.insert/patch/delete n'a jamais de raison d'être. C'est une insertion d'un mot-clé.",
    condition: 'la fonction englobante est async',
    invariant: { type: 'texte-absent', litteral: 'ctx.db.patch(', portee: '<fichier>' },
  },

  D9: {
    mode: 'mecanique', codemod: 'd9-etats-degrades.mjs (À ÉCRIRE)',
    quoi: 'error.tsx / loading.tsx / not-found.tsx absents',
    pourquoi: "Trois fichiers dont la forme est connue. ⚠️ Le piège est qu'un fichier VIDE satisfait la règle : le codemod écrit un écran réel, et diff-garde refuse le fichier alibi de moins de cinq lignes utiles.",
    condition: 'Next.js avec un app/ router',
    invariant: { type: 'execution', commande: 'npx tsc --noEmit' },
  },

  /* ══ AGENT ═══════════════════════════════════════════════════════════════ */

  D2: {
    mode: 'agent',
    quoi: 'Un bouton annonce un succès sans rien écrire',
    pourquoi: "Il faut décider CE QUI s'enregistre, retrouver ou écrire la mutation, mapper chaque champ de l'écran sur un argument, gérer l'échec. Rien de tout ça ne se déduit du texte du défaut. C'est le cas type où l'agent vaut son coût.",
    aFournir: "la mutation cible si elle existe (souvent oui : sur projet client A parametres.enregistrer attendait depuis le début), sinon l'ordre de l'écrire d'abord",
    invariant: { type: 'appel-avant-annonce' },
  },

  D1: {
    mode: 'agent',
    quoi: 'Champ pré-rempli d\'une valeur écrite en dur',
    pourquoi: "Il faut savoir quelle requête porte la valeur et sous quel nom de champ. « Sophie » ne dit pas d'où « Sophie » devrait venir.",
    invariant: { type: 'pas-de-valeur-en-dur' },
  },

  D3: {
    mode: 'agent',
    quoi: 'Écran entier sans aucune lecture de source',
    pourquoi: "C'est D1 et D2 ensemble, plus le dessin des trois états. Un écran, un agent, un bail.",
    invariant: { type: 'appel-existe' },
  },

  D6: {
    mode: 'agent',
    quoi: 'Bouton ou lien qui ne fait rien',
    pourquoi: "L'action à brancher n'est écrite nulle part : elle est dans le libellé du bouton et dans l'intention de l'écran. ⚠️ La triche évidente est d'ajouter `disabled` : diff-garde la refuse.",
    invariant: { type: 'appel-avant-annonce' },
  },

  A2: {
    mode: 'agent',
    quoi: 'Table écrite jamais lue, ou lue jamais écrite',
    pourquoi: "Deux corrections opposées (brancher la lecture, ou supprimer l'écriture) et seul le produit tranche. Un codemod choisirait au hasard.",
    invariant: { type: 'appel-existe' },
  },

  A1: {
    mode: 'agent', codemodPartiel: 'a1-supprimer-module-mort.mjs (À ÉCRIRE)',
    quoi: 'Unité backend que rien n\'appelle',
    pourquoi: "Trois issues : câbler la surface qui manque, basculer en internal, supprimer. Seul le troisième cas est mécanique, et seulement si le MODULE ENTIER est mort et n'est référencé nulle part. ⚠️ La triche est l'annotation « // appelé par X » : diff-garde la refuse.",
    condition: 'pour le codemod : zéro référence au module dans tout le dépôt, imports compris',
    invariant: { type: 'execution', commande: 'npx tsc --noEmit' },
  },

  C1: {
    mode: 'agent',
    quoi: 'Panne masquée par un catch muet',
    pourquoi: "Il faut décider ce que l'écran doit montrer quand ça casse. ⚠️ La triche est d'ajouter un TODO dans le catch : diff-garde la refuse.",
    invariant: { type: 'texte-absent', litteral: 'catch {}' },
  },

  C7: { mode: 'agent', quoi: 'Entrée rejouable sans idempotence', pourquoi: "La clé d'idempotence dépend du fournisseur et de ce qui identifie l'événement chez lui.", invariant: { type: 'execution' } },
  C3: { mode: 'agent', quoi: 'Lecture non bornée', pourquoi: "La borne est une décision produit : 50 ou 5000 ne se déduit pas du code.", invariant: { type: 'texte-absent', litteral: '.collect()' } },
  C6: { mode: 'agent', quoi: 'Collecte non bornée', pourquoi: 'idem C3.', invariant: { type: 'texte-absent', litteral: '.collect()' } },
  E2: { mode: 'agent', quoi: 'Table partagée lue sans son discriminant', pourquoi: "Savoir QUEL discriminant manque demande de lire à quoi sert la requête. Le filtre s'écrit en une ligne, encore faut-il connaître la valeur.", invariant: { type: 'texte-present' } },
  D5: { mode: 'agent', quoi: 'Identité écrite en dur dans la logique', pourquoi: "⚠️ La triche est d'extraire le littéral dans une constante : diff-garde la refuse. La vraie correction remplace l'identité par une lecture.", invariant: { type: 'texte-absent' } },
  H2: { mode: 'agent', quoi: 'Deux implémentations divergentes de la même règle', pourquoi: 'Il faut décider laquelle est juste, et c\'est une question métier.', invariant: { type: 'execution' } },
  H3: { mode: 'agent', quoi: 'Total et détail sur des périodes différentes', pourquoi: 'idem H2.', invariant: { type: 'execution' } },
  H5: { mode: 'agent', quoi: 'Constantes métier divergentes', pourquoi: 'idem H2.', invariant: { type: 'texte-absent' } },
  A3: { mode: 'agent', quoi: 'Champ de schéma jamais utilisé', pourquoi: "Écrit-on pour rien, ou a-t-on oublié de lire ? Le schéma ne le dit pas.", invariant: { type: 'texte-absent' } },
  B2: { mode: 'agent', quoi: 'Entrée publique non validée', pourquoi: 'Le validateur dépend de ce que la fonction fait de la valeur.', invariant: { type: 'garde-en-tete' } },
  C4: { mode: 'agent', quoi: 'Temps lu dans une query réactive', pourquoi: "Remonter le temps à l'appelant change la signature et donc les appelants.", invariant: { type: 'execution' } },
  C5: { mode: 'agent', quoi: 'Appel externe sans filet', pourquoi: 'Le repli dépend de ce que le service rend.', invariant: { type: 'texte-absent' } },
  C1b: { mode: 'agent', quoi: 'Catch muet anodin', pourquoi: 'idem C1, gravité moindre.', invariant: { type: 'texte-absent' } },
  D1b: { mode: 'agent', quoi: 'Autre valeur de champ en dur', pourquoi: 'idem D1.', invariant: { type: 'pas-de-valeur-en-dur' } },
  D4: { mode: 'agent', quoi: 'Donnée de démonstration dans un écran', pourquoi: 'idem D1.', invariant: { type: 'texte-absent' } },
  D7: { mode: 'agent', quoi: 'Chiffre écrit en dur', pourquoi: 'idem D1.', invariant: { type: 'texte-absent' } },
  E5: { mode: 'agent', quoi: 'Argent additionné sans conversion', pourquoi: 'Le taux et sa source sont une décision.', invariant: { type: 'execution' } },
  F2: { mode: 'agent', quoi: 'Lien vers une page inexistante', pourquoi: "Créer la page ou corriger le lien : seul le produit tranche. (Le cas « une seule page candidate » pourrait rejoindre F1 en mécanique, à mesurer.)", invariant: { type: 'execution' } },
  I5: { mode: 'agent', quoi: '« On vide puis on remplit » sans garde sur le vide', pourquoi: 'La garde dépend de ce qui remplit et de ce qui arrive quand la source est vide.', invariant: { type: 'execution' } },

  /* ══ HUMAIN ══════════════════════════════════════════════════════════════ */

  B4: {
    mode: 'humain',
    quoi: 'Secret exposé dans le dépôt',
    pourquoi: "La moitié du travail est hors du dépôt : révoquer la clé chez le fournisseur. Un agent qui la retire du code et n'en dit rien laisse la clé valide dans l'historique git et dans la nature. Le retrait du code est mécanique ; la révocation ne l'est pas, et c'est elle qui compte.",
    invariant: { type: 'texte-absent' },
  },

  G1: {
    mode: 'humain',
    quoi: "Gardes d'identité sans configuration d'authentification",
    pourquoi: "Installer une authentification est un chantier, pas une correction. Tant qu'elle n'est pas là, ce défaut est le PÈRE des 219 B1 : le déclarer une fois et sortir ses enfants du rapport est plus honnête que de compter 219 défauts qu'on ne peut pas corriger.",
    invariant: { type: 'execution' },
  },

  I3: {
    mode: 'humain',
    quoi: 'Aucune trace de sauvegarde',
    pourquoi: "⚠️ `touch scripts/backup.sh` satisfait la règle. La correction réelle est une sauvegarde qui tourne, hors du périmètre qu'elle protège, et une restauration réellement testée. Rien de tout ça ne vit dans un diff.",
    invariant: { type: 'execution' },
  },
};

/* ── Répartition ───────────────────────────────────────────────────────────── */

export function repartir(empreintes) {
  const par = { mecanique: [], agent: [], humain: [], inconnu: [] };
  for (const e of empreintes) {
    const f = FRONTIERE[e.regle];
    (par[f?.mode] || par.inconnu).push(e);
  }
  return par;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const racine = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : null;

  if (!racine) {
    for (const mode of ['mecanique', 'agent', 'humain']) {
      const ids = Object.entries(FRONTIERE).filter(([, f]) => f.mode === mode);
      console.log(`\n══ ${mode.toUpperCase()} · ${ids.length} règle(s)\n`);
      for (const [id, f] of ids) {
        console.log(`  ${id.padEnd(5)} ${f.quoi}`);
        console.log(`        ${f.pourquoi}`);
        const ecrit = f.codemod && !/À ÉCRIRE/.test(f.codemod);
        if (f.codemod) console.log(`        codemod : ${ecrit ? 'codemods/' + f.codemod : '⏳ ' + f.codemod}${f.condition ? `  (si : ${f.condition})` : ''}`);
        if (f.codemodPartiel) console.log(`        codemod partiel : codemods/${f.codemodPartiel}  (si : ${f.condition})`);
        console.log();
      }
    }
    process.exit(0);
  }

  const fichier = path.join(racine, '.backend', 'empreintes.json');
  if (!fs.existsSync(fichier)) { console.error(`Pas d'empreintes. Lancer d'abord : node empreintes.mjs ${racine}`); process.exit(2); }
  const { empreintes } = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  const par = repartir(empreintes);
  const n = empreintes.length;

  console.log(`\n╔══ QUI RÉPARE QUOI ─ ${path.basename(racine)} · ${n} défauts identifiés\n`);
  for (const mode of ['mecanique', 'agent', 'humain', 'inconnu']) {
    const l = par[mode];
    if (!l.length) continue;
    const parRegle = new Map();
    for (const e of l) parRegle.set(e.regle, (parRegle.get(e.regle) || 0) + 1);
    console.log(`  ${mode.toUpperCase().padEnd(10)} ${String(l.length).padStart(4)}  (${Math.round((l.length / n) * 100)} %)`);
    for (const [r, c] of [...parRegle].sort((a, b) => b[1] - a[1])) {
      const f = FRONTIERE[r];
      const dispo = f?.codemod && !/À ÉCRIRE/.test(f.codemod);
      console.log(`      ${r.padEnd(4)} ${String(c).padStart(4)}  ${f?.quoi || '(règle non classée)'}${f?.codemod ? `   → ${dispo ? f.codemod : '⏳ ' + f.codemod}` : ''}`);
    }
    console.log();
  }
  console.log(`  ⚠️  « mécanique » veut dire « un codemod existe », pas « il s'appliquera » : chaque codemod a une condition et rend à l'agent ce qui n'y répond pas.`);
  console.log(`      Sur projet client A, les 219 B1 se réduisent à 109 bascules réelles — les 110 autres sont appelées par un écran ou un script, et relèvent de la dette d'authentification.\n`);
  const bloq = empreintes.filter((e) => e.gravite === 'BLOQUANT');
  const bloqMeca = bloq.filter((e) => FRONTIERE[e.regle]?.mode === 'mecanique').length;
  console.log(`  Sur les ${bloq.length} bloquants : ${bloqMeca} mécaniques, ${bloq.filter((e) => FRONTIERE[e.regle]?.mode === 'agent').length} pour un agent, ${bloq.filter((e) => FRONTIERE[e.regle]?.mode === 'humain').length} pour un humain.\n`);
}
