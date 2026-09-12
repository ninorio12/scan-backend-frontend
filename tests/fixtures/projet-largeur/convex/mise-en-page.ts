// Grille d'affichage. Ce fichier ne manipule aucune devise : il ne parle que de pixels.
export const largeurColonne = 0.125;
const hauteurLigne = 1.333;

export function colonnes(n: number) {
  return Array.from({ length: n }, (_, i) => i * largeurColonne * hauteurLigne);
}
