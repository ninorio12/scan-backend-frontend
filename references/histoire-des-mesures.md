# L'histoire des mesures : ce qui a été chiffré, et ce qu'on en a tiré

Les projets sont anonymisés (A, B, C, D : des SaaS réels, Next.js + Convex, de 35 à
164 fichiers de backend). Les chiffres sont ceux du jour de la mesure ; ils ne sont pas
des valeurs courantes. La seule valeur courante du skill est celle que sort
`node banc/mesure/mesurer.mjs --fige` au moment où on la lance. Aucun chiffre de rappel
ne doit être recopié dans la doctrine : il vieillit, et trois copies finissent par se
contredire (vécu : trois valeurs différentes du même rappel dans trois fichiers).

## La mesure fondatrice : le code ne suffit pas

Sur le projet A (Data OS immobilier, 11/09/2026) : le scan du code trouvait une poignée
de défauts, et cinq agents lâchés dans l'application avec un navigateur en ont sorti une
soixantaine de réels en deux heures. Parmi eux : un volume de ventes faux de bout en bout,
5 793 documents inatteignables, un écran d'accueil qui se contredit lui-même sur le
chiffre d'affaires, et une fiche client qui en ouvre une autre, avec ses coordonnées.
Cause racine n°1, qui expliquait une dizaine de constats dans quatre modules : des
données de démonstration semées dans la vraie base (81 noms, emails et téléphones dans
le fichier d'injection). C'est l'origine de `fausses-donnees.mjs`, de `nettoyer-base.mjs`,
et de l'étape « entrer dans la maison ».

Le même jour, une instance a annoncé un écran propre après avoir cliqué 16 boutons sur
214. C'est l'origine de la loi anti-paresse et de `couverture.mjs` (code 2 tant que le
travail est incomplet).

## La loi centrale, chiffrée

| Projet | Unités exposées | Rien ne les appelle | Portes sans garde |
|---|---|---|---|
| B | 625 | 203 | 412 |
| C | 1333 | 548 | 473 |
| A | 227 | 121 | 202 |

Ce ne sont pas des statistiques de style. C'est la mesure du symptôme exact : des liens
de connexion qui ne se font pas, des liens logiques qui se perdent entre les modules.

## Le moteur AST contre les expressions régulières

Sur le projet A, les expressions régulières trouvaient 4 champs en dur dans un
formulaire. L'analyse de flux par AST (`flux.mjs`) en trouve 11 et surtout la barre
latérale, où le nom et l'email du gérant étaient écrits en dur dans le JSX, plus un nom
inventé dans un troisième module. Aucune expression régulière ne voyait ces deux-là.
3 secondes pour 6 386 affichages sur le plus gros dépôt.

## L'inventaire

Projet A, 11/09/2026 : 679 éléments, 277 prouvés, 149 non reliés, 253 non prouvés.
Couverture 41 %. Aucun catalogue de motifs n'aurait donné ce dénominateur.

## La règle « le silence d'un juge n'est pas un acquittement »

Une version de l'apparieur qui avait le droit d'écarter ce qu'il jugeait sain est tombée
de 23 défauts retrouvés à 2 sur le banc. Depuis, il classe, il ne supprime pas.

## La garde reconnue par le flux, pas par un nom

B1 cherchait un nom de garde dans une liste anglaise. Sur un banc neutre : 16 faux
positifs sur 16, et aucun des 20 vrais défauts plantés. `gardes.mjs` repère ce qui
vérifie réellement (identité de session, signature, secret comparé) et propage aux
appelants par point fixe : 16 faux positifs → 0, le seul item restant étant le vrai trou.

## Le score sur 100, essayé et retiré

Une moyenne pondérée par axe donnait 89/100 au projet A avec 409 défauts bloquants,
parce que sept axes sur neuf étaient sains en proportion. Un plafond par « boss vivants »
a été ajouté, puis l'ensemble retiré : il faisait une deuxième échelle de gravité à côté
du bilan, et les deux se contredisaient (4 boss ici, 5 là). Il ne reste qu'une échelle,
celle de `bilan.mjs`.

## Le hook de fin de tour, essayé et retiré

Un `install-gate.sh` posait un hook `Stop`. Mesuré : 0 déclenchement sur 329 tours (le
tour se termine souvent sur un résultat d'outil), et il surveillait précisément les deux
axes à la justesse la plus faible. Retiré. Détail : `gates-qui-tiennent.md`.

## La reconnaissance de l'application vivante

Une première version de `reconnaitre.mjs` déclarait « vivante » n'importe quelle
application sur un port habituel. Sur une machine où un autre projet tournait sur :3000,
une instance vierge suivant la doctrine a failli cliquer dans l'application d'un autre
client, et sur un projet public sans clés d'authentification, les scripts d'écran ont
« testé » une page d'erreur JSON derrière une redirection 307 et rendu OK. Depuis, une
application n'est confirmée que si ce qu'elle sert porte la marque du projet, et une
redirection d'authentification est nommée comme telle.

## Le nettoyeur de base qui n'avait jamais tourné

`npx convex export --path` produit une archive ZIP ; le script attendait un dossier.
Réparé et prouvé sur un déploiement de développement : export, décompression dans le
dossier temporaire, 126 documents suspects dans 14 tables en 4,7 s, rien laissé dans le
dépôt.

## Ce qui reste honnêtement contre le skill

Le rappel de l'analyse statique seule est faible (à mesurer, pas à citer). Une bonne
part de LA LISTE est encore ⏳. Le rendu d'un agent du parcours réel n'est pas encore
vérifié mécaniquement. Ces limites sont dans `la-liste.md` et dans le journal du banc,
pas cachées.
