# Les outils, un par un

Tous les scripts vivent dans `scripts/` et se lancent avec `node`. Tous n'écrivent que
dans `<repo>/.backend/` (qui porte son propre `.gitignore`), sauf mention contraire.
Tous respectent les mêmes codes de sortie : 0 rien à signaler · 1 des défauts · 2 le
travail n'a pas pu être fait (et le script dit pourquoi). Un code 2 ne se lit jamais
comme un 0.

## La chaîne

| Script | Ce qu'il fait | Il écrit |
|---|---|---|
| `couverture.mjs <repo> [--url …]` | LA commande : enchaîne tout ce qui suit, un travailleur par écran, code 2 tant qu'un raccourci a été pris | `couverture.json` |
| `reconnaitre.mjs <repo> [--url …]` | comprend le projet : stack, pages, modules, schéma, dev/prod, et si l'application qui répond est bien CE projet (ou un écran de connexion, ou autre chose) | `reconnaissance.json` |
| `scan.mjs <repo> [--full]` | le code : le scanner désigne, l'apparieur juge sur sept attributs, le rapport classe | `dialogue.json` |
| `lexical.mjs <repo>` | un concept métier, une source, un propriétaire ; lit `.backend/lexique.json` | `lexical.json` |
| `fausses-donnees.mjs <repo>` | ce que les fichiers d'injection ont semé, et ce qui est affiché en dur | `fausses.json` |
| `nettoyer-base.mjs <repo> [--liste] [--export zip]` | les mêmes valeurs cherchées DANS la base (export Convex vers le dossier temporaire, jamais dans le dépôt) ; ne supprime jamais | `fausses-en-base.json` |
| `liens.mjs <url>` | suit tous les liens internes, nomme les morts et les pages vides | `liens.json` |
| `clics.mjs <url>` | appuie sur tous les boutons d'un écran (sauf ce qui écrit, compté nommément) : ERREUR / CASSÉ / MORT | `clics_<page>.json` |
| `apparence.mjs <url>` | invariants de mise en page en 1440 et 390 px, sans image de référence | `apparence_<page>.json` |
| `decisions.mjs <repo> [--verifier]` | prépare les questions de source de vérité pour l'humain ; `--verifier` contrôle le code contre les réponses | `questions.json`, `decisions.json` |
| `bilan.mjs <repo>` | le verdict, sur l'échelle unique : trompe / cassé / dette / non regardé | `BILAN.md` |

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
