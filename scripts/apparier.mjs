// apparier.mjs — le cœur de l'apparieur. Deux étages.
//
//   1. APPARIEMENT : qui est le jumeau de qui.
//      Emprunté au schema matching (COMA, Do & Rahm VLDB 2002 : plusieurs mesures
//      combinées ; Cupid, VLDB 2001 : la linguistique d'abord ; Similarity Flooding,
//      ICDE 2002 : propagation par le voisinage) et au record linkage (blocking de
//      Fellegi-Sunter, SoftTF-IDF de Cohen/Ravikumar/Fienberg 2003, Jaro-Winkler
//      comme mesure de chaîne : exactement la pile de splink et dedupe).
//
//   2. ACCORD : être jumeaux ne suffit pas, il faut être D'ACCORD.
//      SEPT attributs d'accord, et un seul qui diverge fait le défaut.
//      C'est le renversement : on n'énumère pas les bugs (liste ouverte, jamais
//      finie), on énumère ce que « être d'accord » veut dire (liste fermée).

import { jaroWinkler, levenshteinNorm, cleNorm, unitesEnDesaccord, deplier } from "./lexique.mjs";

// On ne compare que des choses comparables.
const FAMILLE = {
  "champ.schema": "donnee", "champ.projection": "donnee", "champ.affiche": "donnee",
  "champ.ecrit": "donnee", "arg.fonction": "donnee", "arg.appel": "donnee",
  "libelle.ui": "donnee", "index": "donnee", "valeur.endur": "donnee",
  "litteral.vocabulaire": "vocabulaire",
  "route.definie": "chemin", "route.appelee": "chemin", "navigation": "chemin", "ecran": "chemin",
  "fonction.serveur": "capacite", "action.ui": "capacite", "appel": "capacite", "fonction.interne": "capacite",
  "table": "entite", "composant": "vue", "comparaison.texte": "donnee",
  "repli.endur": "donnee", "constante.endur": "donnee",
  "decompte.affiche": "donnee", "filtrage.liste": "donnee", "division": "calcul",
  "operation.ecriture": "op", "operation.suppression": "op", "stockage.local": "op",
  "ecriture.flottante": "op", "ecriture.opaque": "op", "ecriture.nonlocalisee": "op",
  "garde": "garde",
};

// ---------------------------------------------------------------------------
// LISTE NÉGATIVE DURE. Elle ne parle pas de bugs : elle parle de choses dont la
// solitude ou le désaccord n'a AUCUNE signification produit. C'est elle qui
// empêche de refabriquer les 46 % de bruit de l'ancienne approche.
export const LISTE_NEGATIVE = {
  fichiers: [
    /_generated/, /node_modules/, /\.next\//, /\.test\.|\.spec\./, /__tests__/,
    /\/fixtures?\//, /\/mocks?\//, /\.stories\./, /\/scripts?\//, /\.config\./, /\/seed\./,
  ],
  noms: [
    /^_(id|creationTime)$/,                          // réservés du moteur
    /^(className|key|ref|children|style|id)$/,       // plomberie React
    /^(props|args|ctx|e|ev|event|err|error|res|req)$/,
    /^(map|filter|reduce|length|then|catch|slice|split|join|push|includes|toString)$/,
    /^(href|src|alt|type|value|onChange|onClick|onSubmit|checked|placeholder|disabled)$/,
    /^\d+$/, /^[a-z]$/,
  ],
  // classes dont un membre a le droit d'être seul sans que ça signifie quoi que ce soit
  solitudeLegitimeParDefaut: new Set(["libelle.ui", "composant", "action.ui", "ecran", "index", "stockage.local", "comparaison.texte", "repli.endur", "constante.endur", "decompte.affiche", "filtrage.liste", "division"]),
  valeurs: [
    /^(Chargement|Loading|…|\.\.\.|—|-|OK|ok)$/i,
    /^(text|flex|grid|hidden|block|none|auto|left|right|center)$/,
    /^(application\/json|text\/csv|utf-8|POST|GET|PUT|DELETE|Bearer)$/i,
  ],
  // gestes d'interface : un bouton qui n'écrit rien y est NORMAL
  gestesLocaux: /(copier|filtrer|filtre|trier|fermer|annuler|retour|precedent|suivant|imprimer|chercher|afficher|masquer|voir|ouvrir|agrandir|reduire|actualiser|rafraichir|selectionner|choisir|parcourir|telecharger|export|partager|generer|changer|apercu|previsualiser|zoom|focus|relire)/,
  // verbes qui promettent au contraire un effet durable
  verbesEffet: /(enregistrer|sauver|valider|confirmer|publier|envoyer|supprimer|deconnecter|connecter|activer|desactiver|archiver|appliquer|inviter|assigner|planifier)/,
};

function exclu(e) {
  if (LISTE_NEGATIVE.fichiers.some((r) => r.test(e.fichier || ""))) return true;
  if (LISTE_NEGATIVE.noms.some((r) => r.test(e.nom || ""))) return true;
  if (LISTE_NEGATIVE.valeurs.some((r) => r.test(e.nom || ""))) return true;
  if (!e.cle) return true;
  return false;
}

// ---------------------------------------------------------------------------
// ÉTAGE 1 — APPARIEMENT
export function apparier(elements, opts = {}) {
  const seuil = opts.seuil ?? 0.62;
  const actifs = elements.filter((e) => !exclu(e));
  const N = actifs.length;

  // IDF : « statut » ne vaut pas « derniereActivite ».
  const df = new Map();
  for (const e of actifs) for (const t of new Set(e.jetons)) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1)) + 1;

  // Blocking : on ne compare pas N² paires, seulement celles qui partagent
  // un jeton discriminant. C'est ce qui rend l'exhaustivité abordable.
  const seaux = new Map();
  const GENERIQUE = 0.25 * N;
  for (const e of actifs) for (const t of new Set(e.jetons)) {
    if ((df.get(t) || 0) > GENERIQUE) continue;
    if (!seaux.has(t)) seaux.set(t, []);
    seaux.get(t).push(e);
  }
  const candidates = new Set();
  for (const [, g] of seaux) {
    if (g.length > 150) continue;                 // seau dégénéré : ne discrimine rien
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      if (FAMILLE[g[i].classe] !== FAMILLE[g[j].classe]) continue;
      candidates.add(g[i].id < g[j].id ? `${g[i].id} ${g[j].id}` : `${g[j].id} ${g[i].id}`);
    }
  }
  const parId = new Map(actifs.map((e) => [e.id, e]));

  // Mesures combinées (COMA : plusieurs matchers, agrégation pondérée)
  function mesureNom(a, b) {
    if (a.cle && a.cle === b.cle) return 1;
    const A = [...new Set(a.jetons)], B = [...new Set(b.jetons)];
    if (!A.length || !B.length) return 0;
    // SoftTF-IDF : deux jetons comptent s'ils se RESSEMBLENT, pas seulement s'ils sont égaux
    let num = 0;
    for (const ta of A) {
      let best = 0;
      for (const tb of B) { const s = ta === tb ? 1 : jaroWinkler(ta, tb); if (s >= 0.88 && s > best) best = s; }
      num += best * idf(ta) ** 2;
    }
    const na = Math.sqrt(A.reduce((s, t) => s + idf(t) ** 2, 0));
    const nb = Math.sqrt(B.reduce((s, t) => s + idf(t) ** 2, 0));
    const cos = num / (na * nb || 1);
    // recouvrement : « actifs » doit rester candidat jumeau de « clientsActifs »
    const inter = A.filter((t) => B.includes(t));
    const recouv = inter.length ? inter.reduce((s, t) => s + idf(t), 0) / Math.max(na, nb) : 0;
    return Math.max(Math.min(1, cos), Math.min(1, recouv), jaroWinkler(a.chaine, b.chaine) * 0.85);
  }
  const mesureEntite = (a, b) => !a.entite || !b.entite ? 0.5 : (a.entite === b.entite || cleNorm(a.entite) === cleNorm(b.entite)) ? 1 : 0.15;
  function mesureType(a, b) {
    if (a.unite && b.unite) return a.unite === b.unite ? 1 : a.unite.split(".")[0] === b.unite.split(".")[0] ? 0.75 : 0.3;
    const ta = (a.typeTexte || "").replace(/v\.optional\(|\)/g, ""), tb = (b.typeTexte || "").replace(/v\.optional\(|\)/g, "");
    if (ta && tb) return ta === tb ? 1 : 0.45;
    return 0.6;
  }

  const paires = [];
  for (const k of candidates) {
    const [ia, ib] = k.split(" ");
    const a = parId.get(ia), b = parId.get(ib);
    if (!a || !b) continue;
    const n = mesureNom(a, b);
    if (n < 0.35) continue;
    const s = 0.56 * n + 0.24 * mesureEntite(a, b) + 0.20 * mesureType(a, b);
    if (s < seuil - 0.12) continue;
    paires.push({ a: ia, b: ib, nom: n, score: s });
  }

  // Propagation (Similarity Flooding, une itération, version bon marché) :
  // deux éléments se ressemblent davantage si leurs CONTEXTES parlent des
  // mêmes choses. Contexte = le porteur (fonction, écran) puis le fichier.
  const clesDuContexte = new Map();
  for (const e of actifs) for (const k of [e.porteur, e.fichier]) {
    if (!k) continue;
    if (!clesDuContexte.has(k)) clesDuContexte.set(k, new Set());
    clesDuContexte.get(k).add(e.cle);
  }
  const memo = new Map();
  const accordDeContexte = (ka, kb) => {
    if (!ka || !kb) return 0;
    if (ka === kb) return 1;
    const mk = ka < kb ? ka + " " + kb : kb + " " + ka;
    if (memo.has(mk)) return memo.get(mk);
    const A = clesDuContexte.get(ka), B = clesDuContexte.get(kb);
    let r = 0;
    if (A && B) {
      const [p, g] = A.size < B.size ? [A, B] : [B, A];
      let inter = 0;
      for (const x of p) if (g.has(x)) inter++;
      r = inter / (A.size + B.size - inter);
    }
    memo.set(mk, r);
    return r;
  };
  for (const p of paires) {
    const a = parId.get(p.a), b = parId.get(p.b);
    p.propagation = Math.max(accordDeContexte(a.porteur, b.porteur), 0.6 * accordDeContexte(a.fichier, b.fichier));
    p.score = Math.min(1, p.score + 0.12 * p.propagation);
  }
  const retenues = paires.filter((p) => p.score >= seuil);

  // Groupes = composantes connexes (comme dedupe / Zingg)
  const parent = new Map(actifs.map((e) => [e.id, e.id]));
  const trouver = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const p of retenues) { const ra = trouver(p.a), rb = trouver(p.b); if (ra !== rb) parent.set(ra, rb); }
  const groupes = new Map();
  for (const e of actifs) { const r = trouver(e.id); if (!groupes.has(r)) groupes.set(r, []); groupes.get(r).push(e); }

  // TAUX DE GÉMELLITÉ par classe : la réponse MESURÉE à « seul, et c'est normal ».
  const gemellite = {};
  for (const e of actifs) {
    const c = (gemellite[e.classe] ||= { total: 0, accompagnes: 0 });
    c.total++;
    if (groupes.get(trouver(e.id)).length > 1) c.accompagnes++;
  }
  for (const c of Object.values(gemellite)) c.taux = c.accompagnes / c.total;

  return {
    elements: actifs, parId, paires: retenues, groupes, gemellite, trouver,
    stats: {
      elementsBruts: elements.length, elementsActifs: N,
      pairesN2: (N * (N - 1)) / 2, pairesApresBlocking: candidates.size,
      pairesRetenues: retenues.length,
      groupesNonTriviaux: [...groupes.values()].filter((g) => g.length > 1).length,
      reductionBlocking: 1 - candidates.size / ((N * (N - 1)) / 2),
    },
  };
}

// ---------------------------------------------------------------------------
// ÉTAGE 2 — ACCORD. Les sept attributs :
//   A1 existence   : chaque station que le jumelage suppose est bien là
//   A2 source      : les jumeaux remontent à la même donnée
//   A3 formule     : ils sont calculés de la même façon
//   A4 vocabulaire : ils emploient les mêmes valeurs autorisées
//   A5 unite       : ils mesurent avec la même graduation
//   A6 population  : ils portent sur le même ensemble (période, filtre, borne, ordre)
//   A7 garde       : ils sont protégés par les mêmes conditions d'accès
export const ATTRIBUTS = ["existence", "source", "formule", "vocabulaire", "unite", "population", "garde"];

export function accorder(ctx, elements, aretes) {
  const { parId, gemellite } = ctx;
  const out = [];
  const par = (c) => elements.filter((e) => e.classe === c);
  const fns = par("fonction.serveur");
  const fnParFq = new Map(fns.map((f) => [f.fq, f]));
  const fonctions = [...fns, ...par("fonction.interne")];
  const schemas = par("champ.schema");
  const ecrits = par("champ.ecrit");
  const projections = par("champ.projection");
  const affiches = par("champ.affiche");
  const ou = (e) => `${e.fichier}:${e.ligne}`;
  const dire = (o) => { o.confiance = Math.round(100 * (o.jumelage ?? 0.8) * (o.force ?? 0.8)) / 100; out.push(o); };
  /* Un désaccord peut porter un IDENTIFIANT DE RÈGLE (`regleApp`). Ce n'est pas
     un ornement : sans lui, tout ce que l'apparieur dit ressort sous une seule
     étiquette anonyme et aucune mesure ne peut lui attribuer un diagnostic.
     L'identifiant est déclaré dans mesure/familles.mjs à partir du TITRE que la
     règle se donne, jamais à partir de ce qu'on l'a vue sortir. */
  /* Tout ce qu'une fonction écrit, sous toutes les formes, y compris les formes
     que l'extracteur n'a pas su attribuer : c'est le matériau des abstentions. */
  const ecritPar = (fq) => [...ecrits, ...par("operation.ecriture"), ...par("operation.suppression"),
    ...par("ecriture.nonlocalisee"), ...par("ecriture.opaque")].filter((w) => w.porteur === fq);
  const TABLE_TRACE = /journal|log|trace|audit|historique|event/i;
  /* Remonte la chaîne d'une liste locale (`enVente = actifs.filter(...)`,
     `actifs = tous.filter(...)`) jusqu'à sa racine, en gardant au passage tous
     les filtres appliqués : c'est la POPULATION réelle d'une valeur. */
  const chaineListe = (nom, fl, prof = 0) => {
    const f = (fl || {})[nom];
    if (!f || prof > 6) return { racine: nom, preds: [] };
    const m = f.match(/^([A-Za-z_$][\w$]*)\s*\.filter\(([\s\S]*)\)$/);
    if (m) { const r = chaineListe(m[1], fl, prof + 1); return { racine: r.racine, preds: [...r.preds, m[2].replace(/\s+/g, " ").trim().slice(0, 120)] }; }
    const m2 = f.match(/^(?:await\s+)?([A-Za-z_$][\w$]*)\s*\.(reduce|map|slice|sort|concat)\(/);
    if (m2) return chaineListe(m2[1], fl, prof + 1);
    return { racine: nom, preds: [] };
  };

  // ======================================================== A1 — EXISTENCE

  // (a) affiché, mais la fonction qui le sert ne le produit pas
  for (const a of affiches) {
    if (!a.fqSource) continue;
    const f = fnParFq.get(a.fqSource);
    if (!f) continue;
    const champ = (a.cheminSource || a.nom).split(".").pop();
    const cle = cleNorm(champ);
    const projetes = projections.filter((p) => p.porteur === a.fqSource);
    if (!projetes.length) continue;                       // passe-plat : renvoie les documents bruts
    if (projetes.some((p) => p.cle === cle || p.nom === champ)) continue;
    // forme OUVERTE : une clé renvoie une collection non remodelée. On ne sait
    // pas ce qui en sort, donc on n'accuse personne.
    const ouverte = projetes.some((p) => {
      const fo = p.formule || "";
      if (fo.includes("{")) return false;
      const v = fo.split(/[ =.]/)[0];
      const loc = (f.formulesLocales || {})[v] || (fo.includes(" = ") ? fo.split(" = ").slice(1).join(" = ") : "");
      return /ctx\.db\.query|\.collect\(\)|\.take\(|\.filter\(|\.sort\(/.test(loc) && !/\.map\(/.test(loc);
    });
    if (ouverte) continue;
    const auSchema = schemas.find((s) => s.cle === cle && (f.pop?.tables || []).includes(s.entite));
    if (!auSchema) continue;
    dire({
      attribut: "existence", titre: `« ${champ} » est affiché mais la fonction qui le sert ne le produit pas`,
      ou: ou(a), jumeaux: [`${ou(a)} affichage`, `${ou(f)} producteur ${f.fq}`, `${ou(auSchema)} schéma ${auSchema.source}`],
      detail: `${a.fqSource} projette ${projetes.length} champs (${projetes.map((p) => p.nom).slice(0, 8).join(", ")}), aucun ne s'appelle ${champ}. Le schéma le déclare pourtant.`,
      jumelage: 0.95, force: 0.95,
    });
  }

  // (b) un champ que tout le monde lit et que personne n'écrit.
  // Trois abstentions : table jamais remplie par ce dépôt (semences externes),
  // table écrite de façon opaque, clé écrite sans qu'on ait su dire où.
  const tablesRemplies = new Set(ecrits.map((w) => w.entite));
  const tablesOpaques = new Set(par("ecriture.opaque").map((w) => w.entite));
  const clesNonLocalisees = new Set();
  for (const w of par("ecriture.nonlocalisee")) for (const c of (w.cles || [])) clesNonLocalisees.add(c === "*" ? "*" : cleNorm(c));
  for (const s of schemas) {
    if (!tablesRemplies.has(s.entite) || tablesOpaques.has(s.entite)) continue;
    if (clesNonLocalisees.has(s.cle) || clesNonLocalisees.has("*")) continue;
    if (ecrits.some((w) => w.cle === s.cle && w.entite === s.entite)) continue;
    const fnsTable = new Set(fns.filter((f) => (f.pop?.tables || []).includes(s.entite)).map((f) => f.fq));
    const lecteurs = [
      ...projections.filter((p) => p.cle === s.cle && (p.entite === s.entite || fnsTable.has(p.porteur))),
      ...par("index").filter((e) => e.entite === s.entite && (e.champs || []).some((c) => cleNorm(c) === s.cle)),
      ...affiches.filter((e) => e.cle === s.cle && e.fqSource && fnsTable.has(e.fqSource)),
    ];
    if (!lecteurs.length) continue;
    dire({
      attribut: "existence", titre: `« ${s.source} » est lu par ${lecteurs.length} endroit(s) et écrit par aucun`,
      ou: ou(s), jumeaux: [`${ou(s)} schéma`, ...lecteurs.slice(0, 4).map((l) => `${ou(l)} ${l.classe}`)],
      detail: `Aucun insert ni patch de la table ${s.entite} ne renseigne ${s.nom}. Les lecteurs liront toujours vide.`,
      jumelage: 0.9, force: 0.9,
    });
  }

  // (b bis) X6 — UNE TABLE ÉCRITE DE PARTOUT ET LUE PAR PERSONNE
  //
  // Le symétrique exact de (b). Là, un champ que tout le monde lit et que
  // personne n'écrit ; ici, une table que le produit alimente depuis plusieurs
  // endroits et qu'aucune requête, aucun écran, aucune route ne relit. Le travail
  // d'écriture est réel, son destinataire n'existe pas.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais une table écrite depuis UN SEUL endroit : un chantier en cours,
  //      une table d'appoint, ça ne prouve pas l'abandon ;
  //   2. jamais une table absente du schéma : on ne parle que de ce qu'on voit ;
  //   3. jamais une table lue NE SERAIT-CE QU'UNE FOIS — requête, projection,
  //      affichage, index consulté par une requête — même sans savoir par qui ;
  //   4. jamais quand le dépôt n'expose aucune fonction de lecture : l'extraction
  //      n'a pas compris ce produit, on se tait ;
  //   5. jamais une table dont le nom dit qu'elle est une FILE consommée
  //      ailleurs (queue, outbox, webhook, sync) : son lecteur est hors dépôt.
  const lecturesParTable = new Map();
  for (const f of fns) for (const t of (f.pop?.tables || [])) lecturesParTable.set(t, (lecturesParTable.get(t) || 0) + 1);
  for (const i of par("fonction.interne")) for (const t of (i.pop?.tables || [])) lecturesParTable.set(t, (lecturesParTable.get(t) || 0) + 1);
  if (fns.some((f) => /query/i.test(f.kind || ""))) for (const t of par("table")) {          // 4
    if (/queue|file|outbox|webhook|sync|import|export/i.test(t.nom)) continue;               // 5
    const ecritures = [...ecrits, ...par("operation.ecriture")].filter((w) => w.entite === t.nom);
    const porteurs = [...new Set(ecritures.map((w) => w.porteur).filter(Boolean))];
    if (porteurs.length < 2) continue;                                                       // 1
    if (lecturesParTable.get(t.nom)) continue;                                               // 3
    if (projections.some((p) => p.entite === t.nom) || affiches.some((a) => a.entite === t.nom)) continue;  // 3
    dire({
      attribut: "existence", regleApp: "X6",
      titre: `La table « ${t.nom} » est écrite depuis ${porteurs.length} endroits et lue par aucun`,
      ou: ou(t),
      jumeaux: [`${ou(t)} table ${t.nom}`, ...ecritures.slice(0, 4).map((w) => `${ou(w)} ${w.porteur} écrit ${w.nom}`)],
      detail: `Aucune query, aucune projection, aucun écran ne lit ${t.nom}. ${porteurs.join(", ")} l'alimentent pourtant à chaque opération. Ce qu'on y range ne ressort nulle part : le travail est fait pour personne.`,
      jumelage: 0.9, force: 0.85,
    });
  }

  // (c) un réglage stocké, exposé, modifiable, et que rien ne consulte
  const moduleDe = (f) => (f.fq || "").split(/[.:]/)[0];
  const rangement = new Set(fonctions.filter((f) => /^(parametre|reglage|config|setting)/.test(cleNorm(moduleDe(f)))).map((f) => f.fq));
  for (const s of schemas) {
    if (!/^(parametre|reglage|config|preference|setting)/.test(cleNorm(s.entite))) continue;
    if (s.jetons.some((t) => /^(org|id|date|creation|maj|dernier)$/.test(t))) continue;
    if (s.unite === "temps.ms") continue;                 // un horodatage n'est pas un réglage
    if (fonctions.some((f) => !rangement.has(f.fq) && (f.lit || []).includes(s.nom))) continue;
    if (!projections.some((p) => p.cle === s.cle) && !ecrits.some((w) => w.cle === s.cle)) continue;
    dire({
      attribut: "existence", regleApp: "X14",
      titre: `Le réglage « ${s.source} » est stocké, exposé, modifiable, et rien ne le consulte`,
      ou: ou(s), jumeaux: [`${ou(s)} schéma`, ...projections.filter((p) => p.cle === s.cle).slice(0, 2).map(ou)],
      detail: `Aucune des ${fonctions.length} fonctions serveur hors du module de rangement ne cite ${s.nom}. Le comportement qu'il prétend régler ne le lit pas.`,
      jumelage: 0.85, force: 0.9,
    });
  }

  // (d) une action d'écran qui n'écrit nulle part
  for (const a of par("action.ui")) {
    if (a.ecritServeur) continue;
    const nomB = cleNorm(a.nom);
    if (!nomB || nomB === "bouton" || a.nom.startsWith("{")) continue;      // sans libellé, rien n'est promis
    if (LISTE_NEGATIVE.gestesLocaux.test(nomB)) continue;                   // geste d'interface
    if (!LISTE_NEGATIVE.verbesEffet.test(nomB)) continue;                   // ne promet aucun effet durable
    if (a.delegue || (a.mutations || []).some((m) => /^on[A-Z]/.test(m))) continue;  // délégué au parent
    if (a.inconnus && a.inconnus.length) continue;                          // ABSTENTION : chaîne non visible
    if (a.sortReseau) continue;                                             // il part sur le réseau : il écrit ailleurs
    if (a.ouvreQuelqueChose && !a.annonceSucces) continue;                  // ouvre un formulaire, ne conclut rien
    const homonyme = fns.filter((f) => cleNorm(f.nom) === nomB || (a.mutations || []).some((l) => cleNorm(l) === cleNorm(f.nom)));
    const local = par("stockage.local").filter((s) => s.fichier === a.fichier);
    dire({
      attribut: "existence",
      titre: a.annonceSucces
        ? `Le bouton « ${a.nom} » annonce « ${a.annonceSucces} » et n'écrit rien côté serveur`
        : `Le bouton « ${a.nom} » promet un effet et ne déclenche aucune écriture`,
      ou: ou(a),
      jumeaux: [`${ou(a)} bouton`,
        ...(homonyme.length ? [`${ou(homonyme[0])} ${homonyme[0].fq} existe et n'est pas appelée`] : []),
        ...local.slice(0, 1).map((s) => `${ou(s)} écrit dans le stockage local (${s.nom})`)],
      detail: `Le geste appelle ${(a.mutations || []).filter((m) => !/^set[A-Z]/.test(m)).join(", ") || "rien"} et ${local.length ? "range la valeur dans le navigateur" : "ne change que l'état de l'écran"}.${a.annonceSucces ? ` Le message « ${a.annonceSucces} » affirme pourtant que c'est fait.` : ""}${homonyme.length ? ` La mutation ${homonyme[0].fq} attend ce rôle.` : ""}`,
      jumelage: homonyme.length ? 0.9 : 0.75, force: a.annonceSucces ? 0.95 : 0.75,
    });
  }

  // (d bis) X2 — UN ARGUMENT ACCEPTÉ QUE LE CORPS NE LIT JAMAIS
  //
  // La chaîne écran → contrat → écriture a une station déclarée (l'argument) que
  // la suivante ignore. L'écran envoie la valeur, le serveur répond « ok », rien
  // ne change. C'est A1 : une station que le jumelage suppose n'est pas là.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais un argument que le corps lit NE SERAIT-CE QU'UNE FOIS : il peut
  //      servir à valider, à conditionner, à tracer sans jamais être écrit ;
  //   2. jamais quand le corps contient une écriture OPAQUE ou un spread irrésolu
  //      (`...args`) : l'argument y passe peut-être, on ne prétend pas savoir ;
  //   3. jamais un identifiant de cible (`id`, `*Id`) : il désigne la ligne, il
  //      n'est pas une donnée à recopier ;
  //   4. jamais sur une query : un argument non lu y est du code mort, pas une
  //      promesse d'enregistrement rompue ;
  //   5. jamais quand AUCUN autre argument n'est lu : la fonction n'a pas été
  //      comprise, on s'abstient plutôt que d'accuser ;
  //   6. jamais quand le nom n'a pas de jumeau au schéma des tables que la
  //      fonction touche : sans champ jumeau, l'argument ne promet rien de durable ;
  //   8. jamais quand le corps prend ses arguments EN BLOC (`const { id, ...fields }
  //      = args`, `Object.entries(args)`, `{ ...args }`) : ils y passent tous sans
  //      être nommés. Mesuré : 30 faux positifs sur projet client B avant cette clause.
  for (const f of fns) {
    if (!/^(mutation|action)$/.test(f.kind || "")) continue;                  // 4
    const args = par("arg.fonction").filter((a) => a.porteur === f.fq);
    if (args.length < 2) continue;
    const lus = new Set(f.lit || []);
    if (f.argsEnBloc) continue;                                               // 8 (cf. extraire.mjs)
    if (!args.some((a) => lus.has(a.nom))) continue;                          // 5
    const ecritures = ecritPar(f.fq);
    if (!ecritures.length) continue;
    /* 2. Une écriture opaque dont on SAIT les clés (objet local construit par
       affectations successives) n'est plus opaque : elle prouve au contraire ce
       qui est écrit et ce qui ne l'est pas. Une opaque sans clés fait taire. */
    const opaques = ecritures.filter((w) => w.classe === "ecriture.opaque");
    if (opaques.some((w) => !w.cles || !w.cles.length)) continue;             // 2
    const clesOpaques = new Set(opaques.flatMap((w) => w.cles.map(cleNorm)));
    if (!opaques.length && par("ecriture.nonlocalisee").some((w) => w.porteur === f.fq && (w.cles || []).includes("*"))) continue;  // 2
    const tablesF = [...new Set([f.entite, ...(f.pop?.tables || []), ...ecritures.map((w) => w.entite)].filter(Boolean))];
    for (const a of args) {
      if (lus.has(a.nom) || clesOpaques.has(a.cle)) continue;                 // 1
      if (/^(id|_id)$/.test(a.nom) || /Id$/.test(a.nom)) continue;            // 3
      const jumeau = schemas.find((s) => s.cle === a.cle && tablesF.includes(s.entite));
      if (!jumeau) continue;                                                  // 6
      dire({
        attribut: "existence", regleApp: "X2",
        titre: `« ${a.nom} » est accepté par ${f.fq} et le corps ne le lit jamais : l'écran croit l'avoir enregistré`,
        ou: ou(a),
        jumeaux: [`${ou(a)} argument ${a.nom}`, `${ou(f)} ${f.fq} écrit ${[...new Set(ecritures.map((w) => w.entite))].join(", ")}`,
          `${jumeau.fichier}:${jumeau.ligne} ${jumeau.source}`],
        detail: `Les autres arguments (${args.filter((x) => lus.has(x.nom)).map((x) => x.nom).join(", ")}) sont lus et repris dans l'écriture. Celui-ci n'apparaît nulle part dans le corps, alors que ${jumeau.source} l'attend au schéma. La mutation répond succès sans avoir changé ce champ.`,
        jumelage: 0.9, force: 0.95,
      });
    }
  }

  // (e) une tâche planifiée qui calcule son travail puis le jette
  for (const f of fns) {
    if (!/relance|rappel|notification|envoi|synchro|nettoyage|purge|facturation/.test(cleNorm(f.nom))) continue;
    const ecritsF = ecrits.filter((w) => w.porteur === f.fq);
    const cleP = cleNorm(f.nom).split("|");
    const envoie = /fetch|sendMail|runAction|scheduler|resend|sendgrid|postmark/.test(JSON.stringify(f.formulesLocales || {})) ||
      (f.appelsLocaux || []).some((c) => /envoy|send|notif|mail/.test(deplier(c)));
    const retourne = (f.retours || []).map((r) => r.texte).join(" ; ");
    const inutile = Object.entries(f.formulesLocales || {}).filter(([k]) =>
      cleP.some((t) => cleNorm(k).includes(t)) && !JSON.stringify(ecritsF).includes(k) && !new RegExp(`\\b${k}\\b`).test(retourne));
    if (envoie || !inutile.length) continue;
    const champCible = schemas.find((s) => cleP.some((t) => s.cle.includes(t)) && !ecrits.some((w) => w.cle === s.cle));
    dire({
      attribut: "existence", titre: `« ${f.fq} » calcule « ${inutile[0][0]} » puis n'en fait rien`,
      ou: ou(f), jumeaux: [`${ou(f)} ${f.fq}`,
        ...(champCible ? [`${champCible.fichier}:${champCible.ligne} ${champCible.source} jamais écrit`] : []),
        ...ecritsF.slice(0, 2).map((w) => `${ou(w)} écrit ${w.source}`)],
      detail: `Le nom annonce ${f.nom}. Le corps ne produit que ${ecritsF.map((w) => w.nom).join(", ") || "rien"} et aucun envoi. La variable « ${inutile[0][0]} » est le travail abandonné.`,
      jumelage: 0.8, force: 0.85,
    });
  }

  // ============================================================ A2 — SOURCE

  // (a) une valeur en dur là où un champ jumeau existe. C'est « Sophie Martin » :
  // le libellé « Prénom » et le champ « prenom » sont jumeaux ; la valeur
  // affichée n'est le jumeau de personne.
  for (const v of par("valeur.endur")) {
    if (!v.libelle) continue;
    const cle = cleNorm(v.libelle);
    if (!cle || cle.length < 3) continue;
    if (/^(true|false|\d+|#[0-9a-f]{3,8}|[a-z-]+\/[a-z-]+)$/i.test(v.valeur)) continue;
    const candidats = schemas.filter((sc) => sc.cle === cle);
    if (!candidats.length) continue;
    const memeEcran = par("action.ui").filter((b) => b.fichier === v.fichier && !b.ecritServeur && LISTE_NEGATIVE.verbesEffet.test(cleNorm(b.nom)));
    dire({
      attribut: "source", titre: `Le champ « ${v.libelle} » affiche « ${v.valeur} » en dur alors que ${candidats[0].source} existe`,
      ou: ou(v),
      jumeaux: [`${ou(v)} saisie ${v.attribut}="${v.valeur}"`,
        ...candidats.slice(0, 3).map((c) => `${c.fichier}:${c.ligne} ${c.source}`),
        ...memeEcran.slice(0, 1).map((b) => `${ou(b)} bouton « ${b.nom} » qui n'écrit rien`)],
      detail: `Le libellé est le jumeau du champ ${candidats[0].source}. La valeur montrée n'en vient pas : elle est écrite dans le gabarit.${memeEcran.length ? " Et le bouton d'enregistrement de cet écran ne remonte rien au serveur : l'aller ET le retour sont morts." : ""}`,
      jumelage: 0.9, force: memeEcran.length ? 0.95 : 0.8,
    });
  }

  // (a bis) X4 — LE REPLI EN DUR QUI PREND LA PLACE D'UNE DONNÉE SERVEUR
  //
  // `const ventes = evolution ?? VENTES_RECENTES` : quand le serveur n'a pas
  // répondu, l'écran montre six mois de chiffres écrits dans le fichier, avec la
  // même forme que la vraie donnée, donc indiscernables d'elle. Le jumeau du
  // repli est la projection du producteur : même clés, autre source.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais un repli NEUTRE (tableau vide, objet vide, zéro, chaîne vide) :
  //      c'est un état de chargement honnête, il n'invente rien ;
  //   2. jamais un repli qui ne partage pas la FORME de la donnée serveur (moins
  //      de deux clés communes avec la projection) : il n'en est pas le jumeau ;
  //   3. jamais un repli sans chiffre (dictionnaire de libellés, de couleurs, de
  //      traductions) : remplacer un libellé manquant n'est pas fabriquer une
  //      mesure ;
  //   4. jamais un repli dont la gauche n'est pas une donnée serveur : sans
  //      producteur identifié, il n'y a pas de jumeau à contredire.
  for (const r of par("repli.endur")) {
    if (!r.fqSource) continue;                                                // 4
    const k = par("constante.endur").find((c) => c.nom === r.nom && c.fichier === r.fichier);
    if (!k || !k.cles.length) continue;                                       // 1
    if (!k.chiffres) continue;                                                // 3
    const projetes = projections.filter((p) => p.porteur === r.fqSource);
    const communes = k.cles.filter((c) => projetes.some((p) => p.nom === c || p.cle === cleNorm(c)));
    if (communes.length < 2) continue;                                        // 2
    dire({
      attribut: "source", regleApp: "X4",
      titre: `« ${r.gauche} » retombe sur ${k.taille} valeur(s) écrites en dur qui ont la forme de la vraie donnée`,
      ou: ou(r),
      jumeaux: [`${ou(r)} ${r.gauche} ?? ${r.nom}`, `${ou(k)} ${r.nom} (${k.cles.join(", ")})`,
        ...projetes.filter((p) => communes.includes(p.nom)).slice(0, 3).map((p) => `${ou(p)} ${r.fqSource} projette ${p.nom}`)],
      detail: `${r.fqSource} produit exactement ${communes.join(", ")}. Le repli porte les mêmes clés et des chiffres inventés : à l'écran, rien ne distingue la donnée réelle de la donnée de remplissage, et le total affiché est calculé sur elle.`,
      jumelage: 0.9, force: 0.9,
    });
  }

  // (b) une cible qui n'existe pas alors qu'un quasi-jumeau existe
  const routes = par("route.definie").map((r) => r.nom);
  const ecrans = par("ecran").map((r) => r.nom);
  // ${slug} à l'appel et [slug] à la déclaration sont deux graphies du MÊME trou
  const trou = (c) => c.replace(/\$\{[^}]*\}|\[[^\]]*\]|:[A-Za-z_$][\w$]*/g, "*");
  for (const a of [...par("route.appelee"), ...par("navigation")]) {
    if (a.externe || !a.nom.startsWith("/")) continue;
    const cible = a.nom.split("?")[0].replace(/\/$/, "") || "/";
    const univers = [...routes, ...ecrans];
    if (univers.some((r) => trou(r) === trou(cible) || trou(cible).startsWith(trou(r) + "/"))) continue;
    let proche = null, best = 0;
    for (const r of univers) { const s = levenshteinNorm(trou(cible), trou(r)); if (s > best) { best = s; proche = r; } }
    if (best < 0.75) continue;
    dire({
      attribut: "source", titre: `« ${cible} » n'est desservi par rien ; « ${proche} » existe (ressemblance ${Math.round(best * 100)} %)`,
      ou: ou(a), jumeaux: [`${ou(a)} appel`, `route déclarée ${proche}`],
      detail: `Aucun handler ne répond à ${cible}. Le quasi-jumeau ${proche} est à ${Math.max(1, Math.round((1 - best) * cible.length))} caractère(s).`,
      jumelage: best, force: 0.95,
    });
  }

  // (c) suppression sans cascade
  const vusSup = new Set();
  for (const op of par("operation.suppression")) {
    const table = op.entite;
    const k = `${op.porteur}|${table}`;
    if (vusSup.has(k)) continue;
    vusSup.add(k);
    const refs = aretes.filter((x) => x.type === "reference" && x.table === table).map((x) => parId.get(x.de)).filter(Boolean);
    if (!refs.length) continue;
    const autres = par("operation.suppression").filter((o) => o.porteur === op.porteur).map((o) => o.entite);
    const manquantes = refs.filter((r) => !autres.includes(r.entite));
    if (!manquantes.length) continue;
    dire({
      attribut: "source", titre: `Supprimer un « ${table} » laisse ${manquantes.length} table(s) qui le référencent`,
      ou: ou(op), jumeaux: [`${ou(op)} ${op.porteur}`, ...manquantes.slice(0, 5).map((r) => `${r.fichier}:${r.ligne} ${r.source} -> ${table}`)],
      detail: `Le schéma déclare ${[...new Set(manquantes.map((r) => r.entite))].join(", ")} comme dépendants de ${table}. La mutation n'en touche aucun : les lignes deviennent orphelines et restent comptées par les agrégats.`,
      jumelage: 0.9, force: 0.85,
    });
  }

  // ======================================================== A4 — VOCABULAIRE
  // Le lot de littéraux se rattache à un champ par vote majoritaire ;
  // le membre qui n'en fait pas EXACTEMENT partie est le défaut.
  const vocabSchema = schemas.filter((s) => s.vocabulaire && s.vocabulaire.length);
  const lots = new Map();
  for (const l of par("litteral.vocabulaire")) {
    const k = `${l.fichier}|${l.porteur}|${l.champCible}`;
    if (!lots.has(k)) lots.set(k, []);
    lots.get(k).push(l);
  }
  for (const [, lot] of lots) {
    let meilleur = null;
    for (const s of vocabSchema) {
      const ens = new Set(s.vocabulaire);
      const exact = lot.filter((l) => ens.has(l.nom)).length;
      const flou = lot.filter((l) => !ens.has(l.nom) && [...ens].some((v) => deplier(v) === deplier(l.nom) || levenshteinNorm(deplier(v), deplier(l.nom)) > 0.82)).length;
      if (exact >= 1 && (exact + flou) / lot.length >= 0.5 && (!meilleur || exact > meilleur.exact)) meilleur = { s, exact, flou, ens };
    }
    if (!meilleur || !meilleur.flou) continue;
    for (const l of lot) {
      if (meilleur.ens.has(l.nom)) continue;
      const proche = [...meilleur.ens].find((v) => deplier(v) === deplier(l.nom) || levenshteinNorm(deplier(v), deplier(l.nom)) > 0.82);
      if (!proche) continue;
      dire({
        attribut: "vocabulaire", titre: `« ${l.nom} » n'existe pas dans le vocabulaire de ${meilleur.s.source} (qui dit « ${proche} »)`,
        ou: ou(l), jumeaux: [`${ou(l)} littéral`, `${ou(meilleur.s)} ${meilleur.s.source} = ${meilleur.s.vocabulaire.join("|")}`],
        detail: `${meilleur.exact} des ${lot.length} valeurs de ce lot appartiennent bien à ce champ : le lot est branché sur lui. Celle-ci passe à côté, sans erreur de type.`,
        jumelage: 0.9, force: 0.95,
      });
    }
  }

  // ====== A4 (b) X13 — FAIRE REVIVRE UN OBJET CLOS SANS REGARDER SON ÉTAT
  //
  // `refuser` une offre repasse le BIEN en « disponible » sans lire le statut du
  // bien : un bien déjà vendu redevient à vendre. Trois jumeaux le disent :
  // le vocabulaire du schéma, qui ordonne le cycle de vie (disponible →
  // sous_offre → vendu) ; la fonction sœur qui, elle, lit l'état avant d'écrire ;
  // et l'objet visé, qui n'est même pas celui que la mutation prétend traiter.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais un INSERT : donner son premier état à une ligne qu'on crée n'écrase
  //      rien ;
  //   2. jamais la valeur TERMINALE du vocabulaire : on ne ressuscite rien en
  //      allant vers la fin du cycle ;
  //   3. jamais une valeur qui vient d'un ARGUMENT : c'est l'appelant qui décide,
  //      et c'est un autre sujet ;
  //   4. jamais un champ sans vocabulaire déclaré : sans v.union de littéraux, il
  //      n'y a ni cycle ni état ;
  //   5. jamais quand la fonction LIT l'état courant de ce champ sur cette table :
  //      la transition est délibérée ;
  //   6. jamais quand AUCUNE sœur du dépôt ne lit cet état avant d'écrire le même
  //      champ : sans discipline attestée ailleurs, rien ne contredit ;
  //   7. jamais quand l'écriture porte sur la ligne même que la mutation vise
  //      (son argument v.id) : le sujet de la mutation est le sien, et l'écrire
  //      est ce qu'on lui demande. On ne parle que des effets de bord.
  const litEtat = (f, table, cle) => (f?.etatsLus || []).some((e) => cleNorm(e.champ) === cle && e.table === table);
  const tablePrincipale = (f) => {
    const a = par("arg.fonction").find((x) => x.porteur === f.fq && /v\.id\(["'][^"']+["']\)/.test(x.typeTexte || ""));
    return a ? a.typeTexte.match(/v\.id\(["']([^"']+)["']\)/)[1] : null;
  };
  for (const w of ecrits) {
    if (w.operation !== "patch") continue;                                     // 1
    const lit = (w.formule || "").trim().match(/^["']([^"']+)["']$/);
    if (!lit) continue;                                                        // 3
    const sc = schemas.find((s) => s.entite === w.entite && s.cle === w.cle && s.vocabulaire && s.vocabulaire.length > 1);
    if (!sc) continue;                                                         // 4
    const i = sc.vocabulaire.indexOf(lit[1]);
    if (i < 0 || i === sc.vocabulaire.length - 1) continue;                     // 2
    const f = fnParFq.get(w.porteur);
    if (!f || litEtat(f, w.entite, w.cle)) continue;                            // 5
    if (tablePrincipale(f) === w.entite) continue;                              // 7
    const soeurs = ecrits.filter((x) => x.entite === w.entite && x.cle === w.cle && x.porteur !== w.porteur)
      .map((x) => fnParFq.get(x.porteur)).filter((g) => g && litEtat(g, w.entite, w.cle));
    if (!soeurs.length) continue;                                               // 6
    const apres = sc.vocabulaire.slice(i + 1);
    dire({
      attribut: "vocabulaire", regleApp: "X13",
      titre: `${f.fq} repose ${sc.source} à « ${lit[1]} » sans regarder son état courant`,
      ou: ou(w),
      jumeaux: [`${ou(w)} ${sc.source} = "${lit[1]}"`,
        `${ou(sc)} ${sc.source} = ${sc.vocabulaire.join(" → ")}`,
        ...soeurs.slice(0, 2).map((g) => `${ou(g)} ${g.fq} lit l'état avant d'écrire`)],
      detail: `« ${lit[1]} » précède ${apres.join(", ")} dans le vocabulaire du champ. L'écriture porte sur ${w.entite}, qui n'est pas la ligne visée par ${f.fq} : c'est un effet de bord. Une ligne déjà ${apres[apres.length - 1]} redevient ${lit[1]} sans que personne ne l'ait demandé.`,
      jumelage: 0.85, force: 0.85,
    });
  }

  // ================================================ A5 / A6 — MÊME ÉCRAN
  // Un écran est un lieu d'accord : ce qui y est montré côte à côte doit être
  // commensurable, et porter sur la même population.
  const uniteDe = (a) => {
    const champ = (a.cheminSource || a.nom).split(".").pop();
    const p = projections.find((x) => x.porteur === a.fqSource && x.nom === champ);
    if (p && p.formule) {
      if (/montantTTC|\bTTC\b|InclTax/.test(p.formule)) return "monnaie.ttc";
      if (/montantHT|\bHT\b|ExclTax|netAmount/.test(p.formule)) return "monnaie.ht";
    }
    if (p && p.unite && p.unite !== "cardinal") return p.unite;
    return a.unite || null;
  };
  const parEcran = new Map();
  for (const a of affiches) { if (!parEcran.has(a.fichier)) parEcran.set(a.fichier, []); parEcran.get(a.fichier).push(a); }
  for (const [fichier, lot] of parEcran) {
    for (let i = 0; i < lot.length; i++) for (let j = i + 1; j < lot.length; j++) {
      const a = lot[i], b = lot[j];
      if (!a.fqSource || !b.fqSource || a.fqSource === b.fqSource) continue;
      const memeFamille = a.cle === b.cle || (a.unite && a.unite === b.unite) ||
        (/montant|chiffreaffaires|solde/.test(a.cle) && /montant|chiffreaffaires|solde/.test(b.cle));
      if (!memeFamille) continue;
      const ua = uniteDe(a), ub = uniteDe(b);
      if (unitesEnDesaccord(ua, ub)) dire({
        attribut: "unite", titre: `Deux montants du même écran ne sont pas dans la même graduation (${ua} vs ${ub})`,
        ou: ou(a), jumeaux: [`${ou(a)} ${a.nom} <- ${a.fqSource}`, `${ou(b)} ${b.nom} <- ${b.fqSource}`],
        detail: `Le lecteur compare deux nombres qui ne se comparent pas. Écran ${fichier}.`,
        jumelage: 0.8, force: 0.85,
      });
      const fa = fnParFq.get(a.fqSource), fb = fnParFq.get(b.fqSource);
      if (fa?.pop?.periodes.length && fb?.pop?.periodes.length && JSON.stringify(fa.pop.periodes) !== JSON.stringify(fb.pop.periodes)) dire({
        attribut: "population", titre: `Deux valeurs du même écran couvrent deux périodes différentes`,
        ou: ou(a), jumeaux: [`${ou(a)} ${a.nom} <- ${a.fqSource} ${JSON.stringify(fa.pop.periodes)}`, `${ou(b)} ${b.nom} <- ${b.fqSource} ${JSON.stringify(fb.pop.periodes)}`],
        detail: `${a.nom} porte sur ${fa.pop.periodes.join(", ")} ; ${b.nom} porte sur ${fb.pop.periodes.join(", ")}. Même écran, même famille de grandeur.`,
        jumelage: 0.8, force: 0.8,
      });
    }
  }

  // ============== A5 (b) X3 — DEUX CÔTÉS D'UNE RECHERCHE, DEUX GRADUATIONS
  //
  // Mettre une chaîne en minuscules, la débarrasser de ses espaces ou de ses
  // accents, c'est choisir une graduation, exactement comme HT ou TTC. Le terme
  // cherché est abaissé ; si le champ ne l'est pas, les deux ne se rencontrent
  // jamais. Le jumeau qui contredit est la comparaison sœur, écrite trois mots
  // plus loin sur la même ligne, qui abaisse bien son champ.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais quand AUCUNE sœur ne normalise : une recherche sensible à la casse
  //      peut être voulue, et sans sœur contradictoire il n'y a pas de désaccord ;
  //   2. jamais quand le terme cherché n'est pas normalisé lui-même : sans
  //      asymétrie, rien à dire ;
  //   3. jamais sur autre chose qu'une recherche textuelle (déjà filtré à
  //      l'extraction : includes / startsWith / endsWith / indexOf / search) ;
  //   4. jamais quand le champ est STOCKÉ normalisé (`email: args.email.trim()
  //      .toLowerCase()` à l'insert) : les deux côtés sont alors déjà à la même
  //      graduation, et normaliser une seconde fois ne changerait rien ;
  //   5. jamais quand la comparaison est seule de son espèce dans la fonction :
  //      c'est la sœur qui fait la preuve, pas notre goût pour les minuscules.
  const NORMALISE = /\.(toLowerCase|toUpperCase|normalize|trim|toLocaleLowerCase|toLocaleUpperCase)\s*\(/;
  const lotsRecherche = new Map();
  for (const c of par("comparaison.texte")) {
    const k = `${c.porteur}|${c.terme}`;
    if (!lotsRecherche.has(k)) lotsRecherche.set(k, []);
    lotsRecherche.get(k).push(c);
  }
  for (const [, lot] of lotsRecherche) {
    if (lot.length < 2) continue;                                             // 5
    const normalisees = lot.filter((c) => c.normalise);
    if (!normalisees.length) continue;                                        // 1
    const f = fnParFq.get(lot[0].porteur);
    const def = (f?.formulesLocales || {})[lot[0].terme] || "";
    if (!lot[0].termeNormalise && !NORMALISE.test(def)) continue;             // 2
    for (const c of lot) {
      if (c.normalise) continue;
      if (ecrits.some((w) => w.cle === c.cle && NORMALISE.test(w.formule || ""))) continue;   // 4
      dire({
        attribut: "unite", regleApp: "X3",
        titre: `« ${c.nom} » est cherché sans être mis à la même graduation que le terme (${normalisees.map((x) => x.nom).join(", ")} l'est)`,
        ou: ou(c),
        jumeaux: [`${ou(c)} ${c.gauche}.includes(${c.terme})`,
          ...normalisees.slice(0, 2).map((x) => `${ou(x)} ${x.gauche}.includes(${x.terme})`),
          ...(def ? [`${ou(f)} ${c.terme} = ${def.slice(0, 70)}`] : [])],
        detail: `Le terme cherché est ramené en minuscules ; ${c.nom} garde la casse de la base. Les ${normalisees.length} autres champs de la même recherche sont abaissés. Chercher une valeur qui contient une majuscule ne rendra jamais rien, sans aucune erreur.`,
        jumelage: 0.9, force: 0.9,
      });
    }
  }

  // ========== A5 (c) X9 — SOMMER DES MONTANTS SANS REGARDER LEUR GRADUATION
  //
  // `siens.reduce((t, bien) => t + bien.prix, 0)` alors que la table porte un
  // champ « devise » : deux graduations entrent dans le même total et il en sort
  // un nombre qui n'est ni des francs ni des euros. Le jumeau oublié est le champ
  // voisin du montant, au même schéma, que le calcul ne cite jamais.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais quand la table du montant n'a PAS de champ de graduation voisin
  //      (devise, currency, unite, monnaie) : rien ne dit que les lignes diffèrent ;
  //   2. jamais quand le calcul, ou la fonction qui le porte, cite cette
  //      graduation (conversion, groupement, filtre) : le sujet est traité ;
  //   3. jamais quand toutes les écritures de la graduation posent la MÊME valeur
  //      littérale : le produit est mono-devise, la somme est juste ;
  //   4. jamais sur un effectif (`.length`) : compter ne dépend d'aucune unité ;
  //   5. jamais quand le champ sommé n'est pas un montant (ni unité monétaire, ni
  //      nom de montant / prix / total / chiffre d'affaires).
  const GRADUATION = /^(devise|currency|monnaie|unite|unit)$/;
  const MONTANT = /^(montant|prix|total|chiffreaffaires|solde|valeur|somme)/;
  for (const p of projections) {
    const fo = p.formule || "";
    // le corps du reduce contient ses propres parenthèses : `(total, bien) => ...`
    const m = fo.match(/\.reduce\([\s\S]{0,60}?\+\s*([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/);
    if (!m) continue;                                                          // 4
    const champ = m[2], cleChamp = cleNorm(champ);
    /*   6. jamais quand le champ sommé n'est pas déclaré SOUS CE NOM EXACT dans
     *      une table que la fonction lit vraiment. Passer par la clé normalisée
     *      faisait de « montant » un synonyme de « prix » et rattachait le
     *      montant d'une table à la devise d'une autre.
     *      Mesuré : 2 faux positifs sur projet client A (opportunites.montant accusé au nom
     *      de crm_biens.devise), 0 après. */
    const f0 = fnParFq.get(p.porteur);
    const lues = f0?.pop?.tables || [];
    const porteurs = schemas.filter((s) => s.nom === champ && lues.includes(s.entite));
    if (!porteurs.length) continue;                                            // 6
    if (!MONTANT.test(cleChamp) && !porteurs.some((s) => (s.unite || "").startsWith("monnaie"))) continue;  // 5
    const table = porteurs[0].entite;
    const grad = schemas.find((s) => s.entite === table && GRADUATION.test(s.cle));
    if (!grad) continue;                                                       // 1
    const f = fnParFq.get(p.porteur);
    const texte = fo + " " + JSON.stringify(f?.formulesLocales || {}) + " " + (f?.lit || []).join(" ");
    if (new RegExp(`\\b${grad.nom}\\b`, "i").test(texte)) continue;             // 2
    const posees = ecrits.filter((w) => w.entite === table && w.cle === grad.cle).map((w) => (w.formule || "").trim());
    if (posees.length && posees.every((v) => /^["'][^"']+["']$/.test(v) && v === posees[0])) continue;      // 3
    dire({
      attribut: "unite", regleApp: "X9",
      titre: `« ${p.nom} » additionne des ${champ} sans regarder ${grad.source}`,
      ou: ou(p),
      jumeaux: [`${ou(p)} ${fo.slice(0, 80)}`, `${grad.fichier}:${grad.ligne} ${grad.source}`,
        `${porteurs[0].fichier}:${porteurs[0].ligne} ${porteurs[0].source}`],
      detail: `La table ${table} déclare ${grad.source} à côté de ${porteurs[0].source} : deux lignes peuvent ne pas être dans la même graduation. Le total les empile quand même, et l'écran l'affiche sous un seul symbole.`,
      jumelage: 0.85, force: 0.85,
    });
  }

  // ================================= A6 — le chiffre cliquable et sa destination
  for (const n of par("navigation")) {
    const cible = n.nom.split("?")[0];
    const ecranCible = par("ecran").find((e) => e.nom === cible);
    if (!ecranCible) continue;
    // la valeur doit appartenir à la MÊME carte que le lien, sinon on accuse un
    // voisin de page d'une promesse qu'il n'a pas faite.
    const ici = affiches.filter((a) => a.fqSource && (n.carte ? a.carte === n.carte : a.fichier === n.fichier));
    const laBas = affiches.filter((a) => a.fichier === ecranCible.fichier && a.fqSource);
    for (const a of ici) {
      const fa = fnParFq.get(a.fqSource);
      if (!fa?.pop) continue;
      const pa = projections.find((x) => x.porteur === a.fqSource && x.nom === (a.cheminSource || a.nom).split(".").pop());
      if (!pa || !/\.length\b|\.count\b/.test(pa.formule || "")) continue;   // seule une carte-DÉCOMPTE promet une liste
      if (a.unite && a.unite !== "cardinal") continue;
      for (const b of laBas) {
        const fb = fnParFq.get(b.fqSource);
        if (!fb?.pop || fb.fq === fa.fq) continue;
        if (!fa.pop.tables.some((t) => fb.pop.tables.includes(t))) continue;
        const mk = (f) => new Set(f.pop.predicats.filter((q) => q.provenance === "filtre" && !/orgId/.test(q.champ)).map((q) => `${q.champ}${q.op}${q.valeur}`));
        const A = mk(fa), B = mk(fb);
        const durs = [...B].filter((x) => !A.has(x) && !/\bargs?\./.test(x));  // un filtre paramétrable n'est pas une promesse rompue
        if (!durs.length) continue;
        dire({
          attribut: "population", titre: `« ${a.nom} » mène à un écran qui ne montre pas le même ensemble`,
          ou: ou(a), jumeaux: [`${ou(a)} carte -> ${n.nom}`, `${ou(fb)} ${fb.fq} filtre ${durs.join(" & ")}`],
          detail: `Le décompte vient de ${fa.fq} (filtres ${[...A].join(" & ") || "aucun"}). La destination applique en plus ${durs.join(" & ")}. Le chiffre cliqué ne se retrouve jamais.`,
          jumelage: 0.75, force: 0.8,
        });
        break;
      }
    }
  }

  // ================= A6 (c) X5 — LE DÉCOMPTE ET LE DÉTAIL QU'IL ANNONCE
  //
  // Une carte « Visites cette semaine : 12 » et, juste dessous, la grille qui
  // retire les visites annulées : on lit 12 et on en compte 9. Le décompte et sa
  // liste sont jumeaux par construction (même variable, même écran) et ils ne
  // portent pas sur le même ensemble.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais quand le décompte est lui-même filtré (`X.filter(...).length`) :
  //      il est alors d'accord avec sa liste — l'extraction ne retient que la
  //      forme brute `X.length` ;
  //   2. jamais quand l'écart tient à un filtre de RECHERCHE, d'onglet ou d'état
  //      d'écran : l'extraction n'accepte comme écart qu'un prédicat portant sur
  //      une propriété de la ligne elle-même (`visite.annulee`) ;
  //   3. jamais quand la variable comptée n'est pas une donnée serveur : deux
  //      vues d'un tableau local ne promettent rien à personne ;
  //   4. jamais quand le décompte n'a pas de libellé : sans intitulé, il
  //      n'annonce aucune liste ;
  //   5. jamais deux fois le même couple libellé/prédicat.
  const vusDecompte = new Set();
  for (const d of par("decompte.affiche")) {
    if (!d.libelle || !d.fqSource) continue;                                  // 3 et 4
    const filtres = par("filtrage.liste").filter((x) => x.fichier === d.fichier && x.variable === d.variable);
    if (!filtres.length) continue;
    const k = `${d.libelle}|${filtres.map((x) => x.predicat).join(",")}`;
    if (vusDecompte.has(k)) continue;                                         // 5
    vusDecompte.add(k);
    dire({
      attribut: "population", regleApp: "X5",
      titre: `« ${d.libelle} » compte tout ${d.variable} ; la liste du même écran en écarte ${filtres.map((x) => x.predicat).join(", ")}`,
      ou: ou(d),
      jumeaux: [`${ou(d)} ${d.variable}.length sous « ${d.libelle} »`,
        ...filtres.slice(0, 3).map((x) => `${x.fichier}:${x.ligne} écarte ${x.predicat} (${x.forme})`),
        `source ${d.fqSource}`],
      detail: `Le chiffre et le détail viennent de la même requête ${d.fqSource}. Le détail applique ${filtres.map((x) => x.predicat).join(" & ")}, le chiffre non. On lit un nombre et on en compte un autre juste en dessous.`,
      jumelage: 0.85, force: 0.9,
    });
  }

  // ============= A6 (e) X10 — LE COMPTEUR ET LA LISTE QUE L'ON OUVRE
  //
  // `nombreBiens: siens.length` où `siens` écarte les archivés, et, dans le même
  // module, `biensDuProprietaire` qui rend la liste SANS les écarter. On clique
  // sur 3 et on en voit 5. Les deux jumeaux lisent la même table ; seule leur
  // population diffère, et la différence n'est pas un paramètre.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais entre deux fonctions qui ne lisent pas la même table ;
  //   2. jamais entre deux modules différents : sans voisinage, rien n'établit
  //      que ce chiffre ouvre cette liste-là ;
  //   3. jamais sur un écart qui tient à un PARAMÈTRE (`args.`), à l'identité de
  //      la ligne (`_id`) ou au locataire : ce sont des cadrages, pas des
  //      définitions ;
  //   4. jamais quand la « liste » remodèle ce qu'elle rend (elle a des
  //      projections) : ce n'est plus la liste du compteur, c'est un autre écran ;
  //   5. jamais quand les deux populations sont identiques ;
  //   6. jamais quand le compteur n'est pas un effectif (`.length`).
  const ATOMES = (texte) => {
    const out = new Set();
    for (const m of texte.matchAll(/!\s*[a-z][\w$]*\.([A-Za-z_$][\w$]*)/g)) out.add("!" + m[1]);
    for (const m of texte.matchAll(/[a-z][\w$]*\.([A-Za-z_$][\w$]*)\s*(===|!==|>=|<=|>|<)\s*("[^"]*"|'[^']*'|[\w.$]+)/g))
      out.add(m[1] + m[2] + m[3]);
    return [...out].filter((a) => !/\bargs?\.|_id|orgId|tenant|workspace/.test(a));       // 3
  };
  const sourceListe = (nom, fl) => {
    const c = chaineListe(nom, fl);
    const def = (fl || {})[c.racine] || "";
    const t = def.match(/ctx\.db\s*\.?\s*query\(["']([^"']+)["']\)/);
    return { table: t ? t[1] : null, preds: c.preds };
  };
  for (const p of projections) {
    const cnt = (p.formule || "").match(/([A-Za-z_$][\w$]*)\.length\b/);
    if (!cnt) continue;                                                                   // 6
    const A = fnParFq.get(p.porteur);
    if (!A) continue;
    const src = sourceListe(cnt[1], A.formulesLocales);
    if (!src.table || !src.preds.length) continue;
    const atomesA = ATOMES(src.preds.join(" && "));
    if (!atomesA.length) continue;
    for (const B of fns) {
      if (B.fq === A.fq || B.fichier !== A.fichier) continue;                              // 2
      if (!/query/i.test(B.kind || "")) continue;
      if (projections.some((x) => x.porteur === B.fq)) continue;                           // 4
      const ret = (B.retours || []).map((r) => r.texte).join(" ; ");
      const racine = (ret.match(/([A-Za-z_$][\w$]*)\s*\.filter\(/) || [])[1];
      if (!racine) continue;
      /*   7. jamais quand le compteur et la liste ne NOMMENT PAS le même sujet.
       *      Un module a toujours des compteurs et une liste ; ça ne veut pas dire
       *      que ce chiffre-là ouvre cette liste-là. On exige un jeton commun hors
       *      plomberie : « nombreBiens » et « biensDuProprietaire » partagent
       *      « bien », « ouvertes » et « lister » ne partagent rien.
       *      Mesuré : 8 alertes sur projet client A, 8 douteuses, avant. */
      const PLOMBERIE = /^(lister|liste|obtenir|recuperer|charger|tous|toutes|par|nombre|total|compteur|cockpit|synthese)$/;
      const jA = (p.jetons || []).filter((t) => !PLOMBERIE.test(t));
      const jB = (B.jetons || []).filter((t) => !PLOMBERIE.test(t));
      if (!jA.some((t) => jB.includes(t))) continue;                                       // 7
      const srcB = sourceListe(racine, B.formulesLocales);
      if (srcB.table !== src.table) continue;                                              // 1
      const atomesB = ATOMES([ret, ...srcB.preds].join(" && "));
      const enPlus = atomesA.filter((x) => !atomesB.includes(x));
      if (!enPlus.length || JSON.stringify(atomesA) === JSON.stringify(atomesB)) continue;  // 5
      dire({
        attribut: "population", regleApp: "X10",
        titre: `« ${p.nom} » compte ${src.table} avec ${enPlus.join(" & ")} ; « ${B.nom} » rend la liste sans`,
        ou: ou(p),
        jumeaux: [`${ou(p)} ${A.fq} : ${atomesA.join(" & ")}`, `${ou(B)} ${B.fq} : ${atomesB.join(" & ") || "aucun filtre"}`],
        detail: `Les deux lisent ${src.table} dans le même module. Le chiffre écarte ${enPlus.join(" & ")}, la liste les garde. On clique sur le nombre et on n'en retrouve pas le compte.`,
        jumelage: 0.8, force: 0.85,
      });
      break;
    }
  }

  // ============================ A6 — deux définitions d'un même concept métier
  /** Les conditions écrites DANS le calcul d'une valeur : sa définition à elle.
   *  Comparer les prédicats de TOUTE la fonction n'a aucun sens dès qu'elle fait
   *  plusieurs choses : c'est cette sur-généralisation qui fabrique le bruit. */
  function predicatsDuCalcul(el, f) {
    let texte = el.formule || "";
    if (!texte && el.classe === "fonction.serveur") texte = (el.retours || []).map((r) => r.texte).join(" ; ");
    for (const [k, v] of Object.entries((f && f.formulesLocales) || {})) if (texte.includes(k) && v.length < 400) texte += " ; " + v;
    texte = texte.replace(/\s*\?\?\s*[\w"'[\]{}]+\s*\)?/g, " ");   // (x ?? 0) > y : le repli cache le champ
    const out = new Set();
    const re = /\.?([A-Za-z_$][\w$]*)\s*\)?\s*(===|!==|>=|<=|>|<)\s*("[^"]*"|'[^']*'|[\w.$()\s+*/-]{1,40})/g;
    let m;
    while ((m = re.exec(texte))) {
      const [, champ, op, valBrut] = m;
      const val = valBrut.trim();
      if (/^(args?|ctx|length|undefined|null)$/.test(champ)) continue;
      if (/\bargs?\./.test(val)) continue;          // paramètre, pas définition
      if (/orgId|tenant|workspace/.test(champ)) continue;
      out.add(champ + op + val);
    }
    return [...out];
  }
  const fnsParTable = new Map();
  for (const f of fns) for (const t of (f.pop?.tables || [])) { if (!fnsParTable.has(t)) fnsParTable.set(t, []); fnsParTable.get(t).push(f); }
  const vusPaires = new Set();
  for (const [, lot] of fnsParTable) {
    if (lot.length > 60) continue;
    for (let i = 0; i < lot.length; i++) for (let j = i + 1; j < lot.length; j++) {
      const A = lot[i], B = lot[j];
      const kp = A.fq < B.fq ? A.fq + "|" + B.fq : B.fq + "|" + A.fq;
      if (vusPaires.has(kp)) continue;
      vusPaires.add(kp);
      const tcom = A.pop.tables.filter((t) => B.pop.tables.includes(t));
      if (!tcom.length) continue;
      const projA = projections.filter((p) => p.porteur === A.fq), projB = projections.filter((p) => p.porteur === B.fq);
      const couples = [];
      if (cleNorm(A.nom) && cleNorm(A.nom) === cleNorm(B.nom)) couples.push([A, B]);
      const qualifiant = /actif|impaye|paye|gagne|confirme|valide|encours|retard|vendu|ouvert/;
      for (const pa of [A, ...projA]) for (const pb of [B, ...projB]) {
        if (pa === A && pb === B) continue;
        const ka = cleNorm(pa.nom), kb = cleNorm(pb.nom);
        if (!ka || !kb) continue;
        const inclus = ka === kb ||
          (ka.split("|").every((t) => kb.split("|").includes(t)) && kb !== ka && ka.split("|").some((t) => qualifiant.test(t))) ||
          (kb.split("|").every((t) => ka.split("|").includes(t)) && ka !== kb && kb.split("|").some((t) => qualifiant.test(t)));
        if (inclus) couples.push([pa, pb]);
      }
      for (const [pa, pb] of couples) {
        // un passe-plat homonyme n'est pas une définition : ni un champ du schéma,
        // ni une table, ni le nom de la fonction elle-même.
        const kk = cleNorm(pa.nom);
        if (kk === cleNorm(pb.nom)) {
          if (schemas.some((sc) => sc.cle === kk)) continue;
          if (par("table").some((t) => t.cle === kk)) continue;
          if (kk === cleNorm(A.nom) || kk === cleNorm(B.nom)) continue;
        }
        const fA = predicatsDuCalcul(pa, A), fB = predicatsDuCalcul(pb, B);
        if (!fA.length || !fB.length) continue;
        const mA = new Set(fA), mB = new Set(fB);
        const dA = fA.filter((x) => !mB.has(x)), dB = fB.filter((x) => !mA.has(x));
        if (!dA.length || !dB.length) continue;
        dire({
          attribut: "population", titre: `« ${pa.nom} » et « ${pb.nom} » nomment le même concept et ne le définissent pas pareil`,
          ou: ou(pa), jumeaux: [`${ou(pa)} ${A.fq} : ${dA.join(" & ")}`, `${ou(pb)} ${B.fq} : ${dB.join(" & ")}`],
          detail: `Même table (${tcom.join(", ")}), même nom normalisé, deux prédicats disjoints. Deux chiffres qui ne tomberont jamais d'accord.`,
          jumelage: 0.8, force: 0.75,
        });
      }
    }
  }

  // ============ A6 (d) X8 — UNE MOYENNE DONT LA SOMME ET L'EFFECTIF DIVERGENT
  //
  // `prixMoyen = valeurPortefeuille / actifs.length` où la valeur ne somme que les
  // biens EN VENTE et l'effectif compte TOUS les biens actifs. Une moyenne n'a de
  // sens que si son numérateur et son dénominateur portent sur le même ensemble ;
  // c'est la différence avec un taux, où le numérateur est justement un
  // sous-ensemble du dénominateur. D'où la clause la plus importante de la liste :
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais un TAUX (deux effectifs) : offresAcceptees / offresRecues doit
  //      avoir deux populations, c'est sa définition. On n'accepte que somme ÷
  //      effectif, c'est-à-dire une moyenne ;
  //   2. jamais quand les deux côtés n'ont pas d'ANCÊTRE COMMUN : deux grandeurs
  //      sans origine partagée ne sont pas deux découpes d'un même ensemble ;
  //   3. jamais quand les deux côtés portent les mêmes filtres ;
  //   4. jamais quand l'écart tient à un filtre PARAMÉTRÉ (`args.`) ou au filtre
  //      de locataire : ce n'est pas une définition divergente ;
  //   5. jamais quand le dénominateur n'est pas un effectif (`.length`) ni le
  //      numérateur une somme (`reduce` / `+=`) : on ne sait pas ce qu'on compare.
  for (const p of projections) {
    const f = fnParFq.get(p.porteur);
    if (!f) continue;
    const fl = f.formulesLocales || {};
    const d = (p.formule || "").match(/([A-Za-z_$][\w$]*)\s*\/\s*([A-Za-z_$][\w$]*)\.length\b/);
    if (!d) continue;                                                          // 5 (dénominateur)
    const [, num, den] = d;
    if (!/\.reduce\(|\+=/.test(fl[num] || "")) continue;                        // 1 et 5 (numérateur)
    const A = chaineListe(num, fl), B = chaineListe(den, fl);
    if (A.racine !== B.racine) continue;                                        // 2
    const enPlus = A.preds.filter((x) => !B.preds.includes(x)).concat(B.preds.filter((x) => !A.preds.includes(x)));
    if (!enPlus.length) continue;                                               // 3
    if (enPlus.some((x) => /\bargs?\.|orgId|tenant|workspace/.test(x))) continue;  // 4
    dire({
      attribut: "population", regleApp: "X8",
      titre: `« ${p.nom} » divise une somme et un effectif qui ne portent pas sur le même ensemble`,
      ou: ou(p),
      jumeaux: [`${ou(p)} ${p.nom} = ${num} / ${den}.length`,
        `${num} somme ${A.preds.join(" & ") || "tout"} (depuis ${A.racine})`,
        `${den} compte ${B.preds.join(" & ") || "tout"} (depuis ${B.racine})`],
      detail: `Les deux côtés descendent de « ${A.racine} », mais l'un écarte ${enPlus.join(" & ")} et l'autre non. Une moyenne dont la somme et l'effectif ne couvrent pas le même ensemble ne mesure rien : le chiffre affiché est toujours faux, et d'autant plus que l'écart grandit.`,
      jumelage: 0.85, force: 0.9,
    });
  }

  // ============================== A6 — un agrégat calculé sur un échantillon
  for (const p of projections) {
    if (!/^(montant|nombre|chiffreaffaires|solde)/.test(p.cle) && !/total/.test(deplier(p.nom))) continue;
    if (!/reduce|length|\.filter\(/.test(p.formule || "")) continue;
    const f = fnParFq.get(p.porteur);
    const take = f?.pop?.bornes.find((b) => b.startsWith("take:"));
    if (!take) continue;
    const n = Number(take.split(":")[1]);
    if (!Number.isFinite(n)) continue;
    dire({
      attribut: "population", titre: `« ${p.nom} » est présenté comme un total mais n'agrège que les ${n} lignes ramenées`,
      ou: ou(p), jumeaux: [`${ou(p)} agrégat`, `${ou(f)} ${f.fq} ${take}`],
      detail: `La borne ${take} coupe la population avant l'agrégation. Le nom promet la période, le calcul livre la page.`,
      jumelage: 0.85, force: 0.8,
    });
  }

  // =========================================================== A3 — FORMULE

  // (a) le nom promet un ordre que la requête ne donne pas
  for (const p of projections) {
    if (!p.jetons.includes("dernier")) continue;
    if (schemas.some((sc) => sc.cle === p.cle)) continue;   // récence STOCKÉE, pas sélectionnée
    const f = fnParFq.get(p.porteur);
    if (!f?.pop || f.pop.ordre === "desc" || !f.pop.bornes.includes("first")) continue;
    const vientDeLaRequete = Object.entries(f.formulesLocales || {}).some(([k, v]) =>
      new RegExp(`\\b${k}\\b`).test(p.formule || "") && /ctx\.db\.query|withIndex/.test(v));
    if (!vientDeLaRequete) continue;
    const pairs = fns.filter((g) => g !== f && g.pop?.ordre === "desc").length;
    dire({
      attribut: "formule", regleApp: "X15",
      titre: `« ${p.nom} » désigne le plus récent, la requête ne trie pas`,
      ou: ou(p), jumeaux: [`${ou(p)} nom`, `${ou(f)} ${f.fq} bornes ${f.pop.bornes.join(",")} ordre ${f.pop.ordre || "implicite"}`],
      detail: `${pairs} autres requêtes du produit posent .order("desc") avant de prendre. Celle-ci prend le premier de l'ordre d'insertion, c'est-à-dire le plus ancien.`,
      jumelage: 0.85, force: 0.85,
    });
  }

  // (b) le chemin de secours est indiscernable du chemin nominal
  for (const f of fns) {
    const nom = (f.retours || []).filter((r) => r.branche === "nominal" && r.cles.length);
    for (const s of (f.retours || []).filter((r) => r.branche === "secours" && r.cles.length)) {
      const jumeau = nom.find((n2) => n2.cles.length === s.cles.length && n2.cles.every((k) => s.cles.includes(k)));
      if (!jumeau) continue;
      if (s.cles.some((k) => /^(ok|erreur|error|statut|status|panne|echec)$/i.test(k))) continue;
      dire({
        attribut: "formule", titre: `Le secours de ${f.fq} renvoie exactement la forme du succès`,
        ou: `${f.fichier}:${s.ligne}`,
        jumeaux: [`${f.fichier}:${s.ligne} secours ${s.texte}`, `${f.fichier}:${jumeau.ligne} nominal {${jumeau.cles.join(", ")}}`],
        detail: `Aucun champ ne distingue la panne de la donnée. En aval, « ${s.texte} » s'affichera comme une vraie valeur.`,
        jumelage: 0.85, force: 0.85,
      });
    }
  }

  // (b bis) X7 — LE CATCH QUI AVALE LA PANNE ET RÉPOND SUCCÈS
  //
  // `try { patch } catch { console.error } return { ok: true }` : l'écran retire
  // la carte, la base a gardé la ligne. Les mutations sœurs du même module, elles,
  // laissent l'erreur remonter : l'écran y apprend l'échec. Deux disciplines de
  // panne sous une même promesse, c'est un désaccord sur la formule du retour.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais un catch qui relance, qui retourne, ou qui répond 4xx/5xx : il
  //      transmet la panne, c'est tout ce qu'on lui demande ;
  //   2. jamais une fonction qui ne promet pas le succès : sans `ok: true` ni
  //      identifiant renvoyé, avaler est un choix assumé et visible ;
  //   3. jamais quand AUCUNE sœur du module ne laisse remonter d'erreur : si tout
  //      le module avale, c'est sa discipline, pas une exception — et il n'y a
  //      aucun jumeau pour la contredire ;
  //   4. jamais sur une query : une lecture qui échoue en silence relève d'un
  //      autre contrôle (le secours qui a la forme du succès, ci-dessus) ;
  //   5. jamais un module de moins de deux mutations : pas de sœur, pas d'accord.
  const mutationsParModule = new Map();
  for (const f of fns) {
    if (!/^(mutation|action)$/.test(f.kind || "")) continue;                   // 4
    if (!mutationsParModule.has(f.fichier)) mutationsParModule.set(f.fichier, []);
    mutationsParModule.get(f.fichier).push(f);
  }
  for (const [fichier, lot] of mutationsParModule) {
    if (lot.length < 2) continue;                                              // 5
    const severes = lot.filter((f) => f.leve && !(f.avale || []).length);
    if (!severes.length) continue;                                             // 3
    for (const f of lot) {
      for (const a of f.avale || []) {                                         // 1 (filtré à l'extraction)
        const promesse = (f.retours || []).find((r) => /ok\s*:\s*true|success|succes/i.test(r.texte) ||
          (r.branche === "nominal" && /^[A-Za-z_$][\w$]*Id$/.test(r.texte.trim())));
        if (!promesse) continue;                                               // 2
        dire({
          attribut: "formule", regleApp: "X7",
          titre: `${f.fq} avale sa panne et répond quand même « ${promesse.texte.slice(0, 40)} »`,
          ou: `${f.fichier}:${a.ligne}`,
          jumeaux: [`${f.fichier}:${a.ligne} catch { ${a.texte.slice(0, 60)} }`,
            `${f.fichier}:${promesse.ligne} retourne ${promesse.texte.slice(0, 60)}`,
            ...severes.slice(0, 2).map((s) => `${ou(s)} ${s.fq} laisse l'erreur remonter`)],
          detail: `${severes.length} des ${lot.length} mutations de ${fichier} laissent l'erreur remonter : l'écran y apprend l'échec. Celle-ci l'écrit dans la console et répond succès. L'appelant retire la ligne de l'écran, la base la garde.`,
          jumelage: 0.85, force: 0.9,
        });
      }
    }
  }

  // (c) X11 — une valeur de repli sortie de nulle part
  //
  // Le cas limite se reconnaît à trois formes : population vide (`x.length === 0
  // ? N :`), calcul impossible (`Number.isNaN(t) ? N :`), division non finie
  // (`!isFinite(t) ? N :`). Dans les trois, le produit n'a RIEN mesuré et affiche
  // quand même un nombre. Ce nombre n'est le jumeau d'aucune donnée réelle.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais quand le repli vaut ZÉRO : ne rien avoir et afficher zéro est la
  //      seule réponse honnête, c'est le repli neutre ;
  //   2. jamais quand le repli est une DONNÉE (variable, autre champ) : il est
  //      alors le jumeau de quelque chose, et c'est un choix traçable ;
  //   3. jamais hors d'une projection : une variable intermédiaire non affichée
  //      ne ment à personne.
  for (const p of projections) {
    const fo = p.formule || "";
    const m = fo.match(/(\w[\w.]*)\.length\s*===\s*0\s*\?\s*(-?\d+(?:\.\d+)?)\s*:/) ||
              fo.match(/!\s*(\w[\w.]*)\.length\s*\?\s*(-?\d+(?:\.\d+)?)\s*:/) ||
              fo.match(/(?:Number\.)?isNaN\(\s*([\w.]+)\s*\)\s*\?\s*(-?\d+(?:\.\d+)?)\s*:/) ||
              fo.match(/!\s*(?:Number\.)?isFinite\(\s*([\w.]+)\s*\)\s*\?\s*(-?\d+(?:\.\d+)?)\s*:/);
    if (!m || Number(m[2]) === 0) continue;                                    // 1 et 2
    dire({
      attribut: "formule", regleApp: "X11",
      titre: `« ${p.nom} » vaut ${m[2]} quand il n'y a aucune donnée`,
      ou: ou(p), jumeaux: [`${ou(p)} ${(p.formule || "").slice(0, 100)}`],
      detail: `Population vide, et le produit affiche ${m[2]} comme s'il l'avait mesuré. Le repli n'est le jumeau d'aucune donnée réelle.`,
      jumelage: 0.7, force: 0.9,
    });
  }

  // (c bis) X12 — DEUX DIVISIONS SŒURS, UNE SEULE PROTÈGE SON DÉNOMINATEUR
  //
  // L'arithmétique seule est hors champ : diviser par zéro est une propriété
  // d'une expression, pas un désaccord. Mais quand le MÊME fichier écrit
  // `offresEnCours === 0 ? 0 : acceptees / offresEnCours` trois lignes plus haut
  // et `(courant - precedent) / precedent` juste après, il y a bien deux jumeaux
  // et deux disciplines. C'est le jumeau qui rend le défaut visible, pas la
  // division.
  //
  // LISTE NÉGATIVE, écrite AVANT la règle :
  //   1. jamais quand AUCUNE sœur du fichier ne protège la sienne : sans
  //      contre-exemple, c'est de l'arithmétique, et l'arithmétique est hors
  //      champ de l'apparieur ;
  //   2. jamais quand le dénominateur est un littéral ou une constante de module
  //      en MAJUSCULES (JOUR_MS, 1000) : elle ne vaut jamais zéro ;
  //   3. jamais quand le dénominateur est protégé, sous l'une des formes :
  //      test à zéro, ternaire sur lui, `|| 1`, `?? 1`, `Math.max(x, 1)`, ou
  //      garde NaN / isFinite en aval ;
  //   4. jamais deux fois la même division.
  const divisions = par("division");
  for (const d of divisions) {
    if (d.garde) continue;                                                     // 3
    if (/^[A-Z][A-Z0-9_]*$/.test(d.denominateur)) continue;                    // 2
    const soeurs = divisions.filter((x) => x.fichier === d.fichier && x.garde && x.porteur !== d.porteur);
    if (!soeurs.length) continue;                                              // 1
    dire({
      attribut: "formule", regleApp: "X12",
      titre: `« ${d.fonction} » divise par « ${d.denominateur} » sans se demander s'il vaut zéro`,
      ou: ou(d),
      jumeaux: [`${ou(d)} ${d.nom}`,
        ...soeurs.slice(0, 2).map((s) => `${ou(s)} ${s.fonction} protège « ${s.denominateur} » avant de diviser`)],
      detail: `${soeurs.length} calcul(s) du même fichier testent leur dénominateur avant de diviser. Celui-ci ne le fait pas : un dénominateur à zéro rendra Infinity, que l'écran affichera comme une croissance mesurée.`,
      jumelage: 0.8, force: 0.85,
    });
  }

  // (d) deux écritures sœurs, deux disciplines d'attente
  for (const w of par("ecriture.flottante")) {
    const f = fnParFq.get(w.porteur);
    if (!f) continue;
    const soeurs = Object.entries(f.formulesLocales || {}).filter(([, v]) => /await|Promise\.all/.test(v));
    dire({
      attribut: "formule", titre: `Une écriture de ${w.porteur} est lancée sans être attendue`,
      ou: ou(w),
      jumeaux: [`${ou(w)} ${w.formule}`, ...soeurs.slice(0, 2).map(([k, v]) => `${ou(f)} ${k} = ${v.slice(0, 60)} (attendue)`),
        ...(f.retours || []).slice(0, 1).map((r) => `${f.fichier}:${r.ligne} retourne ${r.texte}`)],
      detail: `La même fonction attend ses autres opérations. Celle-ci part en arrière-plan : le retour annonce un travail qui n'est pas garanti fait.`,
      jumelage: 0.75, force: 0.85,
    });
  }

  // ============================================================= A7 — GARDE

  // (a) deux portes vers un même cœur, protections inégales
  const atteints = (f, prof = 0, vus = new Set()) => {
    if (prof > 3 || !f) return [];
    let r = [...(f.appelsLocaux || [])];
    for (const a of aretes.filter((x) => x.de === f.id && x.type === "appelle")) {
      const c = parId.get(a.vers);
      const g = c?.fqCible ? fnParFq.get(c.fqCible) || fnParFq.get(c.fqCible.replace(/^(api|internal)\./, "")) : null;
      if (g && !vus.has(g.fq)) { vus.add(g.fq); r = r.concat(atteints(g, prof + 1, vus)); }
    }
    return r;
  };
  const coeurs = new Map();
  for (const f of fns) {
    if (!/httpActionConvex|routeNext|mutation|action/i.test(f.kind || "")) continue;
    for (const c of new Set(atteints(f))) {
      if (/^(orgCourante|requireAdmin|httpAction|Number|JSON)$/.test(c)) continue;
      if (!coeurs.has(c)) coeurs.set(c, []);
      coeurs.get(c).push(f);
    }
  }
  // Un cœur n'est un enjeu de garde que s'il FAIT quelque chose d'irréversible :
  // il écrit, il supprime, ou il sort du produit. Un helper de LECTURE partagé
  // par vingt fonctions n'est pas une porte dérobée, et le signaler vingt fois
  // est exactement le bruit qu'on cherche à éviter (mesuré : 86 constats sur projet client B).
  const coeursQuiAgissent = new Set();
  for (const i of par("fonction.interne")) {
    const agit = ecrits.some((w) => w.porteur === i.fq) ||
      par("operation.ecriture").some((w) => w.porteur === i.fq) ||
      par("operation.suppression").some((w) => w.porteur === i.fq) ||
      par("route.appelee").some((w) => w.porteur === i.fq && w.externe);
    if (agit) coeursQuiAgissent.add(i.nom);
  }
  for (const [coeur, portes] of coeurs) {
    if (portes.length < 2 || portes.length > 4) continue;
    if (!coeursQuiAgissent.has(coeur)) continue;
    const sig = portes.map((p) => ({ p, v: new Set([...(p.verifs || []), ...(p.kind === "internalMutation" ? ["interne"] : [])]) }));
    const union = new Set(sig.flatMap((s) => [...s.v]));
    for (const s of sig) {
      if (s.v.has("interne")) continue;
      const manquant = [...union].filter((u) => !s.v.has(u) && u !== "interne");
      if (!manquant.length) continue;
      const mieux = sig.find((o) => manquant.every((m) => o.v.has(m)));
      if (!mieux) continue;
      dire({
        attribut: "garde", titre: `Deux portes mènent à « ${coeur} » ; celle-ci n'a pas ${manquant.join(" ni ")}`,
        ou: ou(s.p), jumeaux: [`${ou(s.p)} ${s.p.fq} vérifie [${[...s.v].join(", ") || "rien"}]`, `${ou(mieux.p)} ${mieux.p.fq} vérifie [${[...mieux.v].join(", ")}]`],
        detail: `Le même effet métier est atteignable par deux chemins aux protections inégales. Le plus faible commande.`,
        jumelage: 0.85, force: 0.9,
      });
    }
  }

  // (a bis) X1 — LES PORTES SŒURS D'UN MÊME MODULE
  //
  // LISTE NÉGATIVE, écrite AVANT la règle. Ce qu'elle ne doit jamais signaler :
  //   1. une fonction interne (internalMutation/internalAction) : ce n'est pas une
  //      porte, elle n'est pas appelable depuis le navigateur ;
  //   2. une query : lire n'est pas le même enjeu qu'écrire, et le filtre de
  //      locataire relève d'une autre règle ;
  //   3. un module de MOINS de trois portes : entre deux mutations dont une gardée,
  //      il n'y a pas de majorité, donc pas de discipline établie, donc rien à
  //      opposer ;
  //   4. un module où moins des DEUX TIERS des portes sont gardées : l'absence de
  //      garde y est le régime normal du module, pas l'exception. C'est la clause
  //      qui empêche d'accuser les quatre mutations d'un module qui n'en a aucune ;
  //   5. une porte qui porte déjà une vérification d'un autre type (signature,
  //      secret) : elle est protégée autrement, pas moins ;
  //   6. une porte qui n'écrit QUE dans une table de journal / trace / audit :
  //      elle ne porte pas l'effet métier ;
  //   7. une porte qui n'écrit rien du tout : il n'y a rien à protéger.
  //
  // Le gardien n'est pas une liste de noms écrite à la main : c'est une fonction
  // interne du dépôt qui lit l'identité et n'écrit rien. « requireCourtier » se
  // reconnaît ainsi sans avoir jamais été nommé nulle part.
  const gardiens = new Set(par("fonction.interne")
    .filter((i) => (i.lit || []).some((x) => /^(getUserIdentity|currentUser|getAuth|requireAuth|orgCourante)$/.test(x)))
    .filter((i) => !ecritPar(i.fq).length)
    .map((i) => i.nom));
  const gardee = (f) => (f.verifs || []).length > 0 || (f.appelsLocaux || []).some((a) => gardiens.has(a));
  const portesParModule = new Map();
  for (const f of fns) {
    if (f.interne || !/^(mutation|action)$/.test(f.kind || "")) continue;     // 1 et 2
    if (!portesParModule.has(f.fichier)) portesParModule.set(f.fichier, []);
    portesParModule.get(f.fichier).push(f);
  }
  for (const [fichier, lot] of portesParModule) {
    if (lot.length < 3) continue;                                             // 3
    const gardees = lot.filter(gardee);
    if (gardees.length / lot.length < 2 / 3) continue;                        // 4 et 5
    for (const f of lot) {
      if (gardee(f)) continue;
      const tables = [...new Set(ecritPar(f.fq).map((w) => w.entite).filter(Boolean))];
      const metier = tables.filter((t) => !TABLE_TRACE.test(t));
      if (!metier.length) continue;                                           // 6 et 7
      const nomGarde = [...new Set(gardees.flatMap((g) => (g.appelsLocaux || []).filter((a) => gardiens.has(a))))];
      dire({
        attribut: "garde", regleApp: "X1",
        titre: `${gardees.length} des ${lot.length} mutations de ce module vérifient qui appelle, « ${f.fq} » non`,
        ou: ou(f),
        jumeaux: [`${ou(f)} ${f.fq} vérifie [rien]`,
          ...gardees.slice(0, 3).map((g) => `${ou(g)} ${g.fq} vérifie [${[...(g.verifs || []), ...(g.appelsLocaux || []).filter((a) => gardiens.has(a))].join(", ")}]`)],
        detail: `${gardees.length} des ${lot.length} mutations de ${fichier} passent ${nomGarde.join(" / ") || "une vérification"} avant d'écrire. Celle-ci écrit dans ${metier.join(", ")} sans aucune. La porte la plus faible commande.`,
        jumelage: 0.9, force: gardees.length === lot.length - 1 ? 0.95 : 0.8,
      });
    }
  }

  // (b) une garde appelée dont on jette le résultat
  for (const g of par("garde")) {
    if (g.resultatUtilise) continue;
    const f = fnParFq.get(g.porteur);
    const freres = par("garde").filter((h) => h.nom === g.nom && h.resultatUtilise);
    if (!freres.length) continue;
    if (f?.pop?.predicats.some((q) => /org|tenant|workspace|compte/i.test(q.champ))) continue;
    dire({
      attribut: "garde", titre: `« ${g.nom} » est appelée puis son résultat est jeté, et rien ne filtre le locataire`,
      ou: ou(g), jumeaux: [`${ou(g)} ${g.porteur}`, ...freres.slice(0, 3).map((h) => `${ou(h)} ${h.porteur} (${h.liaisons})`)],
      detail: `${freres.length} autres appels de ${g.nom} en exploitent le retour pour filtrer. Ici la lecture part sur ${f?.pop?.tables.join(",") || "?"} sans borne d'organisation.`,
      jumelage: 0.9, force: 0.9,
    });
  }

  // (c) une branche de vérification qui répond « tout va bien »
  for (const f of fns) {
    const rs = f.retours || [];
    const refus = rs.filter((r) => r.statut && r.statut >= 400);
    if (!refus.length) continue;
    for (const s of rs.filter((r) => r.branche === "garde-absente" && /ok:\s*true|success|ignore|\bok\b/.test(r.texte) && (!r.statut || r.statut < 300))) {
      dire({
        attribut: "garde", titre: `Une branche de vérification de ${f.fq} répond « tout va bien » au lieu de refuser`,
        ou: `${f.fichier}:${s.ligne}`,
        jumeaux: [`${f.fichier}:${s.ligne} ${s.texte}`, ...refus.slice(0, 2).map((r) => `${f.fichier}:${r.ligne} ${r.statut}`)],
        detail: `Les branches sœurs de la même vérification répondent ${refus.map((r) => r.statut).join("/")}. Celle-ci répond 200 : l'émetteur ne réessaiera jamais.`,
        jumelage: 0.8, force: 0.85,
      });
    }
  }

  // dédoublonnage
  const vus = new Set(), final = [];
  for (const o of out.sort((a, b) => b.confiance - a.confiance)) {
    const k = `${o.attribut}|${o.ou}|${o.titre.slice(0, 45)}`;
    if (vus.has(k)) continue;
    vus.add(k);
    final.push(o);
  }
  return { desaccords: final, attributs: ATTRIBUTS, gemellite };
}

// ---------------------------------------------------------------------------
// SOLITUDE. Un élément sans jumeau n'est un défaut que si, DANS CE DÉPÔT, les
// éléments de sa classe en ont normalement un. Le seuil n'est pas écrit à la
// main : il se lit dans le taux de gémellité mesuré. C'est ainsi que la machine
// décide « seul, et c'est normal » sans qu'un humain le lui dise classe par classe.
export function solitudes(ctx, seuilGemellite = 0.7) {
  const { groupes, gemellite, elements, trouver } = ctx;
  const out = [];
  for (const e of elements) {
    if (groupes.get(trouver(e.id)).length > 1) continue;
    const c = gemellite[e.classe];
    const normal = !c || c.taux < seuilGemellite || LISTE_NEGATIVE.solitudeLegitimeParDefaut.has(e.classe);
    out.push({
      element: `${e.classe} ${e.nom}`, classe: e.classe, ou: `${e.fichier}:${e.ligne}`,
      verdict: normal ? "seul, et c'est normal" : "seul, et ça ne devrait pas",
      tauxClasse: c ? Math.round(c.taux * 100) : null,
    });
  }
  return out;
}
