#!/usr/bin/env node
/**
 * parcours.mjs — le canal : ce que trouvent les agents entre dans le bilan.
 *
 *     node parcours.mjs <repo> [--base http://localhost:3000] [--verifier] [--json f]
 *
 * LE PROBLÈME QU'IL RÈGLE, et c'était le plus grave du skill.
 *
 * Le 12/09/2026, six agents ont parcouru une application pendant plus d'une heure chacun
 * et ont trouvé les dix défauts les plus graves du produit : un écran qui donne trois
 * réponses différentes à la même question, un badge « live » écrit en dur, une croissance
 * calculée sur des données de 92 jours sans qu'aucune date ne soit affichée, une barre
 * latérale qui laisse une bande morte de 176 px une fois repliée. AUCUN n'est apparu dans
 * BILAN.md : `bilan.mjs` ne lisait que les sorties mécaniques. La partie du skill qui
 * trouve le plus était celle dont le résultat se perdait.
 *
 * Le même jour, cinq agents ont démenti « 256 boutons morts » (fenêtre d'attente trop
 * courte sur un serveur de dev lent). Donc le canal ne peut pas être une simple boîte aux
 * lettres : dans les deux sens, la parole d'un agent ne suffit pas.
 *
 * LA RÈGLE, dans les deux sens
 *
 *   · Un constat d'agent VÉRIFIÉ confirmé entre au bilan, à sa gravité.
 *   · Un constat INFIRMÉ n'entre pas (il est compté, nommé, et rangé « écarté »).
 *   · Un constat INVÉRIFIABLE entre AVEC la mention et la raison.
 *   · Un constat SANS affirmation vérifiable entre en « rapporté, non vérifié ».
 *     Jamais en confirmé : le bilan n'invente pas.
 *   · Un DÉMENTI (l'agent conteste un constat mécanique) n'efface le constat mesuré
 *     QUE s'il est vérifié. Sur parole, jamais : une mesure ne se retire pas par récit.
 *
 * OÙ ÇA VIT : `<repo>/.backend/parcours/`
 *
 *   groupes.json          le manifeste : qui a été lancé, sur quels écrans.
 *                         Un groupe du manifeste sans rapport = NON COUVERT, nommément.
 *   <groupe>.json         le rapport d'un agent (format ci-dessous).
 *   <groupe>.verifie.json ce que le vérificateur a tranché, écrit par --verifier.
 *
 * LE FORMAT D'UN RAPPORT (references/parcours-reel.md le montre en entier)
 *
 *   {
 *     "groupe": "g1-tableaux",
 *     "agent": "parcours 1 — accueil, analytics, doctor",
 *     "ecrans": ["/", "/analytics", "/doctor"],
 *     "decompte": [ { "ecran": "/", "recenses": 93, "cliques": 90, "ecartes": 2,
 *                     "non_testes": 1, "non_concluants": 0, "pourquoi": "…" } ],
 *     "anomalies": [ { "id": "G1-1", "gravite": "trompe", "famille": "badge « live » en dur",
 *                      "ecran": "/doctor", "quoi": "…", "preuve": "…",
 *                      "affirmation": { "type": "texte_present", "url": "/doctor", "texte": "LIVE" } } ],
 *     "dementis": [ { "id": "G1-D1", "cible": { "famille": "bouton mort", "libelle": "Home" },
 *                     "pourquoi": "54 clics, 54 navigations",
 *                     "affirmation": { "type": "bouton_sans_effet", "url": "/analytics", "libelle": "Home" },
 *                     "tient_si": "infirmée" } ],
 *     "traces": ["…"], "guetteurs_nettoyes": true
 *   }
 *
 * CODES DE SORTIE : 0 tout a rendu et tout tient · 1 des constats ou des manques ·
 * 2 rien n'a pu être lu (pas de dossier parcours, ou manifeste illisible).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ecrireJson } from './dossier-backend.mjs';

/* ── L'échelle, la même que partout ailleurs dans le skill ─────────────────── */
export const GRAVITES = { trompe: 1, 'cassé': 2, casse: 2, dette: 3 };
export const NOM_GRAVITE = { 1: 'trompe', 2: 'cassé', 3: 'dette' };

/* Ce que vaut un constat selon ce que le vérificateur en a dit. « rapporté » n'est pas
   un demi-« confirmé » : c'est l'aveu que personne n'a rejoué la chose. */
export const STATUTS = {
  'confirmée': 'confirmé',
  'invérifiable': 'invérifiable',
  'hors-sujet': 'hors-sujet',
  'infirmée': 'infirmé',
};

const lireJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const nettoyer = (s) => String(s ?? '').replace(/[«»"']/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

/* ── La forme d'un rapport ────────────────────────────────────────────────────
   On ne rejette pas un rapport mal formé : on le dit. Un rapport jeté, c'est le
   défaut d'origine qui revient par la fenêtre.                                   */
export function validerRapport(r, nomFichier) {
  const manques = [];
  if (!r || typeof r !== 'object' || Array.isArray(r)) return { ok: false, manques: ['ce n\'est pas un objet JSON'] };
  if (!r.groupe) manques.push('groupe');
  if (!Array.isArray(r.ecrans) || !r.ecrans.length) manques.push('ecrans');
  if (!Array.isArray(r.decompte) || !r.decompte.length) manques.push('decompte');
  else {
    for (const d of r.decompte) {
      for (const c of ['ecran', 'recenses', 'cliques']) {
        if (d[c] === undefined || d[c] === null) manques.push(`decompte[${d.ecran || '?'}].${c}`);
      }
    }
  }
  if (!Array.isArray(r.anomalies)) manques.push('anomalies (un tableau, vide si tu n\'as rien trouvé)');
  return { ok: !manques.length, manques, fichier: nomFichier };
}

const nombre = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);

export function totauxDecompte(decompte = []) {
  const t = { recenses: 0, cliques: 0, ecartes: 0, non_testes: 0, non_concluants: 0 };
  for (const d of decompte) {
    t.recenses += nombre(d.recenses); t.cliques += nombre(d.cliques); t.ecartes += nombre(d.ecartes);
    t.non_testes += nombre(d.non_testes); t.non_concluants += nombre(d.non_concluants);
  }
  return t;
}

/* ── La lecture du dossier, telle que bilan.mjs la consomme ───────────────────
   Une seule fonction, un seul format : si le bilan et le consolidateur lisaient
   chacun à leur façon, on referait la contradiction qu'on vient de boucher.      */
export function lireParcours(racine) {
  /* Lecture seule : on ne crée rien ici. `dossierBackend` crée le dossier, et un bilan
     lancé sur un chemin qui n'existe pas ne doit pas fabriquer d'arborescence. */
  const dossier = path.join(path.resolve(racine), '.backend', 'parcours');
  const out = {
    dossier, existe: fs.existsSync(dossier), manifeste: null,
    groupes: [], manquants: [], incomplets: [], constats: [], dementis: [],
    totaux: { recenses: 0, cliques: 0, ecartes: 0, non_testes: 0, non_concluants: 0 },
    traces: [], guetteurs: [],
  };
  if (!out.existe) return out;

  out.manifeste = lireJson(path.join(dossier, 'groupes.json'));
  const attendus = new Map();
  for (const g of out.manifeste?.groupes || []) {
    if (g && g.groupe) attendus.set(g.groupe, { groupe: g.groupe, ecrans: g.ecrans || [] });
  }

  const fichiers = fs.readdirSync(dossier)
    .filter((f) => /\.json$/.test(f) && f !== 'groupes.json' && !/\.verifie\.json$/.test(f));

  for (const f of fichiers.sort()) {
    const brut = lireJson(path.join(dossier, f));
    const nomDefaut = f.replace(/\.json$/, '');
    const forme = validerRapport(brut, f);
    const groupe = brut?.groupe || nomDefaut;
    const verifie = lireJson(path.join(dossier, `${nomDefaut}.verifie.json`));
    const parId = new Map();
    for (const r of verifie?.resultats || []) parId.set(r.id, r);

    const t = totauxDecompte(brut?.decompte);
    const g = {
      groupe, fichier: f, agent: brut?.agent || null,
      ecrans: brut?.ecrans || attendus.get(groupe)?.ecrans || [],
      rendu: brut?.rendu || null, forme, decompte: brut?.decompte || [], totaux: t,
      anomalies: 0, retenues: 0, ecartees: 0, non_verifiees: 0, inverifiables: 0,
      confirmees: 0, tauxConfirmation: null, verifie: !!verifie,
      guetteurs_nettoyes: brut?.guetteurs_nettoyes ?? null,
      pourquoi_non_testes: (brut?.decompte || []).filter((d) => nombre(d.non_testes)).map((d) => `${d.ecran} : ${nombre(d.non_testes)} non testés${d.pourquoi ? ` (${d.pourquoi})` : ''}`),
    };
    for (const k of Object.keys(out.totaux)) out.totaux[k] += t[k];
    if (!forme.ok) out.incomplets.push({ groupe, fichier: f, manques: forme.manques });

    /* ── Les constats ─────────────────────────────────────────────────────── */
    for (const a of brut?.anomalies || []) {
      g.anomalies++;
      const v = a.id ? parId.get(a.id) : null;
      const disposition = v?.disposition || null;
      /* Pas de disposition = personne n'a rejoué. Que l'agent ait joint une affirmation
         ou non ne change rien : tant qu'elle n'est pas tranchée, c'est « rapporté ». */
      const statut = disposition ? STATUTS[disposition] : 'rapporté, non vérifié';
      const gravite = GRAVITES[nettoyer(a.gravite)] || 3;
      if (disposition === 'confirmée') g.confirmees++;
      if (disposition === 'invérifiable' || disposition === 'hors-sujet') g.inverifiables++;
      if (!disposition) g.non_verifiees++;
      if (disposition === 'infirmée') {
        g.ecartees++;
        out.constats.push({
          groupe, id: a.id || null, gravite, famille: a.famille || null, quoi: a.quoi || a.dit || '(sans libellé)',
          ecran: a.ecran || null, preuve: a.preuve || null, statut: 'infirmé', raison: v?.raison || null, retenu: false,
        });
        continue;
      }
      g.retenues++;
      out.constats.push({
        groupe, id: a.id || null, gravite, famille: a.famille || null, quoi: a.quoi || a.dit || '(sans libellé)',
        ecran: a.ecran || null, preuve: a.preuve || null, statut, raison: v?.raison || null, retenu: true,
      });
    }
    const tranchees = g.confirmees + g.ecartees;
    g.tauxConfirmation = tranchees ? g.confirmees / tranchees : null;

    /* ── Les démentis : ils n'effacent une mesure QUE vérifiés ─────────────── */
    for (const d of brut?.dementis || []) {
      const v = d.id ? parId.get(d.id) : null;
      const attendu = d.tient_si || 'infirmée';
      const tient = !!v && v.disposition === attendu;
      out.dementis.push({
        groupe, id: d.id || null, cible: d.cible || {}, pourquoi: d.pourquoi || null,
        tient_si: attendu, disposition: v?.disposition || null, raison: v?.raison || null, tient,
      });
    }

    for (const t2 of brut?.traces || []) out.traces.push({ groupe, quoi: t2 });
    if (brut?.guetteurs_nettoyes === false) out.guetteurs.push(groupe);
    out.groupes.push(g);
    attendus.delete(groupe);
  }

  for (const [, g] of attendus) out.manquants.push(g);
  return out;
}

/* ── La vérification d'un lot : on rejoue, on ne croit pas ─────────────────── */

async function verifierGroupe(rapport, ctx, verifier) {
  const affirmations = [];
  for (const a of rapport?.anomalies || []) if (a.affirmation && a.id) affirmations.push({ ...a.affirmation, id: a.id, dit: a.quoi });
  for (const d of rapport?.dementis || []) if (d.affirmation && d.id) affirmations.push({ ...d.affirmation, id: d.id, dit: d.pourquoi });
  const resultats = [];
  for (const a of affirmations) resultats.push(await verifier(a, ctx));
  return resultats;
}

/* ── En ligne de commande ─────────────────────────────────────────────────── */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  /* Le dépôt se donne, il ne se devine pas : `parcours.mjs --verifier` sans chemin
     prendrait « --verifier » pour un dépôt et fabriquerait une arborescence ailleurs.
     Et on ne crée RIEN tant qu'on n'a rien à écrire. */
  const premier = process.argv[2];
  if (!premier || premier.startsWith('--')) {
    console.error('  ⛔ usage : parcours.mjs <repo> [--verifier] [--base <url>] [--attente <ms>] [--json <fichier>]');
    process.exit(2);
  }
  const RACINE = path.resolve(premier);
  const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
  const a = (n) => process.argv.includes(n);
  if (!fs.existsSync(RACINE) || !fs.statSync(RACINE).isDirectory()) {
    console.error(`  ⛔ ${RACINE} n'est pas un dossier (usage : parcours.mjs <repo> [--verifier])`);
    process.exit(2);
  }

  const dossier = path.join(RACINE, '.backend', 'parcours');
  if (!fs.existsSync(dossier)) {
    console.error(`  ⛔ Aucun rapport de parcours : ${dossier} n'existe pas.`);
    console.error(`     L'étape des agents n'a pas eu lieu, ou leurs rapports sont ailleurs.`);
    console.error(`     Le format et la marche à suivre : references/parcours-reel.md`);
    process.exit(2);
  }

  if (a('--verifier')) {
    const { contexte, verifier } = await import('./verifier-affirmation.mjs');
    const ctx = contexte({ repo: RACINE, base: arg('--base', 'http://localhost:3000'), attente: arg('--attente', 2500) });
    try {
      for (const f of fs.readdirSync(dossier).filter((x) => /\.json$/.test(x) && x !== 'groupes.json' && !/\.verifie\.json$/.test(x))) {
        const rapport = lireJson(path.join(dossier, f));
        const resultats = await verifierGroupe(rapport, ctx, verifier);
        if (!resultats.length) { console.log(`  · ${f.padEnd(28)} aucune affirmation à rejouer`); continue; }
        const n = (d) => resultats.filter((r) => r.disposition === d).length;
        fs.writeFileSync(path.join(dossier, `${f.replace(/\.json$/, '')}.verifie.json`),
          JSON.stringify({ groupe: rapport?.groupe || f, base: ctx.base, date: new Date().toISOString(), resultats }, null, 2));
        console.log(`  ✓ ${f.padEnd(28)} ${resultats.length} rejouées · ${n('confirmée')} confirmées · ${n('infirmée')} infirmées · ${n('invérifiable')} invérifiables · ${n('hors-sujet')} hors-sujet`);
      }
    } finally { await ctx.fermer(); }
    console.log('');
  }

  const P = lireParcours(RACINE);

  console.log(`\n  PARCOURS DES AGENTS · ${path.basename(RACINE)}`);
  console.log(`  ${'='.repeat(74)}`);
  console.log(`  ${P.groupes.length} groupe(s) rendu(s)${P.manifeste ? ` sur ${P.groupes.length + P.manquants.length} lancé(s)` : ''}\n`);
  const l = (s, n) => `${String(s).padEnd(n)}`;
  console.log(`  ${l('groupe', 20)}${l('recensés', 10)}${l('cliqués', 9)}${l('écartés', 9)}${l('non testés', 12)}${l('constats', 10)}confirmation`);
  for (const g of P.groupes) {
    console.log(`  ${l(g.groupe, 20)}${l(g.totaux.recenses, 10)}${l(g.totaux.cliques, 9)}${l(g.totaux.ecartes, 9)}${l(g.totaux.non_testes, 12)}${l(g.anomalies, 10)}`
      + `${g.tauxConfirmation == null ? (g.verifie ? '—' : 'non vérifié') : `${Math.round(g.tauxConfirmation * 100)} %`}`);
  }
  console.log(`  ${l('TOTAL', 20)}${l(P.totaux.recenses, 10)}${l(P.totaux.cliques, 9)}${l(P.totaux.ecartes, 9)}${l(P.totaux.non_testes, 12)}${l(P.constats.length, 10)}`);

  if (P.manquants.length) {
    console.log(`\n  ⚠️  GROUPES QUI N'ONT JAMAIS RENDU : ces écrans n'ont pas eu de passage agent`);
    for (const g of P.manquants) console.log(`    ${g.groupe}  ${(g.ecrans || []).join(', ')}`);
  }
  if (P.incomplets.length) {
    console.log(`\n  ⚠️  RAPPORTS SANS DÉCOMPTE COMPLET : pas finis, on relance`);
    for (const i of P.incomplets) console.log(`    ${i.groupe}  manque : ${i.manques.join(', ')}`);
  }
  const retenus = P.constats.filter((c) => c.retenu);
  const ecartes = P.constats.filter((c) => !c.retenu);
  console.log(`\n  ${retenus.length} constat(s) entrent au bilan · ${ecartes.length} écarté(s) par la vérification`);
  console.log(`  dont ${retenus.filter((c) => c.statut === 'confirmé').length} confirmés · `
    + `${retenus.filter((c) => c.statut === 'invérifiable' || c.statut === 'hors-sujet').length} invérifiables · `
    + `${retenus.filter((c) => c.statut === 'rapporté, non vérifié').length} rapportés non vérifiés`);
  const tiennent = P.dementis.filter((d) => d.tient);
  if (P.dementis.length) console.log(`  ${tiennent.length} démenti(s) tiennent sur ${P.dementis.length} (un démenti non vérifié n'efface rien)`);
  if (P.traces.length) {
    console.log(`\n  DONNÉES DE TEST LAISSÉES EN BASE, à retirer avec quelqu'un qui connaît le métier :`);
    for (const t of P.traces) console.log(`    [${t.groupe}] ${t.quoi}`);
  }
  if (P.guetteurs.length) console.log(`\n  ⚠️  Guetteurs non nettoyés : ${P.guetteurs.join(', ')} (boucles d'attente laissées derrière)`);

  const sortie = ecrireJson(RACINE, 'parcours.json', {
    racine: RACINE, date: new Date().toISOString(),
    groupes: P.groupes, manquants: P.manquants, incomplets: P.incomplets,
    totaux: P.totaux, constats: P.constats, dementis: P.dementis, traces: P.traces,
  }, arg('--json', null));
  console.log(`\n  Détail : ${sortie}\n`);
  process.exitCode = (P.manquants.length || P.incomplets.length || retenus.length) ? 1 : 0;
}
