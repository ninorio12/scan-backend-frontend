# CONTRAINTES — le plancher du skill backend

Un seul fichier. N'importe quel agent, sur n'importe quel outil, peut le lire, et un
changement dedans se voit en revue, là où il doit se voir.

**Ce fichier ne s'affaiblit pas pour faire passer un changement.**

## Plancher (toujours actif, aucune exception)

- Aucun dépôt réel (`<projet-client-B>`, `<projet-client-A>`, `projet client C`) n'est modifié. Copie seule.
- Le skill mesuré n'est jamais modifié par le harnais. `juges/plugin-backend/skills/scan-backend-frontend` est un lien symbolique.
- Aucun chiffre publié sans son effectif et son intervalle de confiance.
- Aucun cas retiré du banc sans preuve écrite que le défaut n'en était pas un.
- Aucun opérateur de mutation ne cite un identifiant de règle du détecteur.
- Un défaut découvert par le détecteur ne rejoint jamais la vérité terrain.
- Un `exit 2` ne se lit jamais comme un `exit 0`.

## Vérifié avec des nombres

| Dimension | Règle | Vérifié par | Tourne à |
|---|---|---|---|
| indépendance au chemin | verdict identique à deux emplacements aléatoires | `cliquet.mjs --canari` | avant toute publication |
| intégrité de la vérité terrain | aucun identifiant de défaut retiré | `cliquet.mjs --verifier` | chaque mesure |
| intégrité du barème | `lib/appariement.mjs`, `familles.mjs`, `mutateurs/operateurs.mjs` inchangés, sinon run non comparable | `cliquet.mjs --verifier` | chaque mesure |
| arbitrage tracé | chaque verdict porte sa preuve | `verdicts/*.json` | à la revue |
| opinion extérieure | un juge que nous n'avons pas écrit rend un verdict | `juges/tsc.mjs`, `juges/plugin-backend` | chaque mesure longue |

## Mesuré, pas encore imposé

La valeur d'aujourd'hui, et un sens interdit. Jamais une cible inventée : fixer 80 % sur un
détecteur à 22,8 % donne un voyant rouge permanent, donc une équipe qui apprend à ignorer
les voyants rouges.

| Métrique | Aujourd'hui | Sens |
|---|---|---|
| rappel diagnostic, global (57 cas) | 22,8 % (13/57) | ne doit pas baisser |
| justesse arbitrée, global (95 signalements) | 92,6 % (88/95) | ne doit pas baisser |
| rappel, banc figé banc2 | 34,6 % (9/26) | ne doit pas baisser |
| rappel, banc génératif graine 4242 | 12,9 % (4/31) | ne doit pas baisser |
| justesse différentielle | 91,7 % (11/12) | ne doit pas baisser |
| familles sans aucun détecteur | 5 sur 26 | ne doit pas grandir |
| cas au banc | 26 figés + 178 moissonnés | ne doit pas diminuer |
| signalements au repos sur projet client C | 2 048 | ne doit pas grandir |

Tolérance : une baisse ne bloque que si le test de deux proportions la déclare significative
à α = 0,05.

**Quand un chiffre monte, on met la ligne à jour. Quand il baisse, c'est la trouvaille.**

## Exceptions

| ID | Règle | Chemin | Raison | Expire |
|---|---|---|---|---|
| E-1 | justesse arbitrée en interne | `verdicts/banc2.json` | 28 verdicts écrits à la main ; arbitre interne donc contestable, chaque verdict porte sa preuve | à la première exécution d'un juge tiers capable de trancher un câblage |
| E-2 | le banc génératif ne couvre que 10 familles sur 26 | `mutateurs/operateurs.mjs` | les 16 autres exigent un opérateur sémantique | prochaine campagne d'opérateurs |
| E-3 | l'ablation native ne rend pas encore de verdict valide | `juges/plugin-backend` | le bac à sable de l'éval n'a pas mis en scène le dépôt | dès que `scaffold_script` est correctement placé |
