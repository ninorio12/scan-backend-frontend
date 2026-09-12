#!/usr/bin/env node
/**
 * temoins.mjs — La preuve par donnée témoin.
 *
 * L'analyse statique voit un champ rempli d'une valeur écrite en dur. Elle ne verra
 * jamais un champ branché sur la MAUVAISE source, ni un champ branché sur une variable
 * qui se trouve valoir une constante, ni un écran qui affiche le bon libellé et la
 * mauvaise donnée. Une seule chose le prouve : mettre en base des valeurs reconnaissables
 * entre mille, puis regarder l'écran.
 *
 * Principe : chaque valeur du compte de test porte un marqueur unique. Tout ce qui
 * ressemble à une donnée à l'écran et qui ne porte pas le marqueur n'est pas câblé.
 *
 *   node temoins.mjs generer                      → le jeu de valeurs à écrire en base
 *   node temoins.mjs verifier page.html           → ce que l'écran affiche hors source
 *   node temoins.mjs verifier page.html --json
 *
 * Le marqueur par défaut (ZQX) est choisi pour n'exister dans aucune donnée réelle
 * et pour survivre à une mise en majuscules comme à une troncature.
 */

import fs from 'node:fs';

const [, , cmd, cible, ...rest] = process.argv;
const flag = (n, d) => { const f = rest.find((r) => r.startsWith(`--${n}=`)); return f ? f.split('=')[1] : d; };
const MARQUEUR = flag('marqueur', 'ZQX');
const JSON_OUT = rest.includes('--json');

/* ───────────────────────────── generer ──────────────────────────────────── */

const CHAMPS = {
  prenom: (m) => `${m}prenom`,
  nom: (m) => `${m}nom`,
  nomComplet: (m) => `${m}prenom ${m}nom`,
  email: (m) => `${m.toLowerCase()}email@temoin.test`,
  telephone: (m) => `+41 00 ${chiffres(m)} 00`,
  societe: (m) => `${m}societe`,
  adresse: (m) => `${m}rue 1, 0000 ${m}ville`,
  ville: (m) => `${m}ville`,
  poste: (m) => `${m}poste`,
  montant: () => 424242,
  pourcentage: () => 42.42,
  date: () => '2042-04-24',
  note: (m) => `${m}note libre`,
  statut: (m) => `${m}statut`,
  url: (m) => `https://${m.toLowerCase()}.temoin.test`,
};

function chiffres(m) {
  let n = 0;
  for (const c of m) n = (n * 31 + c.charCodeAt(0)) % 90;
  return String(10 + n).padStart(2, '0');
}

if (cmd === 'generer') {
  const jeu = Object.fromEntries(Object.entries(CHAMPS).map(([k, f]) => [k, f(MARQUEUR)]));
  if (JSON_OUT) { console.log(JSON.stringify(jeu, null, 2)); process.exit(0); }
  console.log(`\nJeu de témoins (marqueur « ${MARQUEUR} ») à écrire sur le COMPTE DE TEST :\n`);
  for (const [k, v] of Object.entries(jeu)) console.log(`  ${k.padEnd(14)} ${v}`);
  console.log(`\nÀ écrire dans la base par la voie normale du produit (mutation, seed, formulaire),`);
  console.log(`jamais en modifiant le code de l'écran. Puis parcourir l'application et lancer :`);
  console.log(`  node temoins.mjs verifier <page.html>\n`);
  process.exit(0);
}

/* ───────────────────────────── verifier ─────────────────────────────────── */

if (cmd !== 'verifier' || !cible) {
  console.error('Usage : temoins.mjs generer | temoins.mjs verifier <fichier.html|.txt> [--marqueur=ZQX] [--json]');
  process.exit(2);
}

const brut = fs.readFileSync(cible, 'utf8');

// Ce qui ressemble à une donnée affichée, par ordre de fiabilité.
const SONDES = [
  [/<input[^>]*\bvalue\s*=\s*["']([^"']{1,80})["']/gi, 'champ de saisie'],
  [/<textarea[^>]*>([^<]{1,120})</gi, 'zone de texte'],
  [/\b[\w.+-]+@[\w-]+\.[a-z]{2,}\b/gi, 'email'],
  [/\+?\d[\d\s().-]{8,}\d/g, 'téléphone'],
  [/\b\d{1,3}(?:[ .,]\d{3})+(?:[.,]\d{2})?\s*(?:€|\$|CHF|EUR|USD)/gi, 'montant'],
  [/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g, 'date'],
];

const texte = brut
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ');

const M = MARQUEUR.toLowerCase();
const horsSource = [], conformes = [];

for (const [re, type] of SONDES) {
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(texte))) {
    const val = (m[1] ?? m[0]).trim();
    if (!val || val.length < 2) continue;
    const ligne = texte.slice(0, m.index).split('\n').length;
    const entry = { type, valeur: val.slice(0, 70), ligne };
    // Une même valeur peut être vue par deux sondes (un email dans un champ de saisie) :
    // on ne la signale qu'une fois, sous la sonde la plus précise.
    if (val.toLowerCase().includes(M)) conformes.push(entry);
    else if (!horsSource.some((e) => e.valeur === entry.valeur)) horsSource.push(entry);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify({ marqueur: MARQUEUR, conformes: conformes.length, horsSource }, null, 2));
  process.exitCode = horsSource.length ? 1 : 0;
} else {
  console.log(`\n╔══ PREUVE PAR TÉMOIN ─ ${cible}`);
  console.log(`║  marqueur « ${MARQUEUR} »`);
  console.log(`╚══ ${conformes.length} valeur(s) venant de la source · ${horsSource.length} hors source\n`);
  if (horsSource.length) {
    console.log("Affiché à l'écran sans venir de la source :\n");
    for (const e of horsSource) console.log(`   • ${e.type.padEnd(16)} « ${e.valeur} »   ligne ~${e.ligne}`);
    console.log(`\n⚠️  Chacune est soit une donnée en dur, soit un champ branché sur la mauvaise source.`);
    console.log(`   Un libellé d'interface légitime (« Enregistrer », un nom de colonne) n'est pas concerné :`);
    console.log(`   les sondes ne relèvent que des valeurs de champ, emails, téléphones, montants et dates.\n`);
  } else {
    console.log(`✓ Tout ce que cet écran affiche vient de la source.\n`);
  }
  if (!conformes.length) {
    console.log(`⚠️  Aucune valeur témoin trouvée : soit l'écran n'affiche aucune donnée du compte de test,`);
    console.log(`   soit le jeu de témoins n'a pas été écrit en base. Vérifier avant de conclure.\n`);
  }
}
