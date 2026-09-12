# scan-backend-frontend

Un skill Claude Code qui audite un SaaS de bout en bout : le code (ce qui aurait dû être
d'accord entre un écran et sa donnée et ne l'est pas, expliqué en français), les écrans
(tous les boutons de tous les modules, dans un vrai navigateur, sans jamais cliquer ce
qui écrit), la base (les fausses données de maquette restées à côté des vraies), et un
seul bilan sur une seule échelle : trompe le client / cassé / dette / non regardé. Il
refuse de conclure sur ce qu'il n'a pas vu : le travail incomplet sort en code 2.

## Prérequis

- Node 20 ou plus, `npm`, `curl`.
- `unzip` ou `python3` (pour lire un export de base).
- Le CLI Convex (`npx convex`, fourni par le projet audité) si la base est Convex ;
  pour une autre base, fournir un export à `nettoyer-base.mjs --export`.
- Le projet audité avec ses `node_modules` installés : le skill lit le code avec le
  compilateur TypeScript du projet ; à défaut il utilise le sien.

## Installation

Le skill s'installe **où on veut**. Rien dans le code ne dépend de l'emplacement.

```bash
git clone https://github.com/ninorio12/scan-backend-frontend.git scan-backend-frontend
cd scan-backend-frontend
npm install
npx playwright install chromium
```

> **Toutes les commandes de ce README et de `SKILL.md` se lancent depuis la racine du
> skill** (le dossier créé par le `git clone`, celui qui contient `package.json`) ; seul
> `<repo>`, le chemin du projet audité, est absolu. Si Claude Code doit voir le skill,
> le dossier va dans `~/.claude/skills/` : c'est une convention de Claude Code, pas une
> exigence du skill, et les commandes ci-dessous ne changent pas pour autant.

## Vérifier que l'installation est bonne

Trois commandes, depuis la racine du skill. Les trois doivent répondre avant d'auditer
quoi que ce soit : `npx playwright install chromium` rend souvent une sortie vide en une
seconde (le binaire était déjà en cache), ce qui ne prouve rien.

```bash
# 1 · Node : au moins la version 20
node -v
#    attendu :  v20.20.2      (ou plus haut ; v18 ou moins ne marchera pas)

# 2 · Le navigateur : on le lance vraiment, il dit sa version ou il échoue
node --input-type=module -e "import { chargerNavigateur } from './scripts/navigateur.mjs'; const n = await chargerNavigateur(process.cwd()).launch(); console.log('navigateur OK :', n.version()); await n.close();"
#    attendu :  navigateur OK : 153.0.8010.12      (le numéro varie, « OK » non)

# 3 · TypeScript : le skill lit le code avec, à défaut de celui du projet
node -e "console.log('typescript OK :', require('typescript').version)"
#    attendu :  typescript OK : 5.9.3
```

Et le contrôle complet, qui doit être **entièrement vert** :

```bash
npm test
#    attendu :  # pass 68   # fail 0
```

Si la commande 2 échoue :

| Le message | Ce qu'il faut faire |
|---|---|
| `Playwright introuvable` | `npm install` n'a pas tourné, ou pas dans ce dossier. Le relancer à la racine du skill. |
| `Executable doesn't exist at …` | Le paquet est là, pas le navigateur : `npx playwright install chromium`. |
| `Host system is missing dependencies` | Les bibliothèques système manquent : `npx playwright install --with-deps chromium` (demande les droits root), ou sur Debian/Ubuntu `sudo npx playwright install-deps chromium`. |
| ça pend sans rien dire | Machine sans affichage : c'est normal, le skill lance toujours le navigateur en mode invisible. Si ça persiste, `DEBUG=pw:browser` devant la commande dit où ça bloque. |

## La première commande

Le projet audité doit **tourner**, lancé par sa propre commande de développement (souvent
`npm run dev`), sur un port libre. Ensuite, depuis la racine du skill :

```bash
node scripts/reconnaitre.mjs <repo>
node scripts/couverture.mjs <repo> --url http://localhost:3000
```

La première dit ce que le skill a compris du projet, et surtout ce qu'il n'a pas compris
(application éteinte, application qui n'est pas ce projet, écran de connexion). Elle
cherche l'application toute seule sur les ports courants et la rattache au projet par son
titre : `--url` sert à lever l'ambiguïté, ou à désigner un port inhabituel.

La seconde enchaîne toute la chaîne et écrit le verdict dans `<repo>/.backend/BILAN.md`.
Compter de dix minutes à une heure selon la taille du produit : elle affiche son
avancement écran par écran et ne pose aucune question.

Codes de sortie, pour tous les scripts : 0 rien à signaler · 1 des défauts · 2 le travail
n'a pas pu être fait, et le script dit pourquoi. Un code 2 ne se lit jamais comme un 0.

## Ce que le skill fait de vos données

1. Il **écrit uniquement dans `<repo>/.backend/`**, un dossier qui porte son propre
   `.gitignore` contenant `*` : aucun fichier de votre projet n'est touché. Un export de
   base va dans le dossier temporaire du système et est supprimé après lecture.
2. Il **ne clique jamais sur ce qui écrit ou détruit** : `type=submit`, tout bouton dans
   un `<form>`, les verbes d'écriture, écartés nommément et comptés comme tels.
3. Il **n'envoie rien nulle part** : aucune télémétrie, aucun service tiers, aucun compte.
   Les seuls appels réseau vont à votre application (celle de `--url`, en local) et, si la
   base est Convex, à **votre** backend via **votre** CLI (`npx convex export`, lancé par
   le projet audité). Rien ne sort de chez vous.

Ce n'est pas une promesse, c'est mesuré. Sur l'épreuve d'installation (un Next.js + trois
bases SQLite), après **1 328 clics** du passage mécanique et des agents, les trois bases
avaient la **même empreinte MD5** qu'avant et la même date de modification, antérieure au
premier clic ; `git status --porcelain` du projet était vide. Le contrôle est reproductible
en trois lignes :

```bash
md5sum <repo>/data/*.db > /tmp/avant.md5      # adapter au chemin de vos bases
node scripts/couverture.mjs <repo> --url http://localhost:3000
md5sum -c /tmp/avant.md5 && git -C <repo> status --porcelain
```

Une réserve connue, et elle est dite : `couverture.mjs` n'a pas d'aide en ligne. Lui passer
`--help` le fait prendre ce mot pour un chemin de dépôt, et il crée un dossier `./--help/`
dans le répertoire courant. Les autres scripts refusent correctement (« Dépôt introuvable »,
code 2). Donnez-lui un chemin de dépôt réel.

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

## Les limites, honnêtement

Ce que le skill **ne voit pas** :

- **Les bases qui ne sont pas Convex, sans export fourni.** Convex a un export
  automatique ; ailleurs, `nettoyer-base.mjs` s'arrête sur « base non inspectée »
  (jamais « rien à signaler ») et attend `--export <zip|dossier>` au format d'export
  Convex : un sous-dossier par table, contenant un `documents.jsonl` d'un document JSON
  par ligne. Tant que cet export n'est pas fourni, la ligne « base non inspectée » reste
  dans « non regardé », donc le bilan reste au niveau INCONNU.
- **Les défauts qui demandent de comprendre une intention.** Un écran qui dessine cent
  nœuds d'un savoir vide, un « MTD $0 » affiché alors qu'aucune source n'est joignable,
  un total qui diffère d'un écran à l'autre pour la même notion : aucune règle mécanique
  ne les attrape. C'est le travail des agents de l'étape 3 (`references/parcours-reel.md`),
  et sur l'épreuve d'installation ce sont eux qui ont trouvé les dix défauts les plus
  graves du produit.
- **La justesse d'une donnée.** Le skill prouve que la chaîne est reliée, pas que le
  chiffre est bon.
- Il ne fait **ni audit de sécurité complet ni de scalabilité**.

Et son **rappel** : la part des défauts connus que l'analyse statique seule signale. Il ne
se cite pas de mémoire, il se remesure, parce qu'il bouge à chaque règle ajoutée :

```bash
npm run mesure        # = node banc/mesure/mesurer.mjs --fige
```

La commande sort trois niveaux de rappel (bon fichier / bon symbole / **bonne famille**,
le seul qui compte), la justesse, l'intervalle de confiance de chacun, et la liste des
familles de défauts où elle ne voit rien. Le banc figé est livré avec le skill et tourne
en quelques secondes, sans rien configurer. Le banc génératif, lui, mute des dépôts à
vous, déclarés dans `banc/mesure/sources.json` (modèle : `sources.exemple.json`) ; sans ce
fichier il rend « aucune source » et le banc figé tourne quand même. Aucun dépôt client
n'est livré avec le skill.

Le passage mécanique n'est pas non plus infaillible dans l'autre sens : sur un serveur de
développement lent, un lien qui met plus longtemps à répondre que la fenêtre d'attente est
déclaré mort à tort. Un verdict « bouton mort » se recontrôle avant d'être relayé.

## Licence

MIT.
