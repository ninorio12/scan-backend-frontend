# Ce que le vrai dev appelle ça

Recherche du 11/09/2026. Notre méthode n'est pas une invention : elle redécouvre des
principes établis depuis vingt ans. Les connaître donne les bons mots et évite de
réinventer de travers.

## Ce n'est pas un problème de backend

Le backend peut être parfait et le produit cassé quand même. Le défaut vit **entre les
couches**, dans les coutures. Le métier appelle ça un problème d'**intégration**, et il
a une cause connue : le sens du découpage.

**Découpage horizontal** (le nôtre jusqu'ici) : on fait tous les écrans, puis les
modules, puis « on met la tech derrière ». Une feature finit éparpillée dans cinq ou six
dossiers, et rien ne garantit que les morceaux se rejoignent. C'est la fabrique à liens
perdus.

**Découpage vertical** (vertical slice) : on prend une seule feature et on la construit
entière, de l'écran jusqu'à la table, avant de passer à la suivante. Chaque tranche est
autonome, testable, livrable. Moins de bugs d'intégration, parce qu'il n'y a jamais de
moment où les morceaux attendent d'être réunis.

## Walking skeleton, steel thread, tracer bullet

Trois noms pour la même chose. Alistair Cockburn, le *walking skeleton* :

> « Une implémentation minuscule du système qui réalise une petite fonction de bout en
> bout. Elle n'a pas besoin d'utiliser l'architecture finale, mais elle doit **relier
> entre eux les principaux composants**. L'architecture et les fonctionnalités évoluent
> ensuite en parallèle. »

Les *Pragmatic Programmers* l'appellent **tracer bullet** : une balle traçante qui
traverse toutes les couches, en code de production, pour voir où elle atterrit avant
d'en tirer mille.

La formulation la plus utile pour nous : *la plupart des constructeurs bâtissent chaque
pièce puis les connectent ; le steel thread connecte toutes les couches dès le départ,
même minimalement.*

**C'est exactement notre règle « un écran naît branché », mais à l'échelle du projet.**
Sur un nouveau SaaS, la première chose à construire n'est pas un écran ni un schéma :
c'est **une tranche unique qui va du clic jusqu'à la table et revient**, si maigre
soit-elle. Tant qu'elle ne marche pas, on ne construit rien d'autre.

## Le trou que les tests ne couvrent pas

Le contract testing (Pact) existe pour une raison précise : les tests unitaires simulent
le réseau, donc ils ne voient jamais les bugs d'intégration. L'exemple canonique :

> Une équipe paiements renomme un champ JSON `amount_cents` en `amount`, un « nettoyage
> rétrocompatible ». L'équipe facturation consommait ce champ, testée en isolation avec
> des bouchons correspondant à l'ancien contrat. Les deux équipes avaient mis à jour
> leurs propres bouchons. **Aucun test n'a échoué. L'intégration n'a cassé qu'en
> production.**

C'est notre bug Sophie Martin sous un autre costume : chaque moitié est correcte, la
couture ne l'est pas. Personne ne teste les coutures par accident : il faut les viser.

## Les chiffres 2026 sur le code généré par IA

Utiles parce qu'ils montrent que le problème est structurel, pas une négligence :

- **43 %** des changements de code générés par IA demandent un débogage en production,
  **même après être passés par la QA et la préproduction**.
- Les **échecs d'intégration** touchent environ **30 %** des organisations, sous forme de
  dérive de schéma et de violations de contrat en amont.
- Le code généré introduit environ **1,7 fois plus** d'incidents critiques à l'exécution
  que du code relu par un humain.
- Des équipes SRE passent jusqu'à **un tiers de leur semaine** à trier et réparer des
  défaillances de code généré.

Conclusion pratique : passer la compilation, la QA et la préproduction ne prouve rien sur
les coutures. Seule une traversée réelle de bout en bout le fait.

## L'analyse de teinte, retournée

La discipline qui sait suivre une donnée à travers du code s'appelle l'analyse de teinte
(*taint analysis*). En sécurité : une SOURCE non fiable (entrée utilisateur), des
PROPAGATEURS (affectations, appels), un PUITS dangereux (requête SQL, `eval`), et on
alerte si la donnée atteint le puits sans avoir été nettoyée. C'est ce que font Semgrep
(`mode: taint`) et CodeQL.

Notre problème est le **miroir exact** : les sources sont les vraies lectures de données,
les puits sont les endroits d'affichage, et le défaut n'est pas qu'une donnée sale
arrive quelque part, c'est qu'**un endroit d'affichage n'est alimenté par rien**. Même
machinerie, alerte inversée. C'est ce que fait `scripts/flux.mjs`, avec le compilateur
TypeScript du projet.

Retenir aussi l'outillage : `ts-morph` enveloppe l'API du compilateur pour ce genre
d'analyse, et Semgrep permet d'écrire des règles de flux en YAML sans compilateur. Notre
script n'utilise ni l'un ni l'autre (zéro dépendance à installer chez le client), mais
c'est là qu'il faudra aller si l'analyse doit traverser les fichiers.

## Ce qu'on en retient dans le skill

1. Construire **par tranche verticale**, jamais par couche.
2. Sur un projet neuf, commencer par le **squelette qui marche** : une tranche
   complète, du clic à la table, avant tout le reste.
3. Viser les **coutures** explicitement : ce sont elles qui cassent, et aucun test ne les
   couvre par hasard.
4. La preuve est une **traversée réelle**, pas un build vert.

## Sources

- Walking skeleton, Alistair Cockburn : https://codeclimate.com/legacy/kickstart-your-next-project-with-a-walking-skeleton
- Tracer bullets, The Pragmatic Programmer : https://www.barbarianmeetscoding.com/notes/books/pragmatic-programmer/tracer-bullets/
- Steel thread, construire avec l'IA sans brûler le budget : https://bryceyork.com/steel-threads/
- Walking skeleton / steel thread, playbook Equal Experts : https://playbooks.equalexperts.com/mlops-playbook/practices/create-a-walking-skeleton-steel-thread
- Vertical slice architecture : https://milanjovanovic.tech/blog/vertical-slice-architecture-structuring-vertical-slices
- Contract testing, Pact : https://docs.pact.io/
- Analyse de teinte, Semgrep : https://semgrep.dev/docs/writing-rules/data-flow/taint-mode/overview
- ts-morph, API du compilateur TypeScript : https://github.com/dsherret/ts-morph
- État du code généré par IA en production, 2026 : https://venturebeat.com/technology/43-of-ai-generated-code-changes-need-debugging-in-production-survey-finds
- State of AI-Powered Engineering 2026, Lightrun : https://www.globenewswire.com/news-release/2026/04/14/3273542/0/en/lightrun-s-2026-state-of-ai-powered-engineering-report-almost-half-of-ai-generated-code-fails-in-production.html
