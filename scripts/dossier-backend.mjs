/**
 * dossier-backend.mjs : le seul endroit où le skill a le droit d'écrire dans un dépôt.
 *
 *     import { dossierBackend } from './dossier-backend.mjs';
 *     const D = dossierBackend(racine);      // <racine>/.backend/, créé, avec son .gitignore
 *
 * Le dossier contient un `.gitignore` qui vaut `*` : rien de ce que le skill produit ne
 * peut finir dans un commit du client, même si le dépôt n'ignore pas `.backend/` lui-même.
 * Leçon d'un audit : 22 fichiers non ignorés retrouvés dans le dépôt d'un client, dont
 * l'export complet de sa base. Les exports de base ne passent jamais par ici : ils vont
 * dans le dossier temporaire du système et sont supprimés après lecture.
 */
import fs from 'node:fs';
import path from 'node:path';

export function dossierBackend(racine) {
  const D = path.join(path.resolve(racine), '.backend');
  fs.mkdirSync(D, { recursive: true });
  const gi = path.join(D, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n');
  return D;
}

/** Écrit un JSON dans .backend/ (ou au chemin explicite demandé par --json) et rend le chemin. */
export function ecrireJson(racine, nom, objet, cheminExplicite = null) {
  const cible = cheminExplicite ? path.resolve(cheminExplicite) : path.join(dossierBackend(racine), nom);
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  fs.writeFileSync(cible, JSON.stringify(objet, null, 1) + '\n');
  return cible;
}
