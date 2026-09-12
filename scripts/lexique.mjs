import fs from "node:fs";
import path from "node:path";
// lexique.mjs — le socle linguistique de l'apparieur.
// Couche « linguistic matching » de Cupid (Madhavan/Bernstein/Rahm, VLDB 2001) et
// name matcher de COMA (Do & Rahm, VLDB 2002) : normaliser, tokeniser, dé-synonymiser
// AVANT toute mesure, sinon la mesure travaille sur du bruit orthographique.
// Zéro dépendance : l'apparieur doit tourner dans n'importe quel dépôt.

export function deplier(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Découpe camelCase, snake_case, kebab-case, PascalCase et espaces.
 *  ATTENTION : le découpage vient AVANT la mise en minuscules. L'inverse
 *  (bug mesuré : « eventId » restait un seul jeton) coûtait 6 défauts sur 20. */
export function jetons(s) {
  return String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")        // montantHT -> montant HT
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")     // HTMLParser -> HTML Parser
    .replace(/[_\-./:]+/g, " ")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/).filter(Boolean);
}

const VIDES = new Set([
  "le", "la", "les", "de", "du", "des", "un", "une", "l", "d", "et", "ou",
  "the", "a", "an", "of", "to", "in", "on", "for", "by", "is",
  "get", "set", "fetch", "handle", "use", "my", "this", "that",
]);

// Classes d'équivalence. Deux jumeaux ne s'écrivent presque jamais pareil
// d'un bout à l'autre de la chaîne : c'est cette table qui les rapproche.
/* ── Le vocabulaire du MÉTIER, propre à chaque produit ─────────────────────────
   Que « rendez-vous », « visite » et « agenda » désignent la même chose est vrai dans
   un logiciel immobilier et faux ailleurs. Ce lexique-là ne peut pas être deviné et ne
   doit pas être figé dans le skill : il se pose dans le dépôt audité, à la racine,
   dans `.backend/lexique.json` :

       { "visite": "rdv", "agenda": "rdv", "mandat": "mandat", "lot": "bien" }

   Sans ce fichier, le skill fonctionne sur le vocabulaire générique ci-dessous. Avec,
   il reconnaît que quatre modules qui emploient quatre mots différents parlent de la
   même donnée — et c'est là qu'il devient vraiment utile. */
function lexiqueDuProjet() {
  const racine = path.resolve(process.argv[2] || ".");
  for (const p of [path.join(racine, ".backend", "lexique.json"),
                   path.join(racine, "scan-backend.lexique.json")]) {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { /* suivant */ }
  }
  return {};
}

const SYNONYMES = new Map(Object.entries({
  prenom: "prenom", firstname: "prenom", first: "prenom", given: "prenom",
  nom: "nom", name: "nom", lastname: "nomfamille", surname: "nomfamille", famille: "nomfamille",
  fullname: "nomcomplet", nomcomplet: "nomcomplet", displayname: "nomcomplet",
  email: "email", courriel: "email", mail: "email",
  tel: "telephone", telephone: "telephone", phone: "telephone", mobile: "telephone",
  date: "date", le: "date", at: "date", time: "date", horodatage: "date", timestamp: "date",
  cree: "creation", created: "creation", creation: "creation", ajoute: "creation", added: "creation",
  maj: "maj", updated: "maj", modifie: "maj", modified: "maj", update: "maj",
  dernier: "dernier", derniere: "dernier", last: "dernier", latest: "dernier", recent: "dernier",
  debut: "debut", start: "debut", depuis: "debut", from: "debut",
  fin: "fin", end: "fin", until: "fin",
  montant: "montant", amount: "montant", prix: "montant", price: "montant", total: "montant",
  ca: "chiffreaffaires", chiffre: "chiffreaffaires", revenue: "chiffreaffaires", revenu: "chiffreaffaires",
  solde: "solde", balance: "solde",
  statut: "statut", status: "statut", etat: "statut", state: "statut",
  actif: "actif", active: "actif", actifs: "actif", enabled: "actif",
  client: "client", clients: "client", customer: "client", customers: "client",
  lead: "lead", leads: "lead", prospect: "lead", prospects: "lead",
  facture: "facture", factures: "facture", invoice: "facture", invoices: "facture",
  paiement: "paiement", paiements: "paiement", payment: "paiement", payments: "paiement",
  rendezvous: "rdv", rdv: "rdv", rendez: "rdv", vous: "", meeting: "rdv", appointment: "rdv",
  note: "note", notes: "note", commentaire: "note", comment: "note",
  parametre: "parametre", parametres: "parametre", setting: "parametre", settings: "parametre",
  reglage: "parametre", config: "parametre", preference: "parametre",
  organisation: "org", organisations: "org", org: "org", orgs: "org", tenant: "org", workspace: "org",
  membre: "membre", membres: "membre", member: "membre", user: "membre", utilisateur: "membre", users: "membre",
  relance: "relance", relances: "relance", reminder: "relance", rappel: "relance",
  creer: "creer", create: "creer", ajouter: "creer", add: "creer", nouveau: "creer", new: "creer", insert: "creer",
  enregistrer: "enregistrer", save: "enregistrer", sauvegarder: "enregistrer", persist: "enregistrer",
  supprimer: "supprimer", delete: "supprimer", remove: "supprimer", effacer: "supprimer",
  modifier: "modifier", edit: "modifier", patch: "modifier",
  envoyer: "envoyer", send: "envoyer", envoi: "envoyer",
  lister: "liste", liste: "liste", list: "liste", listing: "liste", tous: "liste", all: "liste",
  exporter: "export", export: "export", exports: "export", telecharger: "export", download: "export",
  id: "id", identifiant: "id", ids: "id",
  nombre: "nombre", count: "nombre", nb: "nombre",
  taux: "taux", rate: "taux", ratio: "taux", pourcentage: "taux", conversion: "conversion",
  activite: "activite", activity: "activite",
  commande: "commande", order: "commande",
  semaine: "semaine", week: "semaine", mois: "mois", month: "mois",
  jour: "jour", jours: "jour", day: "jour", days: "jour",
  notification: "notification", notifications: "notification", notif: "notification", alerte: "notification",
  evenement: "event", event: "event", events: "event",
  numero: "numero", number: "numero", num: "numero", reference: "numero", ref: "numero",
  titre: "titre", title: "titre", libelle: "titre", label: "titre", objet: "titre",
  texte: "texte", text: "texte", contenu: "texte", body: "texte", message: "texte",
  valeur: "valeur", value: "valeur", val: "valeur",
  impaye: "impaye", impayees: "impaye", impayee: "impaye", unpaid: "impaye", overdue: "impaye", echue: "impaye",
  paye: "paye", payee: "paye", payees: "paye", paid: "paye", encaisse: "paye",
  gagne: "gagne", won: "gagne", gagnes: "gagne",
  confirme: "confirme", confirmed: "confirme", confirmes: "confirme",
  adresse: "adresse", address: "adresse", rue: "adresse",
  ville: "ville", city: "ville", commune: "ville",
  bien: "bien", biens: "bien", propriete: "bien", property: "bien",
  mandat: "mandat", mandats: "mandat",
  contact: "contact", contacts: "contact",
  tache: "tache", taches: "tache", task: "tache", tasks: "tache",
  retard: "retard", late: "retard", overdue2: "retard",
}));
for (const [k, v] of Object.entries(lexiqueDuProjet())) SYNONYMES.set(k.toLowerCase(), v);

export function normJetons(s) {
  const out = [];
  for (const j of jetons(s)) {
    if (VIDES.has(j)) continue;
    const syn = SYNONYMES.has(j) ? SYNONYMES.get(j) : j;
    if (!syn) continue;
    out.push(syn);
  }
  return out;
}

/** Clé normalisée, stable, comparable : jetons dédoublonnés, triés, collés. */
export function cleNorm(s) {
  return [...new Set(normJetons(s))].sort().join("|");
}

/** Chaîne normalisée dans l'ordre d'origine (Jaro-Winkler est sensible au préfixe). */
export function chaineNorm(s) {
  return normJetons(s).join("");
}

// ---------------------------------------------------------------------------
// UNITÉS. Deux jumeaux peuvent partager le nom et mesurer deux choses :
// « montantHT » et « montantTTC » sont jumeaux et ne sont PAS d'accord.
const UNITES = [
  [/\bttc\b|taxincl|grossamount|incltax/i, "monnaie.ttc"],
  [/\bht\b|hors ?taxe|nettax|excltax/i, "monnaie.ht"],
  [/\bcent(s|imes)?\b|_cents|amount_?cents/i, "monnaie.centimes"],
  [/taux|percent|pourcent|\bpct\b|ratio|rate\b/i, "ratio.pourcent"],
  [/\bms\b|millis|timestamp|epoch|At$|Le$/, "temps.ms"],
  [/\bjours?\b|\bdays?\b|delai/i, "temps.jours"],
  [/montant|amount|prix|price|solde|balance|revenu/i, "monnaie.indeterminee"],
  [/nombre|count|\bnb\b|total/i, "cardinal"],
];

export function unite(nom, typeTexte = "") {
  // Les motifs à frontière de mot (\bht\b, \bttc\b) ne voient pas la coupure d'un nom
  // en casse chameau : « montantHT » rendait « monnaie.indeterminee », et l'attribut
  // « unité » ne séparait jamais un hors-taxes d'un toutes-taxes, à l'inverse de ce que
  // promet le commentaire ci-dessus. On découpe donc en mots AVANT de comparer, et on
  // garde la chaîne brute pour les motifs qui dépendent de la casse (At$, Le$).
  const brut = `${nom} ${typeTexte}`.trim();   // sans espace final, sinon At$ ne voit jamais « createdAt »
  const mots = `${jetons(nom).join(" ")} ${typeTexte}`.trim();
  for (const [re, u] of UNITES) if (re.test(mots) || re.test(brut)) return u;
  return null;
}

/** Désaccord d'unité : même famille, graduation différente. */
export function unitesEnDesaccord(a, b) {
  if (!a || !b || a === b) return false;
  const fa = a.split(".")[0], fb = b.split(".")[0];
  if (fa !== fb) return false;
  if (a.endsWith("indeterminee") || b.endsWith("indeterminee")) return false;
  return true;
}

// ---------------------------------------------------------------------------
// SIMILARITÉS. Jaro-Winkler (Winkler 1990) est le standard du record linkage,
// c'est la mesure de chaîne de splink et dedupe. 30 lignes, zéro dépendance.
export function jaroWinkler(s1, s2) {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length;
  const fenetre = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Array(l1).fill(false), m2 = new Array(l2).fill(false);
  let m = 0;
  for (let i = 0; i < l1; i++) {
    const deb = Math.max(0, i - fenetre), fin = Math.min(l2, i + fenetre + 1);
    for (let j = deb; j < fin; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = m2[j] = true; m++; break;
    }
  }
  if (m === 0) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  t /= 2;
  const jaro = (m / l1 + m / l2 + (m - t) / m) / 3;
  let p = 0;
  while (p < 4 && p < l1 && p < l2 && s1[p] === s2[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

export function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Levenshtein normalisé : détecte la quasi-collision (export / exports). */
export function levenshteinNorm(a, b) {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
