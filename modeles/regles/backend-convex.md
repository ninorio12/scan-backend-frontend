---
paths:
  - "convex/**/*.ts"
---

# Backend Convex : règles non négociables

- Toute fonction publique vérifie l'identité de son appelant, et cloisonne par l'index
  de lecture. Authentifier n'est pas autoriser.
- NE JAMAIS accepter un identifiant d'utilisateur en argument pour décider d'un droit.
  L'identité se dérive côté serveur, depuis le jeton.
- Une vérification absente doit REFUSER, jamais laisser passer. Pas de garde qui
  s'efface quand une variable d'environnement manque.
- Validateur `args` sur chaque fonction. Nom de table explicite dans `db.get/patch/delete`.
- Jamais `.collect()` non borné : `.take()` ou `.paginate()`. Jamais `.filter()` sans index.
- Tout `await` sur une écriture. Jamais de `catch` muet autour d'un appel réseau.
- Une tâche planifiée n'a AUCUNE identité : elle ne peut pas viser une fonction gardée.
  Extraire le cœur en helper, la mutation publique garde l'auth et appelle ce cœur.
- Les actions planifiées sont exécutées AU PLUS UNE FOIS et jamais réessayées.
  Si le résultat compte, une mutation doit vérifier qu'il est atteint et replanifier.
- Toute entrée rejouable (webhook, cron, agent) porte une clé d'idempotence stockée.
