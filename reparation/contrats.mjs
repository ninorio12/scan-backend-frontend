#!/usr/bin/env node
/**
 * contrats.mjs — d'un défaut du bilan à un contrat de correction JUGEABLE.
 *
 * LE PROBLÈME QU'IL RÉSOUT
 * `boucle.mjs ouvrir` écrivait `{ invariants: [] }` et laissait un humain remplir le
 * contrat à la main. Un contrat sans invariant est INJUGEABLE : la boucle
 * s'arrêtait donc systématiquement au premier lot, et c'est exactement pour ça
 * qu'elle n'a jamais tourné de bout en bout. Ce fichier dérive l'invariant du
 * TEXTE du défaut, qui est lui-même produit par le scanner avec des tournures
 * fixes (« sans regarder X », « compte T avec D ; « B » rend la liste sans »,
 * « le corps ne le lit jamais »). On ne lit pas le projet, on lit la grammaire du
 * scanner : les règles ci-dessous valent donc sur n'importe quel dépôt.
 *
 * LA LOI, ET ELLE NE SE NÉGOCIE PAS
 * Quand aucune règle ne s'applique, on n'invente PAS un invariant faible pour que
 * le lot passe. Le défaut sort avec `injugeable` et sa raison, et il est compté à
 * part dans le bilan du chantier. Un invariant que l'ouvrier peut satisfaire sans
 * corriger vaut moins que pas d'invariant du tout : il transforme un « je ne sais
 * pas prouver » en un « prouvé » mensonger.
 *
 * ⚠️ LE CAS SANS FONDATION D'AUTHENTIFICATION (PROTOCOLE.md)
 * Sur un projet où `ctx.auth.getUserIdentity()` rend toujours null, poser une garde
 * d'identité CRÉE un défaut. `fondationAuth()` regarde si une garde existe et sert
 * réellement quelque part ; sans fondation, le contrat d'une porte sans garde
 * devient « basculer la fonction en interne », jamais « poser une garde ».
 *
 *   node contrats.mjs <repo>            → un contrat par défaut de la file
 *   node contrats.mjs <repo> --json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileDeReparation } from './entree.mjs';
import { corpsDe, verifierTous } from './invariants.mjs';
import { symboleEnglobant } from './empreintes.mjs';

const echapper = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const lire = (racine, f) => { try { return fs.readFileSync(path.join(racine, f), 'utf8'); } catch { return null; } };

/* ── La fondation d'authentification ────────────────────────────────────────
   Deux preuves possibles, et il en faut une : un fichier de configuration
   d'authentification, ou une garde maison réellement APPELÉE (déclarée et pas
   seulement définie). Une garde définie que personne n'appelle n'est pas une
   fondation, c'est une intention. */

export function fondationAuth(racine) {
  const config = ['convex/auth.config.ts', 'convex/auth.config.js', 'auth.config.ts', 'middleware.ts']
    .find((f) => fs.existsSync(path.join(racine, f)));
  const gardes = new Map();
  const marcher = (dir, out = []) => {
    let e; try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const x of e) {
      if (x.name.startsWith('.') || ['node_modules', '_generated', 'dist', 'build'].includes(x.name)) continue;
      const p = path.join(dir, x.name);
      if (x.isDirectory()) marcher(p, out); else if (/\.(ts|tsx|js|jsx|mjs)$/.test(x.name)) out.push(p);
    }
    return out;
  };
  const fichiers = marcher(racine);
  for (const p of fichiers) {
    const txt = fs.readFileSync(p, 'utf8');
    for (const m of txt.matchAll(/\b((?:require|assert|ensure|exiger|verifier)[A-Z]\w*)\s*\(/g)) {
      gardes.set(m[1], (gardes.get(m[1]) || 0) + 1);
    }
  }
  // Une garde compte comme fondation si elle apparaît au moins deux fois : sa
  // définition et au moins un appel.
  const servies = [...gardes.entries()].filter(([, n]) => n >= 2).map(([n]) => n);
  return { existe: Boolean(config) || servies.length > 0, config: config || null, gardes: servies };
}

/** La garde que le reste du module utilise. C'est le code voisin qui dit la norme :
    on ne choisit pas un nom de garde, on reprend celui des jumeaux. */
export function gardeVoisine(racine, fichier) {
  const txt = lire(racine, fichier);
  if (!txt) return null;
  const comptes = new Map();
  for (const m of txt.matchAll(/\b((?:require|assert|ensure|exiger|verifier)[A-Z]\w*)\s*\(/g)) comptes.set(m[1], (comptes.get(m[1]) || 0) + 1);
  const [meilleur] = [...comptes.entries()].sort((a, b) => b[1] - a[1]);
  return meilleur ? meilleur[0] : null;
}

/* ── Résolution du symbole porteur ──────────────────────────────────────────
   Le titre nomme presque toujours son symbole : « valeurPortefeuille », ou
   « biens.archiver ». À défaut, l'empreinte porte un symbole englobant. On vérifie
   ensuite que le symbole EXISTE dans le fichier : un invariant qui vise un symbole
   absent est faux au premier passage et fait rejeter des corrections honnêtes. */

function symbolePorteur(racine, d) {
  const candidats = [];
  const qualifie = d.titre.match(/\b([a-zA-Z_$][\w$]*)\.([a-zA-Z_$][\w$]*)\b/);
  if (qualifie) candidats.push(qualifie[2]);
  for (const m of d.titre.matchAll(/«\s*([A-Za-z_$][\w$]*)\s*»/g)) candidats.push(m[1]);
  if (d.sourceAncre === 'englobant' || d.sourceAncre === 'englobant+charge') candidats.push(String(d.ancre).replace(/«.*/, ''));
  if (d.ancre && /^[A-Za-z_$][\w$]*$/.test(d.ancre)) candidats.push(d.ancre);
  const txt = lire(racine, d.fichier);
  if (!txt) return null;
  for (const c of candidats) if (c && corpsDe(txt, c) !== null) return c;
  /* ⚠️ Dernier recours, et il est le plus utile en pratique : le titre nomme très
     souvent une PROPRIÉTÉ de l'objet rendu (« prixMoyen », « valeurTotale »,
     « total »), pas une déclaration. Ce n'est pas un symbole, on ne peut pas en
     lire le corps. On remonte alors à la fonction qui la contient : c'est bien
     elle que l'ouvrier devra corriger, et son corps est ce qu'il faut mesurer.
     Sans ce repli, cinq défauts sur dix-huit sortaient INJUGEABLES pour une
     raison purement syntaxique. */
  if (d.ligneVue) {
    const eng = symboleEnglobant(txt.split('\n'), d.ligneVue - 1);
    if (eng && corpsDe(txt, eng) !== null) return eng;
  }
  return null;
}

/* ── Les règles de dérivation ────────────────────────────────────────────────
   Chacune lit une tournure du scanner et rend des invariants. L'ordre compte :
   la première qui répond gagne. Chaque règle dit aussi, en une phrase, ce que
   l'ouvrier doit obtenir : c'est le contrat, et le juge lira la même phrase. */

const REGLES = [

  /* « X » additionne des prix sans regarder biens.devise  ·  unité, la plus fréquente */
  {
    nom: 'sans-regarder',
    detecte: (d) => /sans regarder\s+([\w$]+)\.([\w$]+)/.exec(`${d.titre} ${d.detail}`),
    contrat: (d, m, ctx) => {
      const sym = symbolePorteur(ctx.racine, d);
      if (!sym) return null;
      return {
        attendu: `Dans ${d.fichier}, le calcul « ${sym} » doit tenir compte de ${m[1]}.${m[2]} au lieu de l'ignorer : soit en convertissant, soit en refusant d'agréger ce qui n'est pas dans la même graduation, soit en rendant le détail par ${m[2]}.`,
        invariants: [{ type: 'motif-dans-symbole', nom: `${sym} regarde ${m[2]}`, fichier: d.fichier, symbole: sym, motif: `\\b${echapper(m[2])}\\b` }],
      };
    },
  },

  /* « X » est accepté par mod.fn et le corps ne le lit jamais  ·  action muette */
  {
    nom: 'argument-jamais-lu',
    detecte: (d) => /«\s*([\w$]+)\s*»\s+est accepté par\s+[\w$]+\.([\w$]+).*(?:ne le lit jamais|jamais lu)/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, la mutation « ${m[2]} » doit réellement écrire l'argument « ${m[1]} » qu'elle accepte (ou cesser de l'accepter). Aujourd'hui elle répond succès sans avoir changé ce champ.`,
      invariants: [{
        type: 'motif-dans-symbole', nom: `${m[2]} lit ${m[1]}`, fichier: d.fichier,
        symbole: m[2], portee: 'handler', motif: `\\b${echapper(m[1])}\\b`,
      }],
    }),
  },

  /* mod.fn avale sa panne et répond quand même « { ok: true } »  ·  panne déguisée */
  {
    nom: 'panne-avalee',
    detecte: (d) => /avale sa panne|avale son erreur|répond (?:quand même|succès)/.test(`${d.titre} ${d.detail}`) && d.titre.match(/\b([\w$]+)\.([\w$]+)\b/),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, « ${m[2]} » ne doit plus répondre un succès quand l'écriture a échoué : relancer l'erreur, ou rendre un échec explicite à l'appelant.`,
      invariants: [{ type: 'catch-non-muet', nom: `${m[2]} ne gobe plus la panne`, fichier: d.fichier, symbole: m[2] }],
    }),
  },

  /* « A » compte T avec D ; « B » rend la liste sans  ·  le drilldown qui ne tombe pas juste */
  {
    nom: 'discriminant-manquant',
    detecte: (d) => /«\s*([\w$]+)\s*»\s+compte\s+[\w$]+\s+avec\s+(!?[\w$.]+)\s*;\s*«\s*([\w$]+)\s*»/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, « ${m[3] }» doit appliquer le même discriminant « ${m[2]} » que « ${m[1]} », ou « ${m[1]} » doit cesser de l'appliquer. Le chiffre et la liste qu'on ouvre en cliquant dessus doivent porter sur le même ensemble.`,
      invariants: [{
        type: 'motif-dans-symbole', nom: `${m[3]} applique ${m[2]}`, fichier: d.fichier,
        symbole: m[3], motif: echapper(m[2].replace(/^!/, '')),
      }],
    }),
  },

  /* « X » est cherché sans être mis à la même graduation que le terme (a, b l'est) */
  {
    nom: 'meme-graduation',
    detecte: (d) => /«\s*([\w$]+)\s*»\s+est cherché sans être mis à la même graduation.*\(([^)]+)\)/.exec(d.titre),
    contrat: (d, m, ctx) => {
      const sym = symbolePorteur(ctx.racine, d);
      const temoins = m[2].split(/[,;]/).map((s) => s.trim().replace(/\s.*$/, '')).filter((s) => /^[\w$]+$/.test(s));
      if (!sym || !temoins.length) return null;
      return {
        attendu: `Dans ${d.fichier}, le champ « ${m[1]} » doit recevoir dans « ${sym} » le même traitement que ses jumeaux (${temoins.join(', ')}). Aujourd'hui la recherche ne rend jamais rien sur ce champ, sans aucune erreur.`,
        invariants: [{ type: 'meme-traitement', nom: `${m[1]} traité comme ${temoins.join('/')}`, fichier: d.fichier, symbole: sym, champ: m[1], temoins }],
      };
    },
  },

  /* « X » divise une somme et un effectif qui ne portent pas sur le même ensemble */
  {
    nom: 'population-divergente',
    detecte: (d) => /ne portent pas sur le même ensemble|ne couvrent pas le même ensemble/.test(`${d.titre} ${d.detail}`)
      && /l'un écarte\s+(.+?)\s+et l'autre non/.exec(d.detail),
    contrat: (d, m, ctx) => {
      const sym = symbolePorteur(ctx.racine, d);
      if (!sym) return null;
      const brut = m[1].replace(/^\(.*?\)\s*=>\s*/, '').trim();
      return {
        attendu: `Dans ${d.fichier}, « ${sym} » doit calculer son numérateur et son dénominateur sur la même population : soit « ${brut} » s'applique des deux côtés, soit d'aucun.`,
        invariants: [{ type: 'accord-population', nom: `${sym} : une seule population`, fichier: d.fichier, symbole: sym, motif: echapper(brut) }],
      };
    },
  },

  /* « X » divise par « Y » sans se demander s'il vaut zéro */
  {
    nom: 'division-sans-garde',
    detecte: (d) => /«\s*([\w$]+)\s*»\s+divise par\s+«\s*([\w$]+)\s*»\s+sans se demander s'il vaut zéro/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, « ${m[1]} » doit traiter le cas où « ${m[2]} » vaut zéro au lieu de rendre Infinity, que l'écran affichera comme une croissance mesurée.`,
      invariants: [{
        type: 'motif-dans-symbole', nom: `${m[1]} borne son dénominateur`, fichier: d.fichier, symbole: m[1],
        motif: `${echapper(m[2])}\\s*(?:===|!==|==|>|<|>=|<=)\\s*0|!\\s*${echapper(m[2])}\\b|${echapper(m[2])}\\s*(?:\\?\\?|\\|\\|)|isFinite`,
      }],
    }),
  },

  /* « X » vaut N quand il n'y a aucune donnée  ·  le repli qui a la forme d'une mesure
     Le motif vise la FORME du repli (`? N :`, `?? N`, `|| N`), pas l'affectation :
     la première version cherchait « taux : 100 » et passait à côté de
     `taux: Number.isNaN(taux) ? 100 : taux`, donc elle était verte avant
     correction — un invariant vert d'avance ne prouve rien. */
  {
    nom: 'repli-invente',
    detecte: (d) => /«\s*([\w$]+)\s*»\s+vaut\s+([\d.]+)\s+quand il n'y a aucune donnée/.exec(d.titre),
    contrat: (d, m, ctx) => {
      const sym = symbolePorteur(ctx.racine, d) || m[1];
      return {
        attendu: `Dans ${d.fichier}, « ${m[1]} » ne doit pas valoir ${m[2]} sur une population vide : rendre null (ou l'absence de mesure), pas un chiffre qui ressemble à une mesure. L'écran doit pouvoir distinguer « pas de donnée » de « ${m[2]} ».`,
        invariants: [{
          type: 'motif-dans-symbole', nom: `${m[1]} ne fabrique plus ${m[2]}`, fichier: d.fichier, symbole: sym,
          motif: `(?:\\?|\\?\\?|\\|\\|)\\s*${echapper(m[2])}\\b|=\\s*${echapper(m[2])}\\s*;|:\\s*${echapper(m[2])}\\s*[,}]`,
          present: false,
        }],
      };
    },
  },

  /* Le champ « X » affiche « V » en dur alors que T.f existe  ·  valeur inventée à l'écran */
  {
    nom: 'valeur-en-dur',
    detecte: (d) => /affiche\s+«\s*([^»]+?)\s*»\s+en dur alors que\s+([\w$]+)\.([\w$]+)/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, la valeur « ${m[1]} » écrite en dur doit disparaître et le champ doit lire ${m[2]}.${m[3]}. Déplacer le littéral dans une constante ne corrige rien : c'est la même valeur inventée à une autre adresse.`,
      invariants: [
        { type: 'texte-absent', nom: `« ${m[1]} » n'est plus dans l'écran`, litteral: m[1], portee: d.fichier },
        { type: 'motif-dans-symbole', nom: `l'écran lit ${m[3]}`, fichier: d.fichier, symbole: '__fichier__', motif: `\\b${echapper(m[3])}\\b` },
      ],
    }),
  },

  /* « X » retombe sur N valeur(s) écrites en dur qui ont la forme de la vraie donnée */
  {
    nom: 'repli-en-dur',
    detecte: (d) => /«\s*([\w$]+)\s*»\s+retombe sur\s+(\d+)\s+valeur/.exec(d.titre),
    contrat: (d, m, ctx) => {
      /* Le jeu de remplissage a un NOM, et il est sur la ligne du défaut :
         `const ventes = evolution ?? VENTES_RECENTES`. C'est ce nom qu'on exige
         disparu, pas une forme syntaxique : un `??  [ {` cherché dans le corps
         d'un `const x = useQuery(...)` ne mesurait rien (ce corps n'existe pas)
         et l'invariant était vert avant correction. */
      /* Le repli se cherche par le NOM de la source, pas sur la ligne signalée :
         le scanner désigne la ligne où le total faux est calculé, le repli est une
         ou deux lignes plus haut. Chercher `evolution ?? X` dans le fichier est
         exact et ne dépend d'aucun décalage. */
      const txt = lire(ctx.racine, d.fichier) || d.temoin || '';
      const repli = new RegExp(`\\b${echapper(m[1])}\\s*(?:\\?\\?|\\|\\|)\\s*([A-Za-z_$][\\w$]*)`).exec(txt)
        || /(?:\?\?|\|\|)\s*([A-Za-z_$][\w$]*)/.exec(d.temoin || '');
      if (!repli) return null;
      return {
        attendu: `Dans ${d.fichier}, « ${m[1]} » ne doit plus retomber sur « ${repli[1]} », ${m[2]} valeurs écrites en dur qui ont la forme de la vraie donnée. Pendant le chargement et quand la source est vide, l'écran doit le DIRE. Le jeu de remplissage « ${repli[1]} » doit disparaître du fichier, pas changer de nom.`,
        invariants: [{
          type: 'occurrences-fichier', nom: `« ${repli[1] } » a disparu de l'écran`, fichier: d.fichier,
          motif: `\\b${echapper(repli[1])}\\b`, present: false,
        }],
      };
    },
  },

  /* La table « T » est écrite depuis N endroits et lue par aucun  ·  travail pour personne */
  {
    nom: 'table-jamais-lue',
    detecte: (d) => /La table «\s*([\w$]+)\s*» est écrite depuis .* et lue par aucun/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `La table « ${m[1]} » doit être lue quelque part, ou cesser d'être écrite. Les deux corrections sont recevables ; l'état actuel, où chaque opération l'alimente et où rien n'en ressort, ne l'est pas.`,
      invariants: [{ type: 'lecture-ou-silence', nom: `« ${m[1]} » lue ou plus écrite`, table: m[1] }],
    }),
  },

  /* « mod.fn » calcule « V » puis n'en fait rien  ·  travail abandonné */
  {
    nom: 'travail-abandonne',
    detecte: (d) => /«\s*[\w$]*\.?([\w$]+)\s*»\s+calcule\s+«\s*([\w$]+)\s*»\s+puis n'en fait rien/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, « ${m[1]} » doit se servir de « ${m[2]} » qu'elle calcule, ou cesser de le calculer. Le nom de la fonction annonce un travail que le corps ne fait pas.`,
      invariants: [{
        type: 'motif-dans-symbole', nom: `${m[2]} sert dans ${m[1]}`, fichier: d.fichier,
        symbole: m[1], portee: 'handler', motif: `\\b${echapper(m[2])}\\b`, minimum: 2,
      }],
    }),
  },

  /* mod.fn repose T.champ à « V » sans regarder son état courant  ·  état écrasé */
  {
    nom: 'etat-ecrase',
    detecte: (d) => /([\w$]+)\.([\w$]+)\s+repose\s+([\w$]+)\.([\w$]+)\s+à\s+«\s*([^»]+)\s*»\s+sans regarder son état courant/.exec(d.titre),
    contrat: (d, m) => ({
      attendu: `Dans ${d.fichier}, « ${m[2]} » ne doit reposer ${m[3]}.${m[4]} à « ${m[5]} » qu'après avoir LU la ligne visée et regardé son état courant : une ligne déjà avancée dans le vocabulaire du champ ne doit pas reculer. Il faut donc une lecture de plus qu'aujourd'hui, et une condition dessus.`,
      /* `progres` : le minimum n'est pas écrit à la main, il est relevé sur la base
         et augmenté de un. Sans ça l'invariant « il y a une condition sur statut »
         était vert d'avance (la fonction teste déjà le statut de l'OFFRE, pas celui
         du BIEN qu'elle écrase) et acceptait une correction inexistante. */
      invariants: [{
        type: 'motif-dans-symbole', nom: `${m[2]} lit la ligne avant de l'écraser`, fichier: d.fichier, symbole: m[2], portee: 'handler',
        motif: `ctx\\.db\\.get\\(|\\.query\\(`, progres: true,
      }],
    }),
  },

  /* N des M mutations de ce module vérifient qui appelle, « mod.fn » non  ·  porte parallèle
     ⚠️ C'est ici que se joue la règle du projet sans fondation. */
  {
    nom: 'porte-sans-garde',
    detecte: (d) => d.attribut === 'garde' && /«\s*[\w$]*\.?([\w$]+)\s*»/.exec(d.titre),
    contrat: (d, m, ctx) => {
      const fn = m[1];
      const fondation = fondationAuth(ctx.racine);
      if (!fondation.existe) {
        /* PROTOCOLE.md, § projet sans fondation : poser une garde d'identité sur un
           projet où getUserIdentity() rend toujours null crée un défaut. On bascule. */
        return {
          attendu: `⚠️ Ce projet n'a AUCUNE fondation d'authentification (ni configuration, ni garde maison réellement appelée). Poser une garde d'identité ferait tomber chaque appel en 401 : c'est un défaut de plus, pas une correction. La seule correction sûre ici est de basculer « ${fn} » en fonction INTERNE (internalMutation / internalQuery) et de réécrire ses appelants, ou, si un écran l'appelle, de ne rien faire et de laisser la dette d'authentification au chantier qui l'installera.`,
          sansFondation: true,
          invariants: [{
            type: 'motif-dans-symbole', nom: `${fn} n'est plus une porte publique`, fichier: d.fichier, symbole: fn,
            motif: 'internalMutation|internalQuery|internalAction', portee: 'symbole',
          }],
        };
      }
      const garde = gardeVoisine(ctx.racine, d.fichier);
      if (!garde) return null;
      return {
        attendu: `Dans ${d.fichier}, « ${fn} » doit passer « ${garde}(...) » en PREMIÈRE instruction de son handler, comme les autres mutations du même module. Une garde posée après la lecture ou l'écriture ne garde rien. Ne pas inventer une autre garde : celle du module fait foi.`,
        fondation: fondation,
        invariants: [
          { type: 'garde-en-tete', nom: `${fn} gardée en tête`, fichier: d.fichier, symbole: fn, motif: `${echapper(garde)}\\s*\\(` },
        ],
      };
    },
  },

  /* « X » compte tout P ; la liste du même écran en écarte T.champ  ·  drilldown à l'écran */
  {
    nom: 'ecran-discriminant',
    detecte: (d) => /compte tout\s+[\w$]+\s*;\s*la liste du même écran en écarte\s+[\w$]+\.([\w$]+)/.exec(d.titre),
    contrat: (d, m, ctx) => {
      const sym = symbolePorteur(ctx.racine, d);
      if (!sym) return null;
      return {
        attendu: `Dans ${d.fichier}, le chiffre affiché et la liste juste en dessous doivent porter sur le même ensemble : le compteur doit écarter « ${m[1]} » comme la liste le fait, ou la liste doit cesser de l'écarter.`,
        invariants: [{
          type: 'motif-dans-symbole', nom: `le compteur écarte ${m[1]}`, fichier: d.fichier, symbole: sym,
          motif: `\\b${echapper(m[1])}\\b`, minimum: 2,
        }],
      };
    },
  },
];

/* ── L'ÉPREUVE DE LA BASE ────────────────────────────────────────────────────
   LA règle qui manquait, et elle est mécanique : un invariant qui est DÉJÀ VERT
   sur le code non corrigé ne peut rien prouver. Il accepterait un lot où
   l'ouvrier n'a rien fait. Mesuré sur le projet figé : 4 des 18 invariants
   dérivés étaient verts d'avance, dont celui du repli à 100 — la boucle aurait
   annoncé quatre corrections qui n'avaient pas eu lieu.

   Deux issues, jamais une troisième :
     · `progres: true` → le minimum est RELEVÉ sur la base et augmenté de un. La
       correction devra donc ajouter une occurrence réelle. Réservé aux règles où
       « une occurrence de plus » EST la correction (lire la ligne avant de
       l'écraser).
     · sinon → le contrat sort INJUGEABLE, avec sa raison. C'est souvent le signe
       que le signalement lui-même est douteux : le dire vaut mieux que de le
       faire passer pour corrigé. */

export function eprouverContreLaBase(racine, contrat, verifierTous) {
  if (!contrat.invariants?.length) return contrat;
  const invariants = contrat.invariants.map((i) => {
    if (!i.progres) return i;
    const { resultats } = verifierTous(racine, [{ ...i, progres: undefined, minimum: 0 }]);
    const n = Number(String(resultats[0]?.mesure || '').match(/(\d+) occurrence/)?.[1] ?? 0);
    return { ...i, progres: undefined, minimum: n + 1, socle: n };
  });
  const { ok } = verifierTous(racine, invariants);
  if (ok) {
    return {
      ...contrat, invariants: [],
      injugeable: `l'invariant dérivé (${contrat.invariants.map((i) => i.nom).join(', ')}) est DÉJÀ VERT sur le code non corrigé : il ne prouverait rien. Soit le signalement du scanner est un faux positif, soit la correction attendue ne se lit pas dans le texte ni dans l'arbre.`,
      dejaVert: true,
    };
  }
  return { ...contrat, invariants };
}

/* ── Construction ──────────────────────────────────────────────────────────── */

export function contratDe(racine, d) {
  const base = {
    id: d.id, regle: d.regle, niveau: d.niveau, gravite: d.gravite, famille: d.famille,
    fichier: d.fichier, ou: d.ou, constat: d.titre, detail: d.detail, ancre: d.ancre, stable: d.stable,
  };
  for (const r of REGLES) {
    const m = r.detecte(d);
    if (!m) continue;
    const c = r.contrat(d, m, { racine });
    if (!c) continue;
    const invariants = (c.invariants || []).map((i) =>
      i.symbole === '__fichier__' ? { ...i, type: 'occurrences-fichier', symbole: undefined } : i);
    return eprouverContreLaBase(racine, { ...base, regleDerivation: r.nom, ...c, invariants, injugeable: null }, verifierTous);
  }
  return {
    ...base, regleDerivation: null, attendu: null, invariants: [],
    injugeable: `aucune règle de dérivation ne reconnaît « ${d.titre.slice(0, 70)} » : rien ne peut être prouvé sans inventer une preuve faible, donc rien ne sera accepté.`,
  };
}

export function contrats(racine) {
  const file = fileDeReparation(racine);
  return { ...file, contrats: file.defauts.map((d) => contratDe(racine, d)) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const racine = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
  const r = contrats(racine);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  const f = fondationAuth(racine);
  console.log(`\n╔══ CONTRATS ─ ${path.basename(racine)}`);
  console.log(`║  fondation d'authentification : ${f.existe ? `OUI (${f.config || f.gardes.join(', ')})` : 'NON → aucune garde d’identité ne sera posée, bascule en interne'}`);
  const jugeables = r.contrats.filter((c) => !c.injugeable);
  console.log(`╚══ ${jugeables.length}/${r.contrats.length} défauts jugeables\n`);
  for (const c of r.contrats) {
    console.log(`  ${c.injugeable ? '✗' : '✓'} ${c.niveau.padEnd(7)} ${c.id.padEnd(26)} ${c.regleDerivation || '—'}`);
    if (c.injugeable) console.log(`      ${c.injugeable}`);
    else for (const i of c.invariants) console.log(`      ${i.type.padEnd(20)} ${i.nom}`);
  }
  console.log();
}
