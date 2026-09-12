---
paths:
  - "app/**/*.tsx"
  - "src/**/*.tsx"
  - "components/**/*.tsx"
---

# Écrans : un écran naît branché

- On écrit la lecture de la source AVANT le premier pixel. Jamais de valeur écrite dans
  un composant : ni dans un champ, ni dans un chiffre, ni comme valeur de repli.
- Pendant le chargement : un squelette, jamais une valeur. Une valeur d'attente reste.
- Une action n'annonce jamais un succès qu'elle n'a pas constaté. Le message de
  confirmation vient APRÈS la résolution de la mutation, jamais à la place.
- Trois états obligatoires : vide, chargement, panne. Une panne d'intégration ne doit
  jamais ressembler à « il n'y a rien à afficher ».
- Un bouton sans action et un lien sans destination n'existent pas : on les branche ou
  on les retire de l'écran.
- Pour juger un rendu avec des données réalistes, on remplit LA BASE, pas le composant.
