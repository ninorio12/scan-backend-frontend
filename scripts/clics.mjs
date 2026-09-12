#!/usr/bin/env node
/**
 * clics.mjs : on appuie sur tous les boutons, et on regarde ce qui se passe.
 *
 * Le scan lit le code. Ici on ouvre l'application et on clique. C'est l'étape qui
 * rapporte le plus : sur un projet client, le 11/09/2026, cinq agents ont sorti une soixantaine de
 * défauts réels en deux heures, dont aucun n'était visible dans le code.
 *
 *     node clics.mjs http://localhost:3000/modules/parametres
 *     node clics.mjs <url> --json f --max 400 --sans-contre-epreuve
 *
 * CINQ VERDICTS, du plus certain au plus douteux :
 *
 *   ERREUR      le clic fait apparaître un message d'erreur À L'ÉCRAN, ou une requête
 *               en échec. Aucun jugement à porter : le client le voit, c'est un bug.
 *   SILENCIEUX  le JavaScript plante mais rien ne casse à l'écran. À corriger, pas
 *               urgent. La distinction compte : sans elle, une carte qui plante au
 *               montage se retrouve au même rang qu'un « Le test n'a pas abouti ».
 *   MORT        rien ne bouge : ni requête, ni changement de page, ni message, ni
 *               erreur. ⚠️ Un bouton peut sembler mort parce que l'écran est DÉJÀ dans
 *               l'état qu'il produit (le bouton « Aujourd'hui » quand on est déjà
 *               aujourd'hui). D'où la contre-épreuve plus bas : on ne conclut jamais à
 *               la mort sans avoir changé l'état avant.
 *   CASSÉ       l'écran perd l'essentiel de son contenu, se vide, ou un bloc devient
 *               blanc. C'est le « j'appuie et j'ai une vue bizarre ».
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

if (!URL_CIBLE || !/^https?:\/\//.test(URL_CIBLE)) {
  console.error('usage: node clics.mjs <url> [--json f] [--max 400] [--sans-contre-epreuve]');
  process.exit(2);
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
async function attendreRendu(page, max = 12000) {
  await page.waitForLoadState('networkidle', { timeout: max }).catch(() => {});
  const t0 = Date.now();
  let prec = -1;
  while (Date.now() - t0 < max) {
    const n = await page.evaluate(() => window.__recenser ? window.__recenser().filter((x) => x.visible).length : -1)
      .catch(() => -1);
    if (n >= 0 && n === prec) return n;
    prec = n;
    await dormir(350);
  }
  return prec;
}

const recenser = (page) => page.evaluate(() => window.__recenser().filter((x) => x.visible)
  .map(({ el, ...r }) => r));

async function trouver(page, cle) {
  const h = await page.evaluateHandle((c) => (window.__recenser().find((x) => x.cle === c) || {}).el || null, cle)
    .catch(() => null);
  return h ? h.asElement() : null;
}

/* Pourquoi un clic n'a pas eu lieu, en un mot que le lecteur comprend. */
function raisonDe(err) {
  const s = String(err && err.message || err);
  if (/intercepts pointer events/i.test(s)) return 'recouvert par un autre élément';
  if (/not visible|outside of the viewport|zero size|hidden/i.test(s)) return 'hors de portée (invisible ou hors écran)';
  if (/not attached|detached|Target closed/i.test(s)) return 'disparu pendant le clic';
  return `délai de ${DELAI_CLIC / 1000} s dépassé`;
}

async function chargerPage(page) {
  const rep = await page.goto(URL_CIBLE, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => null);
  await attendreRendu(page);
  return rep;
}

(async () => {
  const T0 = Date.now();
  const nav = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(RECENSEUR);

  const reseau = [];
  const console_ = [];
  page.on('response', (r) => { if (r.status() >= 400) reseau.push({ s: r.status(), u: r.url() }); });
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

  const R = { url: URL_CIBLE, recenses: tous.length, cliques: 0, ecartes, non_cliques: nonCliques, inclus, verdicts: [] };

  for (const b of liste) {
    // On repart toujours de la même page : un clic précédent a pu naviguer ailleurs.
    if (page.url() !== base.url) await chargerPage(page);

    /* Re-résolution PAR CLÉ. Si la clé ne répond plus (un panneau ouvert a changé
       l'écran), on recharge une fois et on recommence. Après, on compte. */
    let el = await trouver(page, b.cle);
    if (!el) { await chargerPage(page); el = await trouver(page, b.cle); }
    if (!el) { nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison: 'disparu (introuvable après rechargement)' }); continue; }

    const avantR = reseau.length, avantC = console_.length;
    const avant = await etat(page);

    let clique = false, raison = null;
    try { await el.click({ timeout: DELAI_CLIC }); clique = true; }
    catch (e1) {
      raison = raisonDe(e1);
      // Deuxième chance sur page fraîche : ce qui recouvrait n'est plus là.
      await chargerPage(page);
      const el2 = await trouver(page, b.cle);
      if (el2) { try { await el2.click({ timeout: DELAI_CLIC }); clique = true; raison = null; } catch (e2) { raison = raisonDe(e2); } }
      else raison = 'disparu (introuvable après rechargement)';
    }
    if (!clique) { nonCliques.push({ libelle: b.libelle || '(sans libellé)', raison }); continue; }
    R.cliques++;
    await dormir(1000);

    const apres = await etat(page).catch(() => avant);
    const nouvellesAlertes = [...apres.alertes, ...apres.classes]
      .filter((t) => !avant.alertes.includes(t) && !avant.classes.includes(t));
    const echecs = reseau.slice(avantR);
    const erreursJS = console_.slice(avantC);

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

    const bouge = apres.url !== avant.url || apres.taille !== avant.taille || nouvellesAlertes.length > 0;
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
    else if (echecs.length) { verdict = 'ERREUR'; pourquoi = `${echecs[0].s} sur ${echecs[0].u.replace(/^https?:\/\/[^/]+/, '')}`; }
    else if (erreursJS.length && vide) { verdict = 'ERREUR'; pourquoi = erreursJS[0]; }
    else if (erreursJS.length) { verdict = 'SILENCIEUX'; pourquoi = erreursJS[0]; }
    else if (vide) { verdict = 'CASSÉ'; pourquoi = `l'écran passe de ${avant.taille} à ${apres.taille} caractères`; }
    else if (!bouge) { verdict = 'MORT'; pourquoi = 'aucune requête, aucun changement, aucun message'; }

    R.verdicts.push({ libelle: b.libelle || '(sans libellé)', verdict, pourquoi, href: b.href, cle: b.cle });

    // Un panneau ou un menu ouvert recouvrirait le bouton suivant : on le referme.
    if (apres.url === avant.url) await page.keyboard.press('Escape').catch(() => {});
  }

  /* CONTRE-ÉPREUVE des « morts ». Un bouton paraît inerte quand l'écran est DÉJÀ dans
     l'état qu'il produit : « Aujourd'hui » quand on est déjà aujourd'hui. On sort
     l'écran de cet état, puis on re-clique. Leçon payée quatre fois sur le même bouton.

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
      await chargerPage(page);

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
        try { await h.click({ timeout: 1500 }); } catch { continue; }
        await dormir(600);
        const apres = await etat(page).catch(() => avant);
        if (apres.url !== avant.url) { await chargerPage(page); continue; }   // ce clic nous sortait de l'écran
        if (apres.taille !== avant.taille) { deplace = true; break; }
      }
      /* Sans déplacement, la contre-épreuve ne prouve rien : on le dit au lieu de
         confirmer la mort sur la foi d'un écran resté au même endroit. */
      if (!deplace) {
        m.pourquoi += ' (contre-épreuve sans effet : aucun voisin n\'a déplacé l\'écran)';
        continue;
      }

      const avant = await etat(page);
      const el = await trouver(page, m.cle);
      if (!el) { m.pourquoi += ' (disparu pendant la contre-épreuve)'; continue; }
      try { await el.click({ timeout: DELAI_CLIC }); } catch { continue; }
      await dormir(800);
      const apres = await etat(page).catch(() => avant);
      if (apres.url !== avant.url || apres.taille !== avant.taille) {
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

  const par = (v) => R.verdicts.filter((x) => x.verdict === v);
  entete();
  console.log(`  recensés ${R.recenses} · cliqués ${R.cliques} · écartés ${ecartes.length} · non cliqués ${nonCliques.length}`
    + `${inclus.length ? ` · inclus dans un parent ${inclus.length}` : ''} · ${R.duree_s} s`);
  for (const v of ['ERREUR', 'CASSÉ', 'MORT', 'SILENCIEUX']) {
    const l = par(v);
    if (!l.length) continue;
    console.log(`\n  ${v} (${l.length})${v === 'SILENCIEUX' ? '  (le JavaScript plante, le client ne voit rien)' : ''}`);
    for (const x of l) console.log(`    « ${x.libelle} »  ${x.pourquoi}`);
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
  process.exitCode = par('ERREUR').length + par('CASSÉ').length ? 1 : 0;
})();
