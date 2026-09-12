# Règles à portée de chemin

Mécanisme officiel de Claude Code, documenté sur
https://code.claude.com/docs/en/memory#organize-rules-with-claude-rules

Une règle placée dans `.claude/rules/` avec un frontmatter `paths:` ne se charge que
**quand Claude lit un fichier correspondant**. Trois avantages décisifs sur le CLAUDE.md :

1. **Elle arrive au bon moment.** La règle sur les écrans se présente quand on ouvre un
   `.tsx`, pas au début d'une conversation qui parlera d'autre chose.
2. **Elle ne coûte rien le reste du temps**, donc le fichier racine peut rester court.
   Anthropic recommande moins de 200 lignes ; au-delà, le modèle n'ignore pas les
   dernières instructions, il les ignore **toutes uniformément**.
3. **Elle survit au compactage** : elle se recharge dès que Claude relit un fichier
   concerné, alors qu'une consigne donnée en conversation disparaît.

## Installation dans un projet

```bash
mkdir -p .claude/rules
cp ~/.claude/skills/scan-backend-frontend/modeles/regles/backend-convex.md .claude/rules/
cp ~/.claude/skills/scan-backend-frontend/modeles/regles/ecrans.md .claude/rules/
```

Adapter les chemins du frontmatter à l'arborescence du projet (`src/app` ou `app`).

## Ce que ces règles ne remplacent pas

Une règle écrite reste **indicative**. Anthropic le dit sans détour : « Never do this »
dans un fichier de contexte est le mauvais outil, une vraie barrière doit être
déterministe. Les règles orientent au bon moment ; le hook est ce qui bloque.
