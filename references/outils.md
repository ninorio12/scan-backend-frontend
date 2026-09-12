# Les outils, un par un

Tous les scripts vivent dans `scripts/` et se lancent avec `node`. Tous n'écrivent que
dans `<repo>/.backend/` (qui porte son propre `.gitignore`), sauf mention contraire.
Tous respectent les mêmes codes de sortie : 0 rien à signaler · 1 des défauts · 2 le
travail n'a pas pu être fait (et le script dit pourquoi). Un code 2 ne se lit jamais
comme un 0.

## La chaîne

| Script | Ce qu'il fait | Il écrit |
|---|---|---|
| `couverture.mjs <repo> [--url …] [--export …] [--sans-base] [--paralleles <n>] [--json <f>]` | LA commande : enchaîne tout ce qui suit, un travailleur par écran, code 2 tant qu'un raccourci a été pris. `--paralleles` vaut 3 par défaut, la même borne que les agents. `--sans-base` assume de ne pas regarder la base, et ça se lit dans le bilan. `--rapide` existe et **la loi l'interdit** : il tombe à 40 boutons par écran au lieu de 400 | `couverture.json` |
| `reconnaitre.mjs <repo> [--url …]` | comprend le projet : stack, pages, modules, schéma, dev/prod, et si l'application qui répond est bien CE projet (ou un écran de connexion, ou autre chose) | `reconnaissance.json` |
| `scan.mjs <repo> [--full]` | le code : le scanner désigne, l'apparieur juge sur sept attributs, le rapport classe | `dialogue.json` |
| `lexical.mjs <repo>` | un concept métier, une source, un propriétaire ; lit `.backend/lexique.json` | `lexical.json` |
| `fausses-donnees.mjs <repo>` | ce que les fichiers d'injection ont semé, et ce qui est affiché en dur | `fausses.json` |
| `nettoyer-base.mjs <repo> [--liste] [--export <zip\|dossier>]` | les mêmes valeurs cherchées DANS la base (export Convex vers le dossier temporaire, jamais dans le dépôt) ; ne supprime jamais | `fausses-en-base.json` |
| `liens.mjs <url>` | suit tous les liens internes, nomme les morts et les pages vides | `liens.json` |
| `clics.mjs <url>` | appuie sur tous les boutons d'un écran (sauf ce qui écrit, compté nommément) : ERREUR / CASSÉ / MORT | `clics_<page>.json` |
| `apparence.mjs <url>` | invariants de mise en page en 1440 et 390 px, sans image de référence | `apparence_<page>.json` |
| `decisions.mjs <repo> [--verifier]` | prépare les questions de source de vérité pour l'humain ; `--verifier` contrôle le code contre les réponses | `questions.json`, `decisions.json` |
| `bilan.mjs <repo>` | le verdict, sur l'échelle unique : trompe / cassé / dette / non regardé | `BILAN.md` |

### Les trois cas où `reconnaitre` arrête le côté écran

Il les nomme lui-même. Aucun ne se contourne en cliquant quand même : le côté écran
deviendrait faux, et le rapport dirait « rien à signaler ».

| Ce qu'il dit | La parade |
|---|---|
| l'application ne répond pas | la lancer avec la commande de dev du projet, sur un port libre, puis `--url` |
| une application répond mais rien ne prouve que c'est ce projet | **ne jamais cliquer dedans** : lancer le bon projet, puis `--url` sur son port |
| écran de connexion ou redirection d'authentification | renseigner les clés dans `.env.local`, ou enregistrer une session Playwright et la passer aux scripts d'écran |

Une application n'est confirmée que si ce qu'elle sert porte la marque du projet (titre,
chaîne déclarée dans le dépôt). Et si le déploiement est de production, on ne clique rien
et on le dit : l'incident qui a produit cette règle est dans `histoire-des-mesures.md`.

### Le format de `--export`, pour une base qui n'est pas Convex

Convex sait s'exporter tout seul. Ailleurs, `nettoyer-base.mjs` s'arrête sur « base non
inspectée » (jamais « rien à signaler ») et attend un export au **format d'export Convex**,
qui n'a rien de propriétaire : un dossier, **un sous-dossier par table**, chacun contenant
un `documents.jsonl` d'un document JSON par ligne.

```
export-ma-base/
  contacts/documents.jsonl      {"_id":"1","nom":"Sophie Martin","email":"..."}
  factures/documents.jsonl      {"_id":"1","montant":4200,"statut":"payée"}
```

Un fichier plat `<table>.jsonl` par table est accepté aussi, comme un `.zip` qui contient
la même arborescence. Les tables dont le nom commence par `_` sont ignorées (tables
système). Le fabriquer depuis n'importe quelle base tient en une boucle en lecture seule : une
requête `SELECT *` par table, une ligne `JSON.stringify` par enregistrement. Le skill ne
lit que ces fichiers et ne se connecte jamais à la base lui-même. Puis :

```bash
node scripts/nettoyer-base.mjs <repo> --export /chemin/vers/export-ma-base
node scripts/couverture.mjs   <repo> --url http://localhost:3000 --export /chemin/vers/export-ma-base
```

La commande principale le transmet tel quel : pas besoin de rejouer l'étape à la main.

Tant que l'export n'est pas fourni, la ligne « base non inspectée » reste dans « non
regardé » du bilan, et le niveau reste INCONNU : c'est voulu, pas une panne.

## Le moteur, sous la chaîne

| Script | Ce qu'il fait |
|---|---|
| `audit-backend.mjs <repo> [--full] [--json] [--only=A,B] [--list-stacks]` | le scanner : charge les adaptateurs de `scripts/adapters/` (Convex, Next.js, SQL, tRPC/Express) et applique les règles des `rules-*.mjs`. Une stack inconnue se couvre en un fichier : `ajouter-une-stack.md` |
| `dialogue.mjs <repo>` | le dialogue scanner → apparieur, endroit par endroit ; c'est lui que `scan.mjs` appelle |
| `apparier.mjs` | (module) l'apparieur : les sept attributs d'accord, la liste négative mesurée |
| `extraire.mjs` | (module) l'extraction AST avec le compilateur TypeScript du projet audité (sinon celui du skill) |
| `lexique.mjs` | (module) jetons, normalisation, synonymes ; charge le lexique métier du projet |
| `gardes.mjs` | (module) reconnaît une garde par le flux, pas par son nom |
| `rules-surfaces.mjs`, `rules-auth.mjs`, `rules-coherence.mjs`, `rules-contrats.mjs`, `rules-historique.mjs`, `rules-rayon.mjs` | les règles, par axe (écrans, authentification, cohérence, contrats d'appel, incidents déjà payés, rayon d'action) |
| `navigateur.mjs` | (module) trouve Playwright : dans le projet audité, sinon dans le skill, sinon en global |
| `dossier-backend.mjs` | (module) le seul endroit où le skill écrit dans un dépôt : `.backend/` avec son `.gitignore` |

## Les outils de preuve, à la main

| Script | Ce qu'il fait |
|---|---|
| `flux.mjs <repo> [--divergences]` | l'analyse de flux par AST : chaque affichage et d'où il vient (relié, en dur, via props, calcul local, non tracé) ; `--divergences` : la même donnée affichée depuis deux origines |
| `inventaire.mjs <repo> [--non-prouves]` | tout le produit élément par élément, en trois colonnes : prouvé, non relié, non prouvé |
| `coupure.mjs <url> --repo=<repo> [--routes=/a,/b]` | la preuve par coupure : on coupe la source, ce qui reste affiché n'en venait pas (Playwright, aucune écriture) |
| `temoins.mjs generer \| verifier <page.html>` | la preuve par témoin (`preuve-par-temoin.md`) : des valeurs reconnaissables écrites en base, puis relevées à l'écran. Exige une base de développement |
| `test-detecteurs.mjs [-v]` | vérifie que chaque détecteur attrape son défaut dans `fixtures/repo-piege/` |

## La réparation

`reparation/PROTOCOLE.md` : `empreintes.mjs` (identité stable des défauts), `frontiere.mjs`
(mécanique, agent ou humain, règle par règle), `boucle.mjs` (lots à worktree, bail, juge),
`codemods/` (corrections déterministes, à blanc d'abord), `invariants.mjs`,
`diff-garde.mjs` et `eprouver-garde.mjs` (le linter anti-triche et ses épreuves).

## Le banc de mesure du skill lui-même

`banc/mesure/` mesure LE SKILL, pas le projet audité : rappel et justesse avec intervalle
de confiance, sur le projet figé `banc/fige/` (vérité terrain écrite à la lecture, avant
toute exécution) et sur un banc génératif (mutations tirées d'un dépôt à toi, déclaré dans
`banc/mesure/sources.json`, jamais un dépôt client).

    node banc/mesure/mesurer.mjs --fige      # les deux chiffres
    node banc/mesure/cliquet.mjs --verifier  # a-t-on empiré ?
    node banc/mesure/enrichir.mjs …          # un défaut du terrain entre au banc

## Les modèles

`modeles/regles/` : des règles Claude Code à portée de chemin (`.claude/rules/`), à copier
dans un projet pour que la règle sur les écrans se charge quand on ouvre un `.tsx`.
`references/bloc-claude-md.md` : le bloc de six règles à coller dans le CLAUDE.md du
projet. `references/lexique-metier-exemple.json` : le lexique métier à copier dans
`<repo>/.backend/lexique.json`.
