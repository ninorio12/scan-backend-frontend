# scan-backend-frontend

Un skill Claude Code qui audite un SaaS de bout en bout : le code (ce qui aurait dû être
d'accord entre un écran et sa donnée et ne l'est pas, expliqué en français), les écrans
(tous les boutons de tous les modules, dans un vrai navigateur, sans jamais cliquer ce
qui écrit), la base (les fausses données de maquette restées à côté des vraies), et un
seul bilan sur une seule échelle : trompe le client / cassé / dette / non regardé. Il
refuse de conclure sur ce qu'il n'a pas vu : le travail incomplet sort en code 2.

## Prérequis

- Node 20 ou plus, `npm`, `curl`.
- Chromium pour Playwright : `npx playwright install chromium` (une fois).
- `unzip` ou `python3` (pour lire un export de base).
- Le CLI Convex (`npx convex`, fourni par le projet audité) si la base est Convex ;
  pour une autre base, fournir un export à `nettoyer-base.mjs --export`.
- Le projet audité avec ses `node_modules` installés : le skill lit le code avec le
  compilateur TypeScript du projet ; à défaut il utilise le sien.

## Installation

```bash
git clone <url-du-dépôt> ~/.claude/skills/scan-backend-frontend
cd ~/.claude/skills/scan-backend-frontend && npm install
npx playwright install chromium
```

## La première commande

```bash
node ~/.claude/skills/scan-backend-frontend/scripts/reconnaitre.mjs <repo>
node ~/.claude/skills/scan-backend-frontend/scripts/couverture.mjs <repo> --url http://localhost:3000
```

La première dit ce que le skill a compris du projet, et surtout ce qu'il n'a pas compris
(application éteinte, application qui n'est pas ce projet, écran de connexion). La seconde
enchaîne toute la chaîne et écrit le verdict dans `<repo>/.backend/BILAN.md`. Tout ce que
le skill écrit va dans `<repo>/.backend/`, qui contient son propre `.gitignore` ; un export
de base va dans le dossier temporaire du système et est supprimé après lecture.

Codes de sortie, pour tous les scripts : 0 rien à signaler · 1 des défauts · 2 le travail
n'a pas pu être fait, et le script dit pourquoi.

## Le lexique métier

Le vocabulaire du produit ne vit pas dans le skill. Copier
[`references/lexique-metier-exemple.json`](references/lexique-metier-exemple.json) dans
`<repo>/.backend/lexique.json` et l'adapter : chaque ligne dit « ce mot désigne ce
concept », et deux mots qui pointent le même concept doivent lire la même source.

## Dans Claude Code

Le skill se déclenche sur « audite ce SaaS », « scan backend », « qu'est-ce qui est
cassé », ou tout symptôme de câblage. La procédure que suit l'agent est `SKILL.md` ; le
raisonnement est dans `references/doctrine.md` ; chaque outil est décrit dans
`references/outils.md`.

## Mesurer le skill lui-même

```bash
npm run mesure            # rappel et justesse sur le projet figé banc/fige, avec intervalle
npm test                  # les tests (node --test tests/)
```

Le banc génératif prend ses mutations dans un dépôt à toi, déclaré dans
`banc/mesure/sources.json` (modèle : `sources.exemple.json`). Aucun dépôt client n'est
livré avec le skill.

## Ce que le skill ne fait pas

Il ne prouve pas qu'une donnée est juste, seulement que la chaîne est reliée. Il ne
supprime rien en base, ne modifie aucun fichier du projet audité, ne clique sur rien qui
écrit ou détruit. Il ne fait ni audit de sécurité complet ni de scalabilité, et son
analyse statique seule a un rappel qu'il faut mesurer, pas supposer : c'est le passage
dans l'application qui rapporte le plus.

## Licence

MIT.
