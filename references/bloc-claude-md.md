# Le bloc à coller dans le CLAUDE.md de chaque projet

## Pourquoi ce fichier existe

Un skill ne se déclenche pas de façon fiable tout seul. Ce n'est pas une impression :
Vercel l'a mesuré sur une suite d'évaluations en janvier 2026, et le résultat est brutal.

| Configuration | Taux de réussite |
|---|---|
| Sans documentation | 53 % |
| **Skill disponible, déclenchement laissé au modèle** | **53 %** (le skill n'était pas invoqué dans 56 % des cas) |
| Skill + instruction explicite de l'invoquer | 79 % |
| **Index compressé de 8 Ko directement dans le fichier de contexte** | **100 %** |

Un skill présent mais non invoqué ne vaut pas mieux que rien, et il a même dégradé
certaines métriques : un skill inutilisé fait du bruit. La conclusion de Vercel est
sans ambiguïté : *le contexte passif bat aujourd'hui la récupération à la demande*.

Ça recoupe la hiérarchie de résistance à la dérive que décrit `claude-enforcer` :

| Couche | Résiste à la dérive ? |
|---|---|
| Fichier de contexte (CLAUDE.md) | Non, mais toujours chargé |
| Skill | Non (chargé seulement si invoqué) |
| **Hook** | **Oui** (blocage déterministe) |
| **Agent en contexte isolé** | **Oui** (évaluation indépendante) |

Et la cause est documentée par la recherche : *lost in the middle* (arXiv 2307.03172).
Dans une longue conversation, les consignes du début se diluent sous tout ce qui suit.

**Donc la répartition qui marche :**

- les quelques règles **non négociables** vivent dans le CLAUDE.md du projet, en
  quelques lignes denses : elles sont là à chaque tour, sans dépendre d'une décision ;
- le **skill** porte la méthode complète et les outils : il est fait pour le travail
  vertical qu'on déclenche exprès (« audite ce SaaS », « répare le câblage ») ;
- le **hook** bloque ce qui ne doit jamais passer ;
- l'**agent** en contexte frais juge sans être influencé par ce qu'il vient d'écrire.

---

## Le bloc, à coller tel quel

Court volontairement. Chaque ligne supprimée du bloc est une règle qui ne sera pas
suivie ; chaque ligne inutile ajoutée dilue les autres.

```markdown
## Backend : règles non négociables

1. Un écran naît branché. On écrit la lecture de la source AVANT le premier pixel.
   Jamais de valeur écrite dans un composant : ni dans un champ, ni dans un chiffre,
   ni comme valeur de repli. Pendant le chargement : un squelette, jamais une valeur.
2. Une action n'annonce jamais un succès qu'elle n'a pas constaté. Le message de
   confirmation vient APRÈS la résolution de la mutation, jamais à la place.
3. Trois états obligatoires par écran de données : vide, chargement, panne. Une panne
   d'intégration ne doit jamais ressembler à « il n'y a rien à afficher ».
4. Toute porte publique vérifie l'identité de son appelant, et cloisonne par l'index
   de lecture. Authentifier n'est pas autoriser.
5. Jamais de `catch` muet autour d'un appel réseau ou d'une écriture : tracer,
   remonter un état distinct de « vide », et l'afficher.
6. Avant de conclure une séance : `node ~/.claude/skills/scan-backend-frontend/scripts/audit-backend.mjs .`
   doit sortir à zéro bloquant. Charger le skill `scan-backend-frontend` pour la méthode et les outils.
```

## Installation dans un projet

```bash
# 1. ajouter le bloc au fichier de contexte
cat ~/.claude/skills/scan-backend-frontend/references/bloc-claude-md.md | sed -n '/^## Backend : règles/,/^```$/p' >> CLAUDE.md

# 2. vérifier que le skill lui-même est valide (un champ mal formé = skill invisible)
npx agnix .
```

## La leçon qu'on a payée sur ce skill

Le 11/09/2026, `agnix` a signalé que notre propre `SKILL.md` ne parsait pas : la
description contenait des deux-points non protégés, ce qui casse le frontmatter YAML.
Un skill dont le frontmatter est invalide peut ne jamais être chargé. L'outil qui traque
les câblages cassés était lui-même mal câblé, et personne ne l'aurait vu.

**Valider le skill fait partie du câblage.** `npx agnix .` avant de compter sur lui.

## Sources

- Vercel, *AGENTS.md outperforms skills in our agent evals*, 27/01/2026 :
  https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals
- `agnix`, linter de configurations d'agents (455 règles) : https://github.com/agent-sh/agnix
- `claude-enforcer`, hiérarchie d'application et résistance à la dérive :
  https://github.com/odysseyalive/claude-enforcer
- *Lost in the Middle*, sur la dilution des consignes : https://arxiv.org/abs/2307.03172
