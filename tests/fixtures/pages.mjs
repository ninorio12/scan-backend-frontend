/**
 * pages.mjs : l'application de test, servie par node:http, sans réseau.
 *
 * Chaque page reproduit un cas que le skill a déjà mal jugé ou doit savoir juger.
 * Tout est en dur ici pour que les tests prouvent le comportement des scripts
 * navigateur sans dépendre d'un projet client qui tourne.
 *
 *   /              25 éléments cliquables : 3 morts, 2 qui affichent une erreur,
 *                  1 « Enregistrer », 1 bouton dans un <form>, 1 type=submit, 1 bouton
 *                  qui replie une section de 13 boutons (la mutation du DOM qui a
 *                  produit « le bug des 16 »)
 *   /apparence     un texte qui déborde, un contraste illisible, un SVG de 300×200
 *   /liens         des liens vers /autre (ok), /vide (vide), /inexistant (404)
 *   /connexion     une page de connexion (formulaire, « Sign in », lien clerk.accounts.dev)
 *   /api/brut      du JSON brut en 400
 *   /enfant-lien   <a href="/ailleurs"><button>Voir</button></a> + un bouton vraiment mort
 *   POST /ecriture toute écriture reçue est enregistrée : un test qui la voit a la preuve
 *                  qu'un script a cliqué ce qu'il ne devait pas
 *   tout le reste  404, corps commençant par « 404 »
 */
import http from 'node:http';

const page = (titre, corps, style = '') => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>${titre}</title>
<style>body{font-family:sans-serif;margin:24px;background:#fff;color:#111}button{margin:4px}${style}</style>
</head><body>${corps}</body></html>`;

const SECTION_B = ['Trier par prix', 'Trier par date', 'Trier par ville', 'Afficher les anciens',
  'Afficher les vendus', 'Page suivante', 'Page précédente', 'Colonne référence', 'Colonne surface',
  'Colonne prix', 'Colonne statut', 'Aperçu', 'Détails'];

export const BOUTONS = {
  morts: ['Mort 1', 'Mort 2', 'Mort 3'],
  erreurs: ['Charger les données', 'Actualiser la liste'],
  ecrivent: ['Enregistrer', 'Ajouter une ligne', 'Confirmer'],
  navigation: ['Ouvrir la page suivante'],
  onglets: ['Onglet Biens', 'Onglet Visites'],
  replie: 'Réduire le panneau',
  sectionB: SECTION_B,
  total: 25,
};

const PAGE_BOUTONS = page('Boutons', `
<h1>Tableau de bord de test</h1>
<p>Vingt-cinq éléments cliquables. Trois ne font rien, deux affichent une erreur, trois écrivent.</p>
<nav>
  <a href="/autre">Ouvrir la page suivante</a>
  <button id="onglet-biens">Onglet Biens</button>
  <button id="onglet-visites">Onglet Visites</button>
</nav>
<div id="panneau">Contenu de l'onglet par défaut, assez long pour que la page ait un corps de texte raisonnable.</div>
<section>
  <button>Mort 1</button>
  <button>Mort 2</button>
  <button>Mort 3</button>
  <button id="charger">Charger les données</button>
  <button id="actualiser">Actualiser la liste</button>
  <button id="enregistrer">Enregistrer</button>
</section>
<form id="forme-a" method="post" action="/ecriture?label=forme-a">
  <label>Ligne <input name="ligne" value="x"></label>
  <button type="button" id="ajouter">Ajouter une ligne</button>
</form>
<form id="forme-b" method="post" action="/ecriture?label=Confirmer">
  <label>Nom <input name="nom" value="y"></label>
  <button type="submit">Confirmer</button>
</form>
<button id="replier">Réduire le panneau</button>
<section id="section-b">
  ${SECTION_B.map((l) => `<button class="b">${l}</button>`).join('\n  ')}
</section>
<div id="alertes"></div>
<div id="journal"></div>
<script>
  const q = (s) => document.querySelector(s);
  const journal = (t) => { const d = document.createElement('div'); d.textContent = 'Action : ' + t + ' (' + Date.now() + ')'; q('#journal').appendChild(d); };
  q('#onglet-biens').onclick = () => { q('#panneau').textContent = 'Liste des biens : 12 biens, 3 en vente, 9 loués. Contenu différent du panneau précédent.'; };
  q('#onglet-visites').onclick = () => { q('#panneau').textContent = 'Agenda des visites : 4 visites cette semaine, 2 confirmées.'; };
  q('#charger').onclick = () => { const d = document.createElement('div'); d.setAttribute('role', 'alert'); d.textContent = 'Erreur : impossible de charger les données'; q('#alertes').appendChild(d); };
  q('#actualiser').onclick = () => { const d = document.createElement('p'); d.textContent = 'Une erreur est survenue pendant l\\'actualisation.'; q('#alertes').appendChild(d); };
  q('#enregistrer').onclick = () => { fetch('/ecriture?label=Enregistrer', { method: 'POST' }); journal('enregistrer'); };
  q('#ajouter').onclick = () => { fetch('/ecriture?label=Ajouter%20une%20ligne', { method: 'POST' }); journal('ajouter'); };
  q('#replier').onclick = () => { const s = q('#section-b'); s.hidden = !s.hidden; journal('replier'); };
  for (const b of document.querySelectorAll('#section-b .b')) b.onclick = () => journal(b.textContent);
</script>`);

const PAGE_APPARENCE = page('Apparence', `
<h1>Écran de test d'apparence</h1>
<p>Cette page contient trois défauts visuels connus et un SVG qui faisait planter le contrôle.
Le reste du texte est là pour donner à l'écran la taille d'un écran normal : un titre, un paragraphe,
une courbe, un lien. Rien de tout cela ne doit être signalé.</p>
<p id="deborde" style="width:120px;white-space:nowrap;border:1px solid #ccc">Ce texte est beaucoup trop long pour tenir dans sa boîte de cent vingt pixels</p>
<p id="invisible" style="color:rgb(246,246,246);background:#fff">Texte quasi invisible sur fond blanc</p>
<svg width="300" height="200" viewBox="0 0 300 200" role="img" aria-label="courbe des ventes">
  <rect x="0" y="0" width="300" height="200" fill="#f4f4f4"/>
  <polyline points="10,150 60,120 110,140 160,80 210,90 260,40" fill="none" stroke="#333" stroke-width="2"/>
</svg>
<p>Un paragraphe parfaitement lisible, pour que la page ne soit pas vide.</p>
<a href="/inexistant">Un lien vers une page qui n'existe pas</a>`);

const PAGE_LIENS = page('Liens', `
<h1>Page de liens</h1>
<p>Quatre liens internes, un externe. L'un mène à une page absente, un autre à une page vide.
Le reste de ce paragraphe existe pour que la page ait un corps de texte normal, comme n'importe quel
écran d'application : un titre, une phrase d'explication, une liste de raccourcis vers d'autres écrans.</p>
<ul>
  <li><a href="/autre">Une page qui existe</a></li>
  <li><a href="/vide">Une page vide</a></li>
  <li><a href="/inexistant">Une page absente</a></li>
  <li><a href="/apparence">L'écran d'apparence</a></li>
  <li><a href="https://exemple.invalid/externe">Un lien externe, jamais suivi</a></li>
</ul>`);

const PAGE_AUTRE = page('Autre', `
<h1>La page suivante</h1>
<p>Une page ordinaire, avec assez de texte pour ne pas passer pour vide. Elle sert de cible aux liens et aux boutons de navigation.
On y trouve ce qu'on trouve sur un écran secondaire d'application : un titre, un paragraphe de contexte, une fiche
avec quelques valeurs, et un lien de retour vers l'accueil.</p>
<dl><dt>Référence</dt><dd>B-2041</dd><dt>Ville</dt><dd>Lausanne</dd><dt>Statut</dt><dd>En vente</dd></dl>
<a href="/">Retour</a>`);

const PAGE_VIDE = page('Vide', `<div></div>`);

const PAGE_CONNEXION = page('Sign in', `
<div class="cl-card">
  <h1>Sign in</h1>
  <p>Welcome back! Please sign in to continue</p>
  <form>
    <label>Email address <input type="email" name="identifier"></label>
    <label>Password <input type="password" name="password"></label>
    <button type="submit">Sign in</button>
  </form>
  <p>Don't have an account? <a href="https://accounts.clerk.accounts.dev/sign-up">Sign up</a></p>
  <p>Secured by <a href="https://clerk.com">Clerk</a></p>
</div>`);

const PAGE_ENFANT_LIEN = page('Enfant de lien', `
<h1>Cartes</h1>
<p>Une carte dont le bouton « Voir » est un enfant du lien, et un bouton seul qui ne fait rien.
C'est le motif courant d'une liste de fiches : la carte entière est un lien, et le bouton d'action
qu'elle contient hérite de la navigation de son parent. Le tester à part, c'est le tester deux fois.</p>
<div class="carte">
  <span>Appartement 3 pièces, Lausanne</span>
  <a href="/ailleurs"><button>Voir</button></a>
</div>
<button id="seul">Sans effet</button>`);

const PAGE_AILLEURS = page('Ailleurs', `
<h1>Fiche du bien</h1>
<p>Appartement 3 pièces à Lausanne, 78 m², 3e étage, balcon. La page vers laquelle mène « Voir ».
Description : lumineux, cuisine ouverte, cave et place de parc. Disponible immédiatement. Prix sur demande,
visites sur rendez-vous du lundi au samedi.</p>`);

const ROUTES = {
  '/': PAGE_BOUTONS,
  '/apparence': PAGE_APPARENCE,
  '/liens': PAGE_LIENS,
  '/autre': PAGE_AUTRE,
  '/vide': PAGE_VIDE,
  '/connexion': PAGE_CONNEXION,
  '/enfant-lien': PAGE_ENFANT_LIEN,
  '/ailleurs': PAGE_AILLEURS,
};

export function demarrerServeur() {
  const ecritures = [];
  const serveur = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    if (u.pathname === '/ecriture') {
      ecritures.push({ methode: req.method, label: u.searchParams.get('label') });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('Écrit', '<p>Écriture reçue. Cette page ne devrait jamais être atteinte par un test.</p>'));
      return;
    }
    if (u.pathname === '/api/brut') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request', code: 400 }));
      return;
    }
    const html = ROUTES[u.pathname];
    if (html) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('404', '<h1>404</h1><p>Cette page est introuvable.</p>'));
  });
  return new Promise((resolve) => {
    serveur.listen(0, '127.0.0.1', () => {
      const { port } = serveur.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        ecritures,
        fermer: () => new Promise((r) => serveur.close(() => r())),
      });
    });
  });
}
