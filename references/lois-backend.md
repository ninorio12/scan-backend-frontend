# Les 12 lois du câblage backend

Chaque loi est là parce qu'elle a coûté quelque chose, chez nous ou chez tout le monde.
Le détecteur associé est indiqué : c'est la seule façon de savoir si la loi est tenue.

---

## 1. Toute fonction publique vérifie l'identité de son appelant · détecteur B1

Une `query` / `mutation` / `action` Convex est joignable par n'importe qui connaissant
l'URL du déploiement, connecté ou non. Le fait que l'UI ne l'appelle que depuis une page
protégée ne protège rien du tout : l'UI n'est pas la porte, la fonction est la porte.

Sans garde, sur un Data OS multi-client, c'est la donnée de tous les clients qui sort.

```ts
// ✗ la porte est ouverte
export const list = query({ args: {}, handler: (ctx) => ctx.db.query("leads").collect() });

// ✓
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);        // jette si non authentifié
    return ctx.db.query("leads")
      .withIndex("by_client", q => q.eq("clientId", user.clientId))  // et cloisonné
      .take(200);
  },
});
```

La garde seule ne suffit pas : **authentifier n'est pas autoriser**. Un utilisateur
authentifié du client A ne doit pas lire le client B, donc le cloisonnement passe par
l'index, pas par un filtre appliqué après coup.

## 2. Ce qui n'est pas appelé par une surface publique passe en `internal*` · B3

Chaque fonction publique est une porte à défendre. Une fonction appelée seulement par le
scheduler, un cron ou une autre fonction n'a aucune raison d'être exposée : `internalQuery`,
`internalMutation`, `internalAction`. Convex l'interdit d'ailleurs dans l'autre sens :
le scheduler ne doit recevoir que de l'`internal.*`.

## 3. Tout argument public est validé · B2

TypeScript disparaît à l'exécution. Sans validateur `v.*`, un appelant envoie ce qu'il
veut et la donnée se corrompt sans un seul message d'erreur. Convex recommande les
validateurs d'arguments sur **toutes** les fonctions publiques, et fournit une règle
ESLint (`@convex-dev/require-argument-validators`) pour l'imposer.

Les validateurs de **retour**, eux, ne se mettent pas partout : verbeux, pénibles au
refactor. À réserver aux fonctions dont le contrat de sortie est critique.

## 4. Jamais de `.filter()` sans index, jamais de `.collect()` non borné · C3, C6

`.filter()` sur une query lit toute la table puis jette. Invisible sur 50 lignes de démo,
fatal à 50 000 chez le client, et c'est toujours découvert en prod. Le chemin de lecture
se décide au moment du schéma (maillon 4 du contrat), pas au moment du bug.

Règle Convex : indexer d'abord, `.take()` / `.paginate()` ensuite, `.collect()` seulement
sur un ensemble dont on connaît la borne haute.

Corollaire : pas d'index redondants. `by_foo` devient inutile dès que `by_foo_and_bar`
existe, et chaque index est une copie de la table.

## 5. Jamais de `catch` muet autour d'un appel réseau ou d'une écriture · C1

```ts
try { const r = await fetch(url); return await r.json(); } catch { return []; }
```

Ce bloc est la cause n°1 des « ça marchait hier ». L'API tierce tombe, la fonction rend
un tableau vide, l'écran affiche « aucune donnée » : identique à un état normal. La panne
peut dormir des semaines.

Un catch légitime fait trois choses : il **trace** (console.error + ligne d'événement),
il **remonte un état** distinct de « vide » (`{ status: "error", since }`), et l'écran
**affiche** cet état. Autour d'un `JSON.parse` de préférence utilisateur, un catch muet
reste acceptable : la distinction est justement ce que sépare le détecteur C1 de C1b.

## 6. Tout `await` sur une écriture · C2

Une écriture non attendue peut ne jamais s'exécuter, et son erreur ne remonte nulle part.
Le front croit avoir écrit, la base est vide. Vaut pour `ctx.db.*`, `ctx.scheduler.*`,
`runMutation`, `runAction`, `ctx.storage.*`.

## 7. Toute entrée externe est idempotente · contrat, maillon 3

Webhooks, retries, crons rejoués : la livraison **at-least-once** est la norme du secteur,
donc les doublons sont une certitude, pas un risque. L'idempotence est le mur porteur de
toute intégration en production : clé stockée, indexée, testée, upsert plutôt qu'insert.

Le reste du kit anti-panne d'intégration :
- retry en backoff exponentiel **avec jitter** (sans jitter, tous les retries retombent ensemble) ;
- pas de retry sur les 4xx (sauf 429) : c'est une erreur de contrat, réessayer ne corrige rien ;
- après les retries, l'événement va dans une file d'échecs visible, **jamais à la poubelle** ;
- une alerte quand cette file dépasse une dizaine d'éléments : un petit stock permanent est
  le signal avancé qu'une dépendance lâche.

## 8. Une donnée, une source de vérité

Si deux modules écrivent la même donnée, l'un des deux est un bug en attente : le jour où
ils divergent, personne ne saura lequel a raison. Soit un seul écrit, soit la donnée est
dérivée (calculée à la lecture). Chez nous c'est la source de la moitié des incohérences
de KPI.

## 9. Les enums et statuts sont partagés

Un statut retapé dans deux fichiers finit toujours par diverger (`"en_cours"` ici,
`"en cours"` là) et la comparaison échoue en silence. Un seul module exporte la liste,
le schéma et l'UI la consomment.

## 10. Pas de `Date.now()` dans une query · C4

Une query Convex n'est pas ré-exécutée quand l'heure change : son résultat se fige au
moment du premier abonnement. Un « RDV d'aujourd'hui » calculé dans une query reste sur
le jour du chargement. La date se passe en argument, ou se matérialise par un cron.

## 11. Le scheduler n'appelle que de l'`internal*` · B3

Voir loi 2. C'est aussi une règle explicite de Convex.

## 12. Tout secret vient de l'environnement

Jamais dans le code, jamais dans le bundle client, jamais dans une table lisible par le
front. Une clé exposée côté client est publiée, y compris après un rollback : on la
révoque, on ne la « retire » pas.

---

## Pourquoi ces lois ne suffisent pas seules

Nos repos contenaient déjà un skill de 617 lignes décrivant une grande partie de ces
règles. Les chiffres de l'audit montrent qu'aucune n'était tenue. Une consigne écrite est
**indicative** ; ce qui tient, c'est ce qui **échoue bruyamment** quand la règle est
violée : un script qui sort en code 1, un hook qui bloque, une CI rouge.

C'est exactement la recommandation d'Anthropic sur l'usage de Claude Code : donner à
l'agent un check qu'il peut lancer lui-même ferme la boucle (il code, il vérifie, il
corrige), sinon l'humain devient la boucle de vérification, et chaque défaut attend d'être
remarqué. Les hooks y sont décrits comme déterministes, les fichiers de consignes comme
advisory. D'où les codes de sortie (0 propre, 1 défauts, 2 incomplet) faits pour un pre-commit ou une CI ; le hook de fin de tour a été essayé et abandonné (`gates-qui-tiennent.md`).

---

## Ce qui existe ailleurs, et pourquoi ça ne suffisait pas

Recherche faite le 11/09/2026 sur GitHub (chiffres d'étoiles réels à cette date). Aucun
outil public ne couvre la chaîne complète. Chacun couvre un maillon :

| Outil | ★ | Couvre | Ne couvre pas |
|---|---|---|---|
| [knip](https://github.com/webpro-nl/knip) | 12 240 | fichiers, exports et dépendances morts en JS/TS | les tables, les routes HTTP, les gardes d'accès |
| [semgrep](https://github.com/semgrep/semgrep) | 16 588 | motifs statiques multi-langage, règles maison | ne sait rien du câblage entre modules |
| [dependency-cruiser](https://github.com/sverweij/dependency-cruiser) | 7 163 | règles d'architecture sur les imports | n'a pas la notion de donnée ni de porte |
| [schemathesis](https://github.com/schemathesis/schemathesis) | 3 597 | teste une API réelle contre son OpenAPI | suppose un OpenAPI à jour |
| [pact-js](https://github.com/pact-foundation/pact-js) | 1 814 | contrat consommateur/fournisseur entre services | lourd pour un SaaS monolithique |
| [oasdiff](https://github.com/oasdiff/oasdiff) | 1 358 | ruptures de contrat entre deux versions d'API | rien sur le câblage interne |
| [eslint-plugin-boundaries](https://github.com/javierbrea/eslint-plugin-boundaries) | 981 | frontières entre couches | idem |
| [ArchUnitTS](https://github.com/LukasNiessen/ArchUnitTS) | 478 | tests d'architecture façon ArchUnit | idem |

Les rares dépôts qui visent explicitement « unused endpoints », « orphan tables » ou
« API contract drift » ont entre 0 et 3 étoiles et datent de l'été 2026 : des prototypes,
rien d'exploitable.

Ce qu'aucun ne fait, et qui est précisément notre symptôme : **relier une unité exposée à
la surface qui l'appelle, et une table à qui l'écrit et qui la lit**. D'où cet auditeur.

`knip` reste complémentaire et vaut la peine d'être branché en parallèle : il couvre le
code mort côté front, là où notre auditeur regarde le câblage backend.

## Sources

- Convex, Best Practices : https://docs.convex.dev/understanding/best-practices/
- Convex, Argument and Return Value Validation : https://docs.convex.dev/functions/validation
- Convex, quand utiliser un validateur de retour : https://stack.convex.dev/when-to-and-when-not-to-use-return-validators
- Anthropic / Claude Code, Best practices (vérification, hooks, revue adverse) : https://code.claude.com/docs/en/best-practices
- Anthropic, Effective context engineering for AI agents : https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Webhooks, idempotence et files d'échec : https://www.digitalapplied.com/blog/webhook-reliability-idempotency-retries-engineering-reference-2026
- Dead code en TypeScript, l'outil de référence (complémentaire à notre auditeur) : https://knip.dev/
- GitHub Spec Kit, développement piloté par la spec : https://github.blog/ai-and-ml/generative-ai/spec-driven-development-with-ai-get-started-with-a-new-open-source-toolkit/
