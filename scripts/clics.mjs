#!/usr/bin/env node
/**
 * clics.mjs : on appuie sur tous les boutons, et on regarde ce qui se passe.
 *
 * Le scan lit le code. Ici on ouvre l'application et on clique. C'est l'étape qui
 * rapporte le plus : sur un projet client, le 11/09/2026, cinq agents ont sorti une soixantaine de
 * défauts réels en deux heures, dont aucun n'était visible dans le code.
 *
 *     node clics.mjs http://localhost:3000/modules/parametres
 *     node clics.mjs <url> --json f --max 400 --attente 30 --sans-contre-epreuve
 *
 * CINQ VERDICTS, du plus certain au plus douteux :
 *
 *   ERREUR      le clic fait apparaître un message d'erreur À L'ÉCRAN, ou une requête
 *               en échec. Aucun jugement à porter : le client le voit, c'est un bug.
 *   SILENCIEUX  le JavaScript plante mais rien ne casse à l'écran. À corriger, pas
 *               urgent. La distinction compte : sans elle, une carte qui plante au
 *               montage se retrouve au même rang qu'un « Le test n'a pas abouti ».
 *   MORT        rien ne bouge : ni requête, ni changement de page, ni message, ni
 *               erreur. ⚠️ TROIS SILENCES VALENT UN VERDICT, UN SEUL N'EN VAUT AUCUN.
 *               Un bouton peut sembler mort parce que le serveur de développement
 *               compile encore la route (10 à 25 s mesurées), ou parce que l'écran est
 *               DÉJÀ dans l'état qu'il produit (« Aujourd'hui » quand on est déjà
 *               aujourd'hui). D'où trois essais : le premier au fil de la page, le
 *               deuxième sur une page réellement rendue avec l'attente longue, le
 *               troisième après avoir changé l'état de l'écran. Sur un projet public,
 *               le premier essai seul donnait 256 « morts » dont la quasi-totalité
 *               était fausse.
 *   CASSÉ       l'écran perd l'essentiel de son contenu, se vide, ou un bloc devient
 *               blanc. C'est le « j'appuie et j'ai une vue bizarre ».
 *   SANS OBJET  rien n'a bougé, et c'était attendu : un lien vers l'écran DÉJÀ affiché
 *               (l'onglet courant de la barre de navigation). Ce n'est pas un défaut.
 *               Sans cette ligne, chaque écran sortait exactement un faux « mort ».
 *   OK          quelque chose s'est passé, et rien de ce qui précède.
 *
 * ET DEUX DÉCOMPTES QUI NE SONT PAS DES VERDICTS, mais qu'on ne tait jamais :
 *
 *   ÉCARTÉ      on n'a pas cliqué, exprès. Ce qui supprime, vide, déconnecte, et TOUT CE
 *               QUI ÉCRIT : `type=submit`, un bouton dans un <form>, un libellé avec un
 *               verbe d'écriture (enregistrer, créer, nouveau, ajouter, déposer, envoyer,
 *               importer…). La base contient les vraies données du client. Ces boutons
 *               sont nommés un par un : à tester par un agent avec consentement, sur une
 *               base de dev, ou à la main.
 *   NON CLIQUÉ  on a voulu, on n'a pas pu, et on dit pourquoi : disparu, recouvert,
 *               hors de portée, délai dépassé. Avant, c'était un `continue` silencieux :
 *               sur un projet client, 16 boutons cliqués sur 100 et 84 abandonnés sans une ligne.
 *   INCLUS      un cliquable DANS un autre cliquable (une icône dans un lien, un span
 *               dans un SignInButton). Le clic sur l'enfant est capté par le parent qui
 *               navigue ; mesurer l'enfant donnait « rien n'a bougé » : six faux
 *               « morts » sur huit chez l'instance vierge. On teste le parent, l'enfant
 *               est compté « inclus dans … ».
 *
 * COMMENT ON RETROUVE UN BOUTON APRÈS UN CLIC : par une clé stable (rôle + libellé +
 * lien + rang parmi les homonymes), jamais par sa position dans la liste. Un clic qui
 * ouvre un panneau ou replie une barre change la liste ; la clé, elle, tient.
 *
 * ON NE CONCLUT JAMAIS SANS PAGE : si l'adresse ne répond pas, renvoie un 404, ou si ce
 * qui s'affiche N'EST PAS L'APPLICATION (écran de connexion, page d'erreur d'un
 * fournisseur d'auth, JSON brut, redirection vers un autre domaine, corps quasi vide),
 * on sort en code 2 avec un message, et rien d'autre. « 0 recensé » n'est pas « rien à
 * signaler » : l'instance vierge avait « testé » 7 modules sur 12 sur une page Clerk 400.
 *
 * CODES DE SORTIE : 0 rien de cassé · 1 au moins une ERREUR ou un CASSÉ · 2 pas de page.
 */

import fs from 'node:fs';
import path from 'node:path';
import { chargerNavigateur } from './navigateur.mjs';
import { ecrireJson } from './dossier-backend.mjs';
const chromium = chargerNavigateur(process.cwd());  // une URL n'est pas un chemin

const URL_CIBLE = process.argv[2];
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const a = (n) => process.argv.includes(n);
const MAX = Number(arg('--max', 400));
const DELAI_CLIC = 2500;   // avant : 4 000 ms. 84 échecs à 4 s faisaient 6 minutes par page.

/* ── L'ATTENTE S'ADAPTE, ELLE N'EST PAS UNE CONSTANTE ──────────────────────────
   Un serveur de développement compile une route À LA PREMIÈRE VISITE : mesuré entre
   10 et 25 s sur un projet public, jusqu'à 42 s sous charge. Une attente fixe de
   quelques secondes lit une URL encore inchangée et conclut « rien ne bouge » : sur ce
   projet, 256 « boutons morts », dont les 18 liens de la barre latérale, tous vivants.
   Une fois la route compilée, la même navigation prend 70 ms.
   D'où : plafond long à la PREMIÈRE visite d'une route, plafond court ensuite, et on
   rend la main dès que quelque chose bouge. Le plafond est réglable (--attente 30). */
const PLAFOND = Math.max(2, Number(arg('--attente', 30))) * 1000;  // première visite d'une route
const CHAUD = Math.min(PLAFOND, 3000);                             // route déjà rendue une fois
const PLANCHER = 900;                                              // on regarde toujours au moins ça

if (!URL_CIBLE || !/^https?:\/\//.test(URL_CIBLE)) {
  console.error('usage: node clics.mjs <url> [--json f] [--max 400] [--attente 30] [--sans-contre-epreuve]');
  process.exit(2);
}

/* Une route est « chaude » quand on l'a déjà vue rendue jusqu'au bout. Tant qu'elle est
   froide, elle a droit au plafond long : c'est peut-être le compilateur qui travaille. */
const routesChaudes = new Set();
const routeDe = (u) => { try { return new URL(u, URL_CIBLE).pathname; } catch { return String(u); } };
const marquerChaude = (u) => routesChaudes.add(routeDe(u));
const plafondPour = (u) => (routesChaudes.has(routeDe(u)) ? CHAUD : PLAFOND);

/* Le lien mène-t-il là où on est déjà ? Même chemin, même recherche, et pas d'ancre :
   un `#section` fait défiler, ce n'est pas « rien ». */
function memeEcran(href, ici) {
  try {
    const a = new URL(href, ici), b = new URL(ici);
    return !a.hash && a.host === b.host && a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
}

/* ── Liste négative : ce qu'on ne signale PAS ───────────────────────────────────
   · un lien de navigation qui change l'URL : c'est un OK, pas un « bouge »
   · un bouton qui bascule un état déjà atteint (« Aujourd'hui ») : contre-épreuve avant MORT
   · une exception JS sans conséquence visible : SILENCIEUX, jamais ERREUR
   · un bouton écarté ou non cliqué : compté et nommé, jamais mis en verdict OK/MORT     */

/* Ce qu'on ne touche pas, première famille : ce qui détruit.
   ⚠️ LES LIBELLÉS FRANÇAIS SONT DES SUBSTANTIFS, PAS DES VERBES. Un bouton s'appelle
   « Déconnexion », pas « Déconnecter » ; « Suppression », pas « Supprimer ». La liste
   d'origine ne cherchait que les radicaux verbaux et laissait passer « Déconnexion »
   (x, pas t), « Suppression » (suppress-, pas supprim-), « Révocation », « Retrait »,
   « Annulation », « Vidage ». Chaque forme est couverte des deux côtés. */
const DESTRUCTEUR = /supprim|suppress|delet|effac|vidage|vider|vide|purg|réinitialis|reinitialis|reset|archiv|déconnect|deconnect|déconnex|deconnex|logout|désactiv|desactiv|désinscri|desinscri|révoqu|revoqu|révoca|revoca|résili|resili|annuler l|annulation|retirer|retrait/i;

/* Deuxième famille : ce qui ÉCRIT. Enregistrer les paramètres d'un client ou lui créer
   un dossier en base, c'est écrire chez lui. Volontairement large : rater un bouton
   coûte un constat, en cliquer un mauvais coûte une donnée client.
   Même règle des substantifs : « Dépôt » (pas déposer), « Envoi » (pas envoyer),
   « Création » (pas créer), « Publication », « Soumission ». « publier » et
   « publication » sont écrits en entier : « publi » attraperait le module
   « Publicité », qui ne fait qu'afficher. */
const ECRITURE = /\b(enregistr|sauvegard|save|cr[ée]e|cr[ée]a|creat|nouveau|nouvel|ajout|add\b|d[ée]pos|d[ée]p[oô]t|upload|t[ée]l[ée]vers|envoy|envoi|send\b|publier|publication|publish|valid|confirm|soumet|soumission|submit|import|export|synchro|sync\b)/i;

/* Un message d'erreur à l'écran. On cherche les mots ET les rôles ARIA ET les classes :
   les trois se ratent l'un l'autre selon la bibliothèque d'interface utilisée. */
const MOTS_ERREUR = /\b(erreur|échec|echec|impossible|introuvable|n'a pas abouti|a échoué|a echoue|réessay|reessay|oups|oops|une erreur est survenue|something went wrong|failed|error)\b/i;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/* Le recenseur vit DANS la page (installé avant chaque navigation). La même fonction
   sert au recensement et à la re-résolution par clé : pas deux façons de compter. */
const RECENSEUR = `window.__recenser = function () {
  const sel = 'button,a[href],[role="button"],[role="tab"],[role="menuitem"],[role="switch"],[role="checkbox"],input[type="submit"],summary';
  const norm = (s) => (s || '').trim().replace(/\\s+/g, ' ');
  const vus = new Map();
  const cleDe = new Map();
  const liste = [...document.querySelectorAll(sel)].map((el) => {
    const r = el.getBoundingClientRect();
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const libelle = norm(typeof el.innerText === 'string' ? el.innerText : el.textContent
      || el.getAttribute('aria-label') || el.getAttribute('title') || el.value || '').slice(0, 60)
      || norm(el.getAttribute('aria-label') || el.getAttribute('title') || '').slice(0, 60);
    const href = el.getAttribute('href') || '';
    const base = role + '|' + libelle + '|' + href;
    const rang = vus.get(base) || 0; vus.set(base, rang + 1);
    const form = el.closest('form');
    const type = (el.getAttribute('type') || '').toLowerCase();
    const cle = base + '|' + rang;
    cleDe.set(el, cle);
    return { el, cle, role, libelle, href: href || null, rang,
      visible: r.width > 0 && r.height > 0,
      submit: type === 'submit' || (el.tagName === 'BUTTON' && !type && !!form),
      dansForm: !!form, inclus: null };
  });
  // Un cliquable dans un cliquable : c'est le parent qui reçoit le clic.
  for (const x of liste) {
    const parent = x.el.parentElement && x.el.parentElement.closest(sel);
    if (parent) x.inclus = cleDe.get(parent) || null;
  }
  return liste;
};`;

/* ── Sommes-nous dans l'application ? ───────────────────────────────────────────
   Liste négative : on ne signale PAS ici une page vide de contenu métier (c'est le
   travail de liens.mjs, verdict VIDE) ni une page qui charge Clerk en arrière-plan
   pour son bouton d'utilisateur. On refuse seulement ce qui N'EST PAS l'écran audité. */
async function pasDansLapp(page, rep, urlCible) {
  const ct = (rep.headers()['content-type'] || '').toLowerCase();
  if (ct && !/text\/html|application\/xhtml/.test(ct)) return `réponse non-HTML (${ct.split(';')[0]})`;
  const vise = new URL(urlCible).host, ici = new URL(page.url()).host;
  if (vise !== ici) return `redirigé hors de l'application, vers ${ici}`;
  const m = await page.evaluate(() => {
    const texte = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const motDePasse = !!document.querySelector('input[type="password"]');
    const clerk = !!document.querySelector('[class*="cl-signIn"],[class*="cl-signUp"],[class*="cl-rootBox"] form,#clerk-captcha');
    const auth = !!document.querySelector('form[action*="/api/auth/"],form[action*="sign-in"],form[action*="login"],[data-supabase-auth-ui]');
    const motsConnexion = /\b(sign in|sign up|log in|se connecter|connectez-vous|créer un compte|mot de passe oublié)\b/i.test(texte.slice(0, 500));
    return { taille: texte.length, motDePasse, clerk, auth, motsConnexion, formulaire: !!document.querySelector('form,input') };
  });
  if (m.motDePasse) return 'écran de connexion (champ mot de passe)';
  if (m.clerk) return 'écran de connexion Clerk';
  if (m.auth) return 'écran de connexion d\'un fournisseur d\'authentification';
  if (m.motsConnexion && m.formulaire) return 'écran de connexion (formulaire « se connecter »)';
  if (m.taille < 200) return `corps quasi vide (${m.taille} caractères de texte)`;
  return null;
}

async function etat(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const txt = (e) => (typeof e.innerText === 'string' ? e.innerText : e.textContent || '').trim();
    const alertes = [...document.querySelectorAll('[role="alert"],[role="status"],[aria-live]')]
      .filter(vis).map(txt).filter(Boolean);
    const classes = [...document.querySelectorAll('[class*="error"],[class*="destructive"],[class*="danger"]')]
      .filter(vis).map(txt).filter(Boolean);
    /* La zone PRINCIPALE, sans la coquille (barre latérale, en-tête) : c'est elle qui
       dit si l'écran s'est vidé. <main> quand il existe, sinon le corps moins la coquille. */
    const main = document.querySelector('main,[role="main"]');
    const coquille = [...document.querySelectorAll('nav,aside,header,footer')].reduce((n, e) => n + txt(e).length, 0);
    const principal = main ? txt(main).length : Math.max(0, document.body.innerText.trim().length - coquille);
    return {
      url: location.href,
      texte: document.body.innerText,
      taille: document.body.innerText.length,
      principal,
      hauteur: document.body.scrollHeight,
      alertes, classes,
    };
  });
}

/* Attendre le RENDU RÉEL, pas un délai fixe : réseau calme, puis le nombre d'éléments
   cliquables identique sur deux mesures consécutives. Le contenu d'un écran arrive
   souvent après la coquille (barre latérale d'abord, liste ensuite) : c'est exactement
   l'intervalle où l'ancien code ré-interrogeait le DOM et ne trouvait plus rien. */
async function attendreRendu(page, max = PLAFOND) {
  await page.waitForLoadState('networkidle', { timeout: max }).catch(() => {});
  const t0 = Date.now();
  let prec = -1;
  while (Date.now() - t0 < max) {
    const n = await page.evaluate(() => window.__recenser ? window.__recenser().filter((x) => x.visible).length : -1)
      .catch(() => -1);
    /* Rendue pour de bon : on peut passer cette route en « chaude », la prochaine
       visite n'aura plus besoin du plafond long. Un plafond atteint sans stabilité ne
       prouve rien : la route reste froide et gardera son long délai. */
    if (n >= 0 && n === prec) { if (n > 0) marquerChaude(page.url()); return n; }
    prec = n;
    await dormir(300);
  }
  return prec;
}

/* ── APRÈS UN CLIC, ON REGARDE ; ON NE COMPTE PAS JUSQU'À MILLE ────────────────
   « Bouger », c'est l'URL qui change, la taille du texte qui change, un message qui
   apparaît, OU une requête partie après le clic encore en vol. Tant que le serveur
   travaille, on lui laisse le temps, jusqu'au plafond. Dès que quelque chose bouge, on
   rend la main : sur une route déjà chaude, un clic se juge en une seconde.
   L'ancienne version dormait 1 000 ms et lisait l'écran. Sur une route froide, elle
   lisait l'état d'AVANT et écrivait « aucune requête, aucun changement ». */
function aBouge(avant, apres) {
  return apres.url !== avant.url || apres.taille !== avant.taille
    || apres.alertes.length !== avant.alertes.length || apres.classes.length !== avant.classes.length;
}
async function observer(page, avant, plafond, depuis = Date.now(), ongletsAvant = compteurOnglets.n) {
  const t0 = Date.now();
  let apres = avant;
  for (;;) {
    await dormir(150);
    const e = await etat(page).catch(() => null);   // pendant une navigation, le contexte meurt : on repasse
    if (e) apres = e;
    if (aBouge(avant, apres)) return apres;
    if (compteurOnglets.n > ongletsAvant) return { ...apres, onglet: compteurOnglets.dernier };
    const ecoule = Date.now() - t0;
    if (ecoule < PLANCHER) continue;
    if (ecoule >= plafond) return apres;
    /* Une requête partie DEPUIS le clic est en vol : le serveur compile ou répond, on
       attend. `depuis` est relevé AVANT le clic : sans ça, la requête déclenchée par le
       clic part souvent avant qu'on ait commencé à regarder, et on l'ignorerait. */
    if (compteurVol.enVol > 0 && compteurVol.depart >= depuis
        && Date.now() - compteurVol.dernier < 4000) continue;   // filet : un compteur qui dérive ne doit pas bloquer au plafond
    return apres;                                   // rien en vol, rien qui bouge : inutile d'attendre
  }
}

/* Combien de requêtes sont en vol, et depuis quand. Sans ce compteur, impossible de
   distinguer « le serveur travaille » de « le bouton ne fait rien ». */
const compteurVol = { enVol: 0, depart: 0, dernier: 0 };

/* ── UN LIEN QUI S'OUVRE DANS UN NOUVEL ONGLET N'EST PAS MORT ──────────────────
   `target="_blank"` : le clic marche parfaitement, mais rien ne bouge dans l'onglet
   qu'on regarde. Vérifié à la main sur un projet public : « THEFOUNDEROS.COM » ouvre
   bien https://www.thefounderos.com/, et sortait « MORT » sur les quatre écrans qui le
   portent. On compte donc les onglets ouverts, et on les referme derrière nous. */
const compteurOnglets = { n: 0, dernier: null, urls: [] };
/* L'adresse d'un onglet arrive APRÈS son ouverture. Sans cette attente indexée, le
   message citait l'adresse d'un onglet ouvert par un clic précédent : le verdict était
   juste, le détail était faux, et un détail faux suffit à faire douter du reste. */
async function adresseOnglet(i, secours) {
  for (let k = 0; k < 20; k++) {
    const u = compteurOnglets.urls[i];
    if (u && !/^about:/.test(u)) return u;
    await dormir(150);
  }
  return secours || compteurOnglets.urls[i] || '';
}

/* ── UN BOUTON QUI NE CHANGE QUE L'ÉTAT SÉLECTIONNÉ N'EST PAS MORT NON PLUS ────
   Un filtre de plateforme (« INSTAGRAM », « TIKTOK ») bascule une classe CSS : le
   HTML change de douze caractères, le TEXTE ne change pas d'un signe. Mesuré à la
   main : cinq faux « morts » par écran sur un projet public. On relève donc la
   signature d'état du bouton (ses classes, ses aria-*, ses data-*) et le volume de son
   conteneur immédiat, qui capte aussi le frère qui se dé-sélectionne.
   ⚠️ On la lit sur la POIGNÉE de l'élément, jamais par sa clé : le bouton « Fullscreen »
   du projet d'épreuve devient « Exit fullscreen » quand il marche, donc son libellé
   change, donc sa clé change, donc on ne le retrouve plus et on conclut « rien n'a
   bougé ». Le changement qu'on cherche détruisait l'identifiant qui servait à le voir. */
const signatureDe = (el) => (el ? el.evaluate((e) => {
  const at = [...e.attributes].filter((z) => /^(class|aria-|data-)/.test(z.name))
    .map((z) => z.name + '=' + z.value).join('|').slice(0, 500);
  return at + '#' + (e.parentElement ? e.parentElement.innerHTML.length : 0);
}).catch(() => null) : Promise.resolve(null));

/* ── UNE ERREUR DE PAGE N'EST PAS UNE ERREUR DE BOUTON ─────────────────────────
   Un 404 sur une image de fond présente dans la coquille échoue à CHAQUE chargement,
   sur les 30 écrans, qu'on clique ou non. L'imputer au bouton qu'on vient de cliquer
   donne 4 fausses « erreurs au clic » sur un seul écran du projet public. On relève
   donc les échecs AU CHARGEMENT, avant tout clic, et on les soustrait ensuite.
   Ils ne sont pas perdus pour autant : ils sortent à part, en « erreurs de page ». */
const echecsReseau = [];
const echecsDePage = new Map();
/* Même règle pour la CONSOLE. Le 404 d'une image de la coquille y arrive AUSSI, sous
   la forme « Failed to load resource … 404 » : sans cette soustraction, il ressortait
   en SILENCIEUX sur trois boutons du même écran, après avoir été retiré des ERREUR.
   Une panne qui parle par deux portes doit être fermée aux deux. */
const messagesDePage = new Set();
const journalConsole = [];
const cleEchec = (e) => `${e.s}|${String(e.u).replace(/^https?:\/\/[^/]+/, '').split('?')[0]}`;
const direEchec = (e) => `${e.s ? e.s : (e.pourquoi || 'requête en échec')} sur ${String(e.u).replace(/^https?:\/\/[^/]+/, '')}`;

const recenser = (page) => page.evaluate(() => window.__recenser().filter((x) => x.visible)
  .map(({ el, ...r }) => r));

async function trouver(page, cle) {
  const h = await page.evaluateHandle((c) => (window.__recenser().find((x) => x.cle === c) || {}).el || null, cle)
    .catch(() => null);
  return h ? h.asElement() : null;
}

/* ── UN VOILE QUI RECOUVRE L'ÉCRAN SE VOIT AVANT, PAS APRÈS ────────────────────
   Sur le projet d'épreuve, la page d'accueil a consommé 15 des 37 minutes du scan et
   a fini tuée par le garde-fou : une modale de bienvenue en `fixed inset-0` recouvrait
   tout, chaque clic tapait dans le voile, échouait, et attendait son délai. 88 boutons
   sur 95 « recouverts par un autre élément », un seul cliqué.
   On regarde donc AVANT de cliquer : qu'y a-t-il réellement au point de clic ? Et si
   c'est un voile, on essaie une fois de le fermer sans rien savoir du projet (Échap,
   puis un bouton de fermeture DANS le voile). S'il résiste, on arrête l'écran et on le
   DIT : « écran couvert par un voile impossible à fermer, N boutons non atteints » est
   un constat utile, quinze minutes d'échecs muets n'en sont pas un. */

/* Le sélecteur d'un voile : fixé ou absolu, visible, qui couvre l'essentiel de la
   fenêtre. La même expression sert à le détecter et à y chercher le bouton de sortie. */
const VOILE_DANS_PAGE = `window.__voiles = function () {
  const de = document.documentElement;
  return [...document.querySelectorAll('body *')].filter((e) => {
    if (!(e instanceof HTMLElement)) return false;
    const s = getComputedStyle(e);
    if (s.position !== 'fixed' && s.position !== 'absolute') return false;
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    if (s.pointerEvents === 'none') return false;
    const r = e.getBoundingClientRect();
    return r.width >= de.clientWidth * 0.9 && r.height >= de.clientHeight * 0.9;
  });
};
window.__voileCouvrant = function () {
  const de = document.documentElement;
  const dessus = document.elementFromPoint(de.clientWidth / 2, de.clientHeight / 2);
  if (!dessus) return null;
  const v = window.__voiles().find((e) => e === dessus || e.contains(dessus));
  if (!v) return null;
  const cls = typeof v.className === 'string' ? v.className.split(/\\s+/).filter(Boolean).slice(0, 2).join('.') : '';
  return { quoi: (v.getAttribute('role') || v.tagName.toLowerCase()) + (cls ? '.' + cls : ''),
           texte: (v.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 70) };
};`;

/* Les libellés d'un bouton de sortie. Volontairement courts et ancrés : « Continuer »
   ferme un accueil, « Continuer la commande » ne doit pas être cliqué au hasard. */
const FERMER = /^(fermer|close|continuer|continue|plus tard|later|passer|skip|ignorer|dismiss|got it|j'ai compris|compris|d'accord|ok|non merci|no thanks|×|✕|✖|x)$/i;

const voileCouvrant = (page) => page.evaluate(() => window.__voileCouvrant()).catch(() => null);

/* Un voile revient à CHAQUE rechargement (c'est une modale de bienvenue, pas un état).
   La levée appartient donc au chargement de page, pas au début du script : sans ça, le
   voile est fermé une fois au départ et rebarre la route au deuxième essai de chaque
   « mort ». `voilePersistant` retient celui qui a résisté, pour que l'appelant décide. */
let voilePersistant = null;
let voileLeve = null;
async function leverVoile(page) {
  const v = await voileCouvrant(page);
  if (!v) { voilePersistant = null; return null; }
  const f = await fermerVoile(page);
  if (f) { voileLeve = voileLeve || f; voilePersistant = null; return f; }
  voilePersistant = v;
  return null;
}

/* Fermer un voile SANS RIEN SAVOIR DU PROJET. Deux gestes seulement, dans cet ordre :
   la touche Échap, puis un bouton de fermeture pris DANS le voile. Jamais un bouton qui
   écrit ou qui détruit, même à l'intérieur d'une modale : « Envoyer » n'est pas une
   sortie de secours. */
async function fermerVoile(page) {
  await page.keyboard.press('Escape').catch(() => {});
  await dormir(500);
  if (!await voileCouvrant(page)) return 'touche Échap';

  const ferme = await page.evaluate(({ fer, dest, ecr }) => {
    const reF = new RegExp(fer, 'i'), reD = new RegExp(dest, 'i'), reE = new RegExp(ecr, 'i');
    const lib = (e) => ((e.innerText || '').trim() || (e.getAttribute('aria-label') || '').trim()
      || (e.getAttribute('title') || '').trim()).replace(/\s+/g, ' ');
    for (const v of window.__voiles()) {
      const b = [...v.querySelectorAll('button,[role="button"],a,[aria-label]')].find((e) => {
        const l = lib(e);
        return reF.test(l) && !reD.test(l) && !reE.test(l);
      });
      if (b) { b.click(); return lib(b) || '(sans libellé)'; }
    }
    return null;
  }, { fer: FERMER.source, dest: DESTRUCTEUR.source, ecr: ECRITURE.source }).catch(() => null);

  if (!ferme) return null;
  await dormir(700);
  return await voileCouvrant(page) ? null : `bouton « ${ferme} »`;
}

/* ── EST-CE SEULEMENT ATTEIGNABLE ? ────────────────────────────────────────────
   On ne dépense plus un délai de clic entier pour apprendre qu'un élément est
   recouvert, hors écran ou insensible au pointeur : on le demande à la page. Ce qui
   n'est pas atteignable est compté « non atteint » avec sa raison, sans tentative. */
async function atteignable(page, cle) {
  return page.evaluate((c) => {
    const x = window.__recenser().find((y) => y.cle === c);
    if (!x) return { ok: false, raison: 'disparu (introuvable dans la page)' };
    const el = x.el;
    try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch { /* pas grave */ }
    const de = document.documentElement;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { ok: false, raison: 'hors de portée (boîte de taille nulle)' };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx < 0 || cy < 0 || cx > de.clientWidth || cy > de.clientHeight) {
      return { ok: false, raison: `hors de portée (centre à x=${Math.round(cx)}, y=${Math.round(cy)})` };
    }
    if (getComputedStyle(el).pointerEvents === 'none') return { ok: false, raison: 'insensible au pointeur (pointer-events: none)' };
    const dessus = document.elementFromPoint(cx, cy);
    if (!dessus) return { ok: false, raison: 'rien au point de clic' };
    if (dessus === el || el.contains(dessus) || dessus.contains(el)) return { ok: true };
    const v = window.__voileCouvrant();
    if (v) return { ok: false, voile: v, raison: `recouvert par un voile plein écran (${v.quoi})` };
    const cls = typeof dessus.className === 'string' ? dessus.className.split(/\s+/).filter(Boolean)[0] : '';
    return { ok: false, raison: `recouvert par ${dessus.tagName.toLowerCase()}${cls ? '.' + cls : ''}` };
  }, cle).catch(() => ({ ok: true }));   // en cas de doute on tente le clic, comme avant
}

/* Pourquoi un clic n'a pas eu lieu, en un mot que le lecteur comprend. */
function raisonDe(err) {
  const s = String(err && err.message || err);
  if (/intercepts pointer events/i.test(s)) return 'recouvert par un autre élément';
  if (/not visible|outside of the viewport|zero size|hidden/i.test(s)) return 'hors de portée (invisible ou hors écran)';
  if (/not attached|detached|Target closed/i.test(s)) return 'disparu pendant le clic';
  return `délai de ${DELAI_CLIC / 1000} s dépassé`;
}

async function chargerPage(page, plafond = null) {
  const avantR = echecsReseau.length, avantM = journalConsole.length;
  const rep = await page.goto(URL_CIBLE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await attendreRendu(page, plafond || plafondPour(URL_CIBLE));
  await leverVoile(page);      // la modale de bienvenue revient à chaque chargement
  /* Tout ce qui a échoué PENDANT un chargement, sans qu'on ait cliqué : c'est la page,
     pas un bouton. On l'enregistre une fois pour toutes, et on le soustrait ensuite. */
  for (const e of echecsReseau.slice(avantR)) {
    const k = cleEchec(e);
    const c = echecsDePage.get(k) || { s: e.s, u: e.u, pourquoi: e.pourquoi, n: 0 };
    c.n++; echecsDePage.set(k, c);
  }
  for (const m of journalConsole.slice(avantM)) messagesDePage.add(m);
  return rep;
}

(async () => {
  const T0 = Date.now();
  const nav = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(RECENSEUR);
  await page.addInitScript(VOILE_DANS_PAGE);

  const console_ = journalConsole;
  page.on('request', () => { compteurVol.enVol++; compteurVol.depart = compteurVol.dernier = Date.now(); });
  const atterri = () => { compteurVol.enVol = Math.max(0, compteurVol.enVol - 1); compteurVol.dernier = Date.now(); };
  page.on('requestfinished', atterri);
  page.on('requestfailed', (r) => {
    atterri();
    const t = r.failure() && r.failure().errorText;
    // Une requête annulée par une navigation n'est pas un échec du serveur.
    if (!/ABORTED/i.test(String(t))) echecsReseau.push({ s: 0, u: r.url(), pourquoi: t });
  });
  page.on('response', (r) => { if (r.status() >= 400) echecsReseau.push({ s: r.status(), u: r.url() }); });
  /* Un onglet ouvert par un clic : on note son adresse et on le referme. On ne laisse
     pas trente onglets derrière nous sur le poste de quelqu'un. */
  ctx.on('page', async (p) => {
    const i = compteurOnglets.n++;
    compteurOnglets.urls[i] = p.url() || '';
    await p.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    compteurOnglets.urls[i] = compteurOnglets.dernier = p.url();
    await p.close().catch(() => {});
  });
  page.on('console', (m) => { if (m.type() === 'error') console_.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => console_.push('EXCEPTION ' + String(e).slice(0, 200)));

  const entete = () => { console.log(`\n  CLICS : ${URL_CIBLE}`); console.log(`  ${'-'.repeat(72)}`); };

  /* ON NE CONCLUT PAS SANS PAGE. Avant, une application éteinte donnait « recensés 0 ·
     OK : 0 » en code 0 : un audit qui rassure sur ce qu'il n'a pas regardé. */
  const rep = await chargerPage(page);
  if (!rep) {
    entete();
    console.log(`  ⛔ Impossible de charger la page : ${URL_CIBLE} ne répond pas. Rien n'a été testé.\n`);
    await nav.close(); process.exit(2);
  }
  if (rep.status() >= 400) {
    entete();
    console.log(`  ⛔ Le serveur répond ${rep.status()} sur ${URL_CIBLE}. Rien n'a été testé.\n`);
    await nav.close(); process.exit(2);
  }
  const base = await etat(page);
  if (/^404\b|page could not be found|introuvable/i.test(base.texte.slice(0, 120))) {
    entete();
    console.log(`  ⛔ Cette page n'existe pas (404 affiché). Rien n'a été testé.\n`);
    await nav.close(); process.exit(2);
  }
  const horsApp = await pasDansLapp(page, rep, URL_CIBLE);
  if (horsApp) {
    entete();
    console.log(`  ⛔ Je ne suis pas dans l'application : ${horsApp}. Rien n'a été testé.\n`);
    await nav.close(); process.exit(2);
  }

  /* LE VOILE, AVANT TOUT LE RESTE : `chargerPage` a déjà tenté de le lever. S'il a
     résisté, aucun clic ne portera : autant le savoir maintenant plutôt qu'après
     95 échecs à 2,5 s chacun. */
  const voile = voilePersistant;

  /* Recensement. On prend tout ce qui se clique, y compris les rôles ARIA : beaucoup
     de composants modernes ne sont pas des <button>. */
  const tous = await recenser(page);

  const ecartes = [];
  const inclus = [];
  const aCliquer = [];
  for (const b of tous) {
    if (b.inclus) {
      const parent = tous.find((p) => p.cle === b.inclus);
      inclus.push({ libelle: b.libelle || '(sans libellé)', dans: parent ? parent.libelle || '(sans libellé)' : b.inclus.split('|')[1] });
      continue;
    }
    let raison = null;
    if (DESTRUCTEUR.test(b.libelle)) raison = 'destructeur';
    else if (b.submit) raison = 'bouton de soumission (type=submit)';
    else if (b.dansForm) raison = 'dans un formulaire';
    /* Le verbe compte en TÊTE du libellé : « Ajouter une affaire… » écrit, une fiche de
       liste « Chemin de la Pesse 1 · CHF 840'000 · Envoyée » ne fait qu'ouvrir un détail. */
    else if (ECRITURE.test(b.libelle.slice(0, 25))) raison = 'verbe d\'écriture dans le libellé';
    if (raison) ecartes.push({ libelle: b.libelle || '(sans libellé)', raison, href: b.href });
    else aCliquer.push(b);
  }
  const nonCliques = [];
  for (const b of aCliquer.slice(MAX)) nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison: `au-delà de --max ${MAX}` });
  const liste = aCliquer.slice(0, MAX);

  const R = { url: URL_CIBLE, recenses: tous.length, cliques: 0, attente_max_s: PLAFOND / 1000,
    ecartes, non_cliques: nonCliques, inclus, verdicts: [] };
  if (voileLeve) R.voile_ferme = voileLeve;

  /* VOILE QUI RÉSISTE : on arrête l'écran ici. Un constat net vaut mieux que quinze
     minutes d'échecs muets, et c'est un défaut en soi : l'écran n'est pas utilisable
     tant que ce voile est là et que rien de simple ne le ferme. */
  if (voile) {
    for (const b of liste) {
      nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison: `voile plein écran (${voile.quoi})` });
    }
    R.voile = { ...voile, boutons_non_atteints: liste.length };
    R.duree_s = Math.round((Date.now() - T0) / 1000);
    R.echecs_de_page = [...echecsDePage.values()].map((e) => ({ ...e, ou: direEchec(e) }));
    await nav.close();
    entete();
    console.log(`  ⛔ Écran couvert par un voile impossible à fermer (${voile.quoi})`);
    if (voile.texte) console.log(`     il affiche : « ${voile.texte} »`);
    console.log(`     ${liste.length} bouton(s) non atteints. Ni la touche Échap ni un bouton de fermeture`);
    console.log(`     (Fermer, Close, Continuer, Plus tard, Passer, ×…) n'ont fait disparaître ce voile.`);
    console.log(`     recensés ${R.recenses} · écartés ${ecartes.length} · non atteints ${nonCliques.length} · ${R.duree_s} s\n`);
    const jv = arg('--json', null);
    if (jv) ecrireJson(process.cwd(), 'clics.json', R, jv);
    process.exit(1);
  }

  /* Le plafond d'un clic : la route visée si le bouton est un lien, sinon la route
     courante. Un bouton qui navigue sans href n'est pas prévisible : le premier essai
     sera court, et c'est le deuxième essai (plafond long) qui tranchera. */
  const plafondClic = (b) => (b.href && !/^(#|javascript:|mailto:|tel:)/i.test(b.href)
    ? plafondPour(b.href) : plafondPour(page.url()));

  for (const b of liste) {
    // On repart toujours de la même page : un clic précédent a pu naviguer ailleurs.
    if (page.url() !== base.url) await chargerPage(page);

    /* Re-résolution PAR CLÉ. Si la clé ne répond plus (un panneau ouvert a changé
       l'écran), on recharge une fois et on recommence. Après, on compte. */
    let el = await trouver(page, b.cle);
    if (!el) { await chargerPage(page); el = await trouver(page, b.cle); }
    if (!el) { nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison: 'disparu (introuvable après rechargement)' }); continue; }

    /* ATTEIGNABLE ? On le demande à la page AVANT de dépenser un délai de clic entier.
       Un voile apparu en cours de route (une modale ouverte par le clic précédent) :
       on tente de le fermer une fois, et s'il résiste on arrête l'écran ici. */
    let acces = await atteignable(page, b.cle);
    if (!acces.ok && acces.voile) {
      const ferme = await fermerVoile(page);
      if (ferme) { R.voile_ferme = R.voile_ferme || ferme; acces = await atteignable(page, b.cle); }
    }
    /* ⚠️ UN MODE PLEIN ÉCRAN N'EST PAS UN VOILE. Sur le projet d'épreuve, le bouton
       « Fullscreen » de /funnel ouvre une vue plein écran parfaitement légitime, que la
       touche Échap ne ferme pas : prise pour un voile, elle faisait abandonner l'écran
       et coûtait 17 clics. La différence tient en une chose : un voile de bienvenue est
       là AU CHARGEMENT, un mode plein écran vient d'un clic. On recharge donc la page,
       et on n'abandonne que si le voile est TOUJOURS là sur une page neuve. */
    if (!acces.ok && acces.voile) {
      await chargerPage(page, PLAFOND);
      acces = await atteignable(page, b.cle);
    }
    if (!acces.ok && acces.voile) {
      const reste = liste.slice(liste.indexOf(b));
      for (const x of reste) nonCliques.push({ libelle: x.libelle || '(sans libellé)', raison: `voile plein écran (${acces.voile.quoi})` });
      R.voile = { ...acces.voile, boutons_non_atteints: reste.length, apparu_en_cours: true };
      break;
    }
    if (!acces.ok) { nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison: acces.raison }); continue; }

    const avantR = echecsReseau.length, avantC = console_.length;
    let avant = await etat(page);
    let sigAvant = await signatureDe(el);
    const ongletsAvant = compteurOnglets.n;
    const plafond = plafondClic(b);

    let clique = false, raison = null, elClique = el;
    let tClic = Date.now();
    try { await el.click({ timeout: DELAI_CLIC }); clique = true; }
    catch (e1) {
      raison = raisonDe(e1);
      // Deuxième chance sur page fraîche : ce qui recouvrait n'est plus là.
      await chargerPage(page);
      const el2 = await trouver(page, b.cle);
      /* L'état d'avant doit être celui de CETTE page-ci : après un rechargement, le
         comparer à l'état d'avant le rechargement fait passer le rechargement lui-même
         pour l'effet du bouton. */
      avant = await etat(page);
      elClique = el2;
      sigAvant = await signatureDe(el2);
      tClic = Date.now();
      if (el2) { try { await el2.click({ timeout: DELAI_CLIC }); clique = true; raison = null; } catch (e2) { raison = raisonDe(e2); } }
      else raison = 'disparu (introuvable après rechargement)';
    }
    if (!clique) { nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison }); continue; }
    R.cliques++;

    const apres = await observer(page, avant, plafond, tClic, ongletsAvant);
    const sigApres = await signatureDe(elClique);
    const nouvelOnglet = compteurOnglets.n > ongletsAvant;
    const etatChange = sigAvant !== null && sigApres !== null && sigAvant !== sigApres;
    const nouvellesAlertes = [...apres.alertes, ...apres.classes]
      .filter((t) => !avant.alertes.includes(t) && !avant.classes.includes(t));
    // Ce qui échoue à chaque chargement de la page n'est pas imputable à ce bouton.
    const echecs = echecsReseau.slice(avantR).filter((e) => !echecsDePage.has(cleEchec(e)));
    // Une exception déjà présente au chargement n'est pas le fait de ce bouton.
    const erreursJS = console_.slice(avantC).filter((m) => !messagesDePage.has(m));

    const messageErreur = nouvellesAlertes.find((t) => MOTS_ERREUR.test(t));
    /* Repli sans rôle ARIA : une ligne NOUVELLE et COURTE qui contient un mot d'erreur.
       Courte, parce qu'un message d'erreur tient en une ligne ; la prose d'un document
       affiché (« … transforme une erreur en vérité de wiki ») n'en est pas un. Sur
       la base de connaissances d'un client, deux fiches ouvertes passaient pour des ERREUR. */
    const lignesAvant = new Set(avant.texte.split('\n').map((l) => l.trim()));
    /* Et un message d'erreur est PETIT : un clic qui fait apparaître un document entier
       (des milliers de caractères) n'a pas produit un message, même si une de ses lignes
       contient « erreur ». Chez un client, un fichier AGENTS.md ouvert passait pour une ERREUR. */
    const ajoute = apres.taille - avant.taille;
    const texteErreur = messageErreur || ajoute > 600 ? null
      : apres.texte.split('\n').map((l) => l.trim())
        .find((l) => l && l.length <= 120 && !lignesAvant.has(l) && MOTS_ERREUR.test(l)) || null;

    const bouge = aBouge(avant, apres) || nouvellesAlertes.length > 0 || nouvelOnglet || etatChange;
    /* « Cassé » : la ZONE PRINCIPALE se vide sans changement de page. Liste négative :
       un filtre, un dossier ouvert, une bascule de vue (liste → graphe) ou un mode focus
       réduisent le texte, et ce n'est pas cassé. La règle « moins de 35 % du texte »
       comptait 49 faux CASSÉ sur les 49 dossiers de la bibliothèque d'un client. */
    const vide = apres.url === avant.url && avant.principal > 300 && apres.principal < 80;

    /* Une exception JavaScript qui ne casse rien à l'écran n'est PAS au même rang qu'un
       message d'erreur lu par le client. Chez un client, la carte Leaflet plante au montage
       sur quatre écrans sans aucune conséquence visible : la signaler comme « ERREUR »
       la met au même niveau que « Le test n'a pas abouti », et c'est faux. */
    let verdict = 'OK', pourquoi = '';
    if (messageErreur || texteErreur) { verdict = 'ERREUR'; pourquoi = (messageErreur || texteErreur).replace(/\s+/g, ' ').slice(0, 140); }
    else if (echecs.length) { verdict = 'ERREUR'; pourquoi = direEchec(echecs[0]); }
    else if (erreursJS.length && vide) { verdict = 'ERREUR'; pourquoi = erreursJS[0]; }
    else if (erreursJS.length) { verdict = 'SILENCIEUX'; pourquoi = erreursJS[0]; }
    else if (vide) { verdict = 'CASSÉ'; pourquoi = `l'écran passe de ${avant.taille} à ${apres.taille} caractères`; }
    /* LISTE NÉGATIVE : un lien vers l'écran DÉJÀ affiché ne peut rien faire bouger.
       Chaque barre de navigation en contient un (l'onglet de la page courante), et il
       sortait « MORT » sur tous les écrans : un faux positif par écran, mécanique, et
       personne n'attend qu'il se passe quelque chose en cliquant là où on est déjà. */
    else if (nouvelOnglet) {
      const u = await adresseOnglet(ongletsAvant, b.href);
      verdict = 'OK'; pourquoi = `ouvre un nouvel onglet${u ? ` vers ${u}` : ''}`;
    }
    else if (etatChange && !aBouge(avant, apres)) { verdict = 'OK'; pourquoi = 'change son état sélectionné (classes ou aria) sans changer le texte de l\'écran'; }
    /* Un lien que le NAVIGATEUR CONFIE AU SYSTÈME : mailto:, tel:, sms:, whatsapp:…
       Il n'a jamais rien à changer dans la page, et sans cette ligne il sortait « mort »
       (deux « EMAIL » et deux « SMS » sur un seul écran du projet d'épreuve, vérifiés à
       la main : ce sont des href mailto: et sms: parfaitement formés). */
    else if (!bouge && b.href && /^(?!https?:|\/|#|\.)[a-z][a-z0-9+.-]*:/i.test(b.href.trim())) {
      verdict = 'SANS OBJET';
      pourquoi = `lien « ${b.href.trim().split(':')[0]}: » : le navigateur le confie au système, rien ne bouge dans la page`;
    }
    else if (!bouge && b.href && memeEcran(b.href, avant.url)) {
      verdict = 'SANS OBJET'; pourquoi = 'lien vers l\'écran déjà affiché : il n\'y a rien à faire bouger';
    }
    else if (!bouge) { verdict = 'MORT'; pourquoi = `aucune requête, aucun changement, aucun message en ${Math.round(plafond / 1000)} s`; }

    R.verdicts.push({ libelle: b.libelle || '(sans libellé)', verdict, pourquoi, href: b.href, cle: b.cle,
      ...(verdict === 'MORT' ? { essais: 1 } : {}) });

    // Un panneau ou un menu ouvert recouvrirait le bouton suivant : on le referme.
    if (apres.url === avant.url) await page.keyboard.press('Escape').catch(() => {});
  }

  /* ── TROIS SILENCES VALENT UN VERDICT, UN SEUL N'EN VAUT AUCUN ────────────────
     DEUXIÈME ESSAI. Le premier essai est rapide par construction : sur une route encore
     froide il peut lire l'écran d'avant. On rejoue donc chaque « mort » sur une page
     REELLEMENT rendue (rechargement complet, attente jusqu'au plafond), et cette fois
     on observe jusqu'au plafond long. C'est ce seul essai qui ressuscite les 18 liens
     de navigation que le skill déclarait morts sur un projet public. */
  const morts1 = R.verdicts.filter((v) => v.verdict === 'MORT');
  for (const m of morts1) {
    await chargerPage(page, PLAFOND);
    const avantR = echecsReseau.length;
    const avant = await etat(page);
    const el = await trouver(page, m.cle);
    if (!el) { m.pourquoi += ' (2ᵉ essai : bouton disparu après rechargement)'; m.essais = 2; continue; }
    const sigAvant = await signatureDe(el);
    const ongletsAvant = compteurOnglets.n;
    const tClic = Date.now();
    try { await el.click({ timeout: DELAI_CLIC }); }
    catch (e) { m.pourquoi += ` (2ᵉ essai : ${raisonDe(e)})`; m.essais = 2; continue; }
    const apres = await observer(page, avant, PLAFOND, tClic, ongletsAvant);
    m.essais = 2;
    const echecs = echecsReseau.slice(avantR).filter((e) => !echecsDePage.has(cleEchec(e)));
    const sigApres = await signatureDe(el);
    if (compteurOnglets.n > ongletsAvant) {
      const u = await adresseOnglet(ongletsAvant, m.href);
      m.verdict = 'OK';
      m.pourquoi = `ouvre un nouvel onglet${u ? ` vers ${u}` : ''}`;
    } else if (sigAvant !== null && sigApres !== null && sigAvant !== sigApres) {
      m.verdict = 'OK';
      m.pourquoi = 'change son état sélectionné (classes ou aria) sans changer le texte de l\'écran';
    } else if (aBouge(avant, apres)) {
      m.verdict = 'OK';
      m.pourquoi = `paraissait inerte au premier essai, réagit une fois la page réellement rendue (${Math.round(PLAFOND / 1000)} s d'attente)`;
    } else if (echecs.length) {
      m.verdict = 'ERREUR'; m.pourquoi = direEchec(echecs[0]);
    }
  }

  /* TROISIÈME ESSAI, la CONTRE-ÉPREUVE des « morts ». Un bouton paraît inerte quand
     l'écran est DÉJÀ dans l'état qu'il produit : « Aujourd'hui » quand on est déjà
     aujourd'hui. On sort l'écran de cet état, puis on re-clique. Leçon payée quatre fois.

     QUI ON CLIQUE POUR DÉPLACER L'ÉCRAN, et qui on ne clique jamais :
     · les VOISINS IMMÉDIATS du bouton d'abord (même parent, puis même grand-parent) :
       les flèches « période précédente / suivante » sont collées à « Aujourd'hui », et
       ce sont elles qui changent l'état.
     · les boutons SANS libellé comptent : une flèche n'a qu'une icône, et les exclure
       faisait rater la seule commande capable de sortir de l'état visé.
     · JAMAIS un bouton qui écrit ou qui détruit : la première version tapait sur
       « Nouveau RDV » du calendrier d'un client. On ne répare pas un faux positif en
       créant un rendez-vous chez lui. Jamais un lien non plus : il nous sort de l'écran.
     · UN SEUL clic qui porte, pas six d'affilée : sur un calendrier, « précédent » puis
       « suivant » ramènent au point de départ et « Aujourd'hui » n'a toujours rien à
       faire. On clique un par un et on s'arrête dès que l'écran a vraiment bougé. */
  const morts = R.verdicts.filter((v) => v.verdict === 'MORT');
  if (morts.length && !a('--sans-contre-epreuve')) {
    for (const m of morts) {
      await chargerPage(page, PLAFOND);

      // Les voisins du mort, du plus proche au plus lointain, sans écriture ni lien.
      const voisins = await page.evaluate(({ cle, dest, ecr }) => {
        const reD = new RegExp(dest, 'i'), reE = new RegExp(ecr, 'i');
        const liste = window.__recenser();
        const cible = liste.find((x) => x.cle === cle);
        if (!cible) return [];
        const parent = cible.el.parentElement, grand = parent && parent.parentElement;
        return liste
          .filter((x) => x.visible && x.el !== cible.el && x.role !== 'a' && !x.el.closest('a[href]'))
          .filter((x) => x.submit !== true && x.dansForm !== true)
          .filter((x) => !x.libelle || (!reD.test(x.libelle) && !reE.test(x.libelle.slice(0, 25))))
          .map((x) => ({ cle: x.cle, rang: parent && x.el.parentElement === parent ? 0 : (grand && grand.contains(x.el) ? 1 : 2) }))
          .sort((u, v) => u.rang - v.rang)
          .slice(0, 6)
          .map((x) => x.cle);
      }, { cle: m.cle, dest: DESTRUCTEUR.source, ecr: ECRITURE.source }).catch(() => []);

      let deplace = false;
      for (const cle of voisins) {
        const avant = await etat(page);
        const h = await trouver(page, cle);
        if (!h) continue;
        const tV = Date.now();
        try { await h.click({ timeout: 1500 }); } catch { continue; }
        const apres = await observer(page, avant, plafondPour(page.url()), tV);
        if (apres.url !== avant.url) { await chargerPage(page); continue; }   // ce clic nous sortait de l'écran
        if (apres.taille !== avant.taille) { deplace = true; break; }
      }
      /* Sans déplacement, la contre-épreuve ne prouve rien : on le dit au lieu de
         confirmer la mort sur la foi d'un écran resté au même endroit. */
      if (!deplace) {
        m.pourquoi += ' (3ᵉ essai sans effet : aucun voisin n\'a déplacé l\'écran)';
        continue;
      }

      const avant = await etat(page);
      const el = await trouver(page, m.cle);
      if (!el) { m.pourquoi += ' (disparu pendant la contre-épreuve)'; continue; }
      const sig3 = await signatureDe(el);
      const ong3 = compteurOnglets.n;
      const tClic3 = Date.now();
      try { await el.click({ timeout: DELAI_CLIC }); } catch { continue; }
      m.essais = 3;
      const apres = await observer(page, avant, PLAFOND, tClic3, ong3);
      const sig3b = await signatureDe(el);
      if (compteurOnglets.n > ong3) {
        const u = await adresseOnglet(ong3, m.href);
        m.verdict = 'OK'; m.pourquoi = `ouvre un nouvel onglet${u ? ` vers ${u}` : ''}`;
      } else if (sig3 !== null && sig3b !== null && sig3 !== sig3b) {
        m.verdict = 'OK'; m.pourquoi = 'change son état sélectionné (classes ou aria) sans changer le texte de l\'écran';
      } else if (apres.url !== avant.url || apres.taille !== avant.taille) {
        m.verdict = 'OK'; m.pourquoi = 'paraissait inerte, mais réagit une fois l\'écran dans un autre état';
      }
    }
    /* Rien ne doit rester ouvert derrière nous : un dialogue laissé béant serait un
       formulaire de création à moitié rempli sur l'écran d'un client. */
    await page.keyboard.press('Escape').catch(() => {});
    R.dialogues_ouverts_a_la_fin = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length).catch(() => null);
  }

  await nav.close();
  R.duree_s = Math.round((Date.now() - T0) / 1000);
  /* Les échecs de la page elle-même, relevés au chargement, avant tout clic. Ils ne
     sont imputés à aucun bouton, et ils ne sont pas perdus non plus : un 404 permanent
     sur une image de la coquille est un vrai défaut, simplement pas celui d'un bouton. */
  R.echecs_de_page = [...echecsDePage.values()].map((e) => ({ ...e, ou: direEchec(e) }));
  R.messages_de_page = [...messagesDePage].slice(0, 10);

  const par = (v) => R.verdicts.filter((x) => x.verdict === v);
  entete();
  console.log(`  recensés ${R.recenses} · cliqués ${R.cliques} · écartés ${ecartes.length} · non cliqués ${nonCliques.length}`
    + `${inclus.length ? ` · inclus dans un parent ${inclus.length}` : ''} · ${R.duree_s} s`
    + ` · attente jusqu'à ${PLAFOND / 1000} s sur une route neuve`);
  if (voileLeve && !R.voile_ferme) R.voile_ferme = voileLeve;
  if (R.voile_ferme) console.log(`  un voile plein écran a été fermé au départ (${R.voile_ferme})`);
  if (R.voile) {
    console.log(`\n  ⛔ VOILE PLEIN ÉCRAN apparu en cours d'écran (${R.voile.quoi})`
      + `${R.voile.texte ? ` : « ${R.voile.texte} »` : ''}`);
    console.log(`     ${R.voile.boutons_non_atteints} bouton(s) non atteints : ni Échap ni un bouton de fermeture ne l'ont levé.`);
  }
  if (R.echecs_de_page.length) {
    console.log(`\n  ERREURS DE LA PAGE (${R.echecs_de_page.length})  : déjà en échec au chargement, AVANT tout clic.`);
    console.log(`  Ce n'est pas le défaut d'un bouton, mais c'en est un.`);
    for (const e of R.echecs_de_page.slice(0, 8)) console.log(`    ${e.ou}  (à ${e.n} chargement${e.n > 1 ? 's' : ''})`);
    if (R.echecs_de_page.length > 8) console.log(`    … et ${R.echecs_de_page.length - 8} autres`);
  }
  for (const v of ['ERREUR', 'CASSÉ', 'MORT', 'SILENCIEUX', 'SANS OBJET']) {
    const l = par(v);
    if (!l.length) continue;
    console.log(`\n  ${v} (${l.length})${v === 'SILENCIEUX' ? '  (le JavaScript plante, le client ne voit rien)' : ''}`
      + `${v === 'MORT' ? '  (silencieux aux trois essais)' : ''}`
      + `${v === 'SANS OBJET' ? '  (ce n\'est pas un défaut : rien n\'était attendu)' : ''}`);
    for (const x of l) console.log(`    « ${x.libelle} »  ${x.pourquoi}${x.essais ? `  [${x.essais} essai${x.essais > 1 ? 's' : ''}]` : ''}`);
  }
  if (ecartes.length) {
    console.log(`\n  ÉCARTÉS, à tester par agent ou à la main (${ecartes.length})`);
    for (const x of ecartes) console.log(`    « ${x.libelle} »  ${x.raison}`);
  }
  if (nonCliques.length) {
    console.log(`\n  NON CLIQUÉS (${nonCliques.length})  : voulus, pas atteints. Ce n'est pas un OK.`);
    for (const x of nonCliques) console.log(`    « ${x.libelle} »  ${x.raison}`);
  }
  if (inclus.length) {
    console.log(`\n  INCLUS dans un parent cliquable (${inclus.length})  : c'est le parent qui a été testé`);
    for (const x of inclus.slice(0, 12)) console.log(`    « ${x.libelle} »  dans « ${x.dans} »`);
    if (inclus.length > 12) console.log(`    … et ${inclus.length - 12} autres`);
  }
  console.log(`\n  OK : ${par('OK').length}\n`);

  // Le fichier va où --json le dit (couverture donne un chemin sous <repo>/.backend/).
  const j = arg('--json', null);
  if (j) ecrireJson(process.cwd(), 'clics.json', R, j);
  /* Un échec de la page compte aussi : il n'est imputé à aucun bouton, mais dire
     « rien de cassé, code 0 » en ayant affiché « ERREURS DE LA PAGE (1) » serait
     précisément le genre de contradiction interne qu'on reproche à ce skill. */
  process.exitCode = par('ERREUR').length + par('CASSÉ').length + R.echecs_de_page.length ? 1 : 0;
})();
