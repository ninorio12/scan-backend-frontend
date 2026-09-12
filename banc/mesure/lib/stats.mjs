/**
 * stats.mjs — Intervalle de confiance de Wilson.
 *
 * POURQUOI. « 54 % de justesse » sur 26 cas et « 54 % » sur 300 cas ne sont pas le même
 * chiffre : le premier est compatible avec 35 % comme avec 72 %. Toute proportion sortie
 * par ce harnais est donc accompagnée de son intervalle. Wilson et pas Wald, parce que nos
 * effectifs sont petits et nos proportions proches de 0 ou de 1 (1/20 = 5 %), là où Wald
 * donne des bornes absurdes.
 */

const Z = { 90: 1.6449, 95: 1.959964, 99: 2.5758 };

export function wilson(succes, total, niveau = 95) {
  if (total === 0) return { p: null, bas: null, haut: null, n: 0 };
  const z = Z[niveau] || Z[95];
  const p = succes / total;
  const d = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / d;
  const demi = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / d;
  return { p, bas: Math.max(0, centre - demi), haut: Math.min(1, centre + demi), n: total, succes };
}

export const pct = (x) => (x === null ? '  —  ' : (x * 100).toFixed(1).padStart(5) + ' %');

export function ligneIC(label, succes, total, niveau = 95) {
  const w = wilson(succes, total, niveau);
  if (w.p === null) return `${label.padEnd(36)}   —        (0 cas)`;
  return `${label.padEnd(36)} ${pct(w.p)}   [${pct(w.bas)} , ${pct(w.haut)} ]  ${succes}/${total}`;
}

/** Combien de cas pour un intervalle plus étroit que `largeur` ? Réponse honnête à « ton chiffre vaut quoi ». */
export function tailleRequise(pAttendu, largeur = 0.2, niveau = 95) {
  const z = Z[niveau] || Z[95];
  return Math.ceil((4 * z * z * pAttendu * (1 - pAttendu)) / (largeur * largeur));
}

/**
 * La nouvelle proportion est-elle SIGNIFICATIVEMENT plus basse ? (deux proportions, unilatéral)
 * Sans ce test, le cliquet se déclenche sur du bruit d'échantillonnage, donc on le désactive,
 * donc il ne sert plus à rien.
 */
export function baisseSignificative(succes0, n0, succes1, n1, alpha = 0.05) {
  if (!n0 || !n1) return { significatif: false, z: null, p: null };
  const p0 = succes0 / n0, p1 = succes1 / n1;
  const pool = (succes0 + succes1) / (n0 + n1);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n0 + 1 / n1));
  if (se === 0) return { significatif: false, z: 0, p: 1 };
  const z = (p1 - p0) / se;
  const p = normCdf(z);
  return { significatif: p < alpha && p1 < p0, z, p };
}

function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}
