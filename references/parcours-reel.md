# Entrer dans la maison : le parcours réel

Le scan lit les plans. Ici on ouvre les portes et on appuie sur les interrupteurs.

**Pourquoi ce fichier existe.** Le 11/09/2026, sur projet client A, l'analyse statique sortait une
poignée de constats. Cinq agents lâchés dans l'application avec un navigateur en ont
sorti **une soixantaine de défauts réels en deux heures**, dont aucun n'était visible
dans le code : un volume de ventes faux de bout en bout, 5 793 documents inatteignables,
un écran d'accueil qui se contredit sur le chiffre d'affaires, un calendrier qui affiche
« journée libre » quand le serveur est mort, et une fiche client qui en ouvre une autre
avec ses coordonnées. **C'est l'étape qui rapporte le plus, de loin.**

---

> 📌 Le 11/09, cinq agents ont écrit une centaine de scripts Playwright à la main alors
> que ces trois skills étaient installés (ou à une commande). **Chercher dans le registre
> avant d'écrire** : `npx skills find "<besoin>"`. Ça vaut pour chaque étape.

## Avant de lancer quoi que ce soit : quatre vérifications

```bash
ss -ltnp | grep -E ':(3000|3001|5173)'        # l'app tourne-t-elle déjà ?
grep -E 'CONVEX_DEPLOYMENT|DATABASE_URL' <repo>/.env.local | sed 's/=.*:/=…:/'
ls <repo>/app/modules/ 2>/dev/null || ls <repo>/app/           # les modules
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/
```

1. **L'application tourne-t-elle ?** Sinon la lancer (`npm run dev`) et attendre.
2. **Sur quelle base tape-t-elle ?** `dev` : on peut cliquer. `prod` : **on ne clique
   rien**, on se contente d'observer en lecture. Un déploiement `dev` peut quand même
   contenir les vraies données du client (c'était le cas d'projet client A, 7 885 contacts réels).
3. **Y a-t-il une authentification ?** Si oui, il faut une session enregistrée
   (`storageState` Playwright), sinon les agents testeront la page de connexion et
   concluront que tout va bien — un blanc-seing, pire que rien.
4. **Quels sont les modules ?** C'est le découpage des périmètres.

---

## Le découpage : un groupe de modules par agent, jamais deux agents au même endroit

Trois modules par agent environ, groupés par nature (les tableaux de bord ensemble, le
métier ensemble, les branchements ensemble). **Les périmètres doivent être disjoints** :
deux agents sur la même application écrivent dans la même base et leurs traces se
mélangent — c'est arrivé, un agent a lu dans le journal des écritures d'un autre et a
failli les compter comme des défauts. Dire à chaque agent que d'autres travaillent en
parallèle.

Toujours réserver un agent au groupe **calendrier / intégrations / paramètres** : c'est
là que se concentrent les défauts de câblage dans tous nos produits.

---

## Le brief, à recopier et adapter

> Tu testes une vraie application en cliquant dedans, comme le ferait un utilisateur
> méfiant. Tu travailles en français.
>
> TON PÉRIMÈTRE, et rien d'autre : les modules **X, Y, Z** de l'application `<NOM>`, qui
> tourne sur http://localhost:3000. Tes URL : …
>
> ⚠️ DEUX INTERDITS ABSOLUS
> 1. Ne modifie AUCUN fichier du projet. Tu observes, tu ne répares pas.
> 2. Ne clique JAMAIS sur un bouton destructeur : supprimer, archiver, vider,
>    réinitialiser, purger, désactiver, déconnecter. Ni sur ce qui écrit chez un tiers
>    (créer un contact qui part dans le CRM du client, envoyer un message, publier).
>    La base contient les vraies données du client. Tout le reste se clique.
>
> **Ne réécris pas un pilote de navigateur à la main**, trois skills installés font le
> travail : `playwright-cli` (Microsoft, 150 k installations) pilote le navigateur en
> ligne de commande sans écrire de script (`playwright-cli open <url>`, puis `click e15`,
> `fill e5 "texte"`, `snapshot` qui donne les références de chaque élément) ;
> `webapp-testing` (Anthropic) apporte `with_server.py` qui lance et arrête le serveur
> tout seul, et le motif **reconnaissance puis action** : naviguer, attendre
> `networkidle`, relever les sélecteurs sur l'état RENDU, et seulement ensuite agir ;
> `browser-testing-with-devtools` (Osmani) pour la console, le réseau et le profilage.
> Playwright brut reste disponible (celui du projet audité, sinon celui installé par
> `npm install` dans le dossier du skill) pour ce qu'ils ne
> couvrent pas : l'interception réseau fine et la coupure de source.
>
> ⚠️ `wait_for_load_state('networkidle')` avant toute observation : sans ça on lit un
> écran à moitié rendu et on déclare mort un bouton qui n'est pas encore arrivé.
>
> Écris tes scripts et tes résultats dans `<skill>/banc/parcours/<ton-groupe>/` (persistant).
>
> CE QUE TU CHERCHES, par ordre d'importance :
> 1. **Un bouton qui ment.** La preuve n'est jamais le message affiché : tu cliques, tu
>    RECHARGES la page, et tu regardes si le changement a survécu.
> 2. **Une valeur inventée.** Bloque la source (`**/*.convex.cloud/**`) et recharge. Ce
>    qui reste affiché est écrit en dur. ⚠️ Sur Convex, l'interception HTTP ne coupe pas
>    le WebSocket : couper au niveau DNS.
> 3. **Un chiffre qui ne tient pas.** Tout nombre affiché doit se retrouver dans la liste
>    en dessous, ou dans l'écran vers lequel il pointe. Compte les lignes et compare.
> 4. **Un appel réseau cassé.** Intercepte tout, relève chaque 404, 500, réponse vide.
> 5. **Un lien vers une page qui n'existe pas.**
> 6. **Un bouton mort** : clic sans requête, sans changement, sans erreur.
> 7. **Un écran qui ne sait pas dire qu'il est vide ou en panne** : page blanche,
>    squelette infini, zéro silencieux. Un « 0 » à la place de « serveur injoignable »
>    est un défaut grave : le client prend une décision sur un chiffre faux.
> 8. **Une recherche qui ne trouve pas** : casse, accents, espaces, formats de téléphone.
>
> MÉTHODE : énumère TOUS les éléments cliquables, clique chacun sauf les destructeurs, et
> dis combien il y en avait et combien tu en as cliqué. Pour chaque anomalie : l'URL, le
> libellé exact, ce que tu attendais, ce qui s'est passé, la preuve. **N'affirme jamais
> qu'une chose est cassée sans l'avoir provoquée deux fois.**
>
> HONNÊTETÉ : « non testé » est une réponse acceptable, « ça a l'air de marcher » sans
> clic ne l'est pas. Dis aussi ce qui marche, vérifié par rechargement. Si tu laisses une
> donnée de test en base, signale-la nommément pour qu'on la retire.

Quand l'analyse statique a déjà trouvé des choses dans ce périmètre, **les donner à
l'agent** en lui demandant de les confirmer ou de les infirmer en vrai. Un défaut du code
qui ne se voit pas à l'écran est moins grave qu'un défaut qui se voit, et un démenti
nous apprend que notre lecture se trompe. Sur projet client A : 4 annoncés, 4 confirmés, 13 trouvés
en plus.

---

## Ce qui revient dans tous nos produits, à chercher en premier

1. **Des données de démonstration dans la vraie base.** Cause racine n°1 sur projet client A,
   trouvée indépendamment par quatre agents. Elle produit les pires symptômes : un agenda
   de personnes fictives, et surtout une recherche qui échoue et ouvre « la première
   fiche de la liste » sans le dire, c'est-à-dire une vraie cliente.
2. **Un écran qui affiche 0 au lieu de dire qu'il est en panne.**
3. **Un compteur qui compte autre chose que ce qu'il annonce** (des archives comptées
   comme des ventes, des loyers additionnés à des prix de vente, des « pas propriétaire »
   comptés comme propriétaires).
4. **Un réglage enregistré dans le navigateur et jamais en base.**
5. **Un chiffre cliquable qui ne mène pas à son décompte.**

---

## Après : la consolidation

Rassembler les rapports, retirer les doublons entre agents, et **remonter la cause racine
avant les symptômes**. Sur projet client A, une seule cause (les données de démonstration) expliquait
à elle seule une dizaine de constats répartis dans quatre modules.

Puis **nettoyer les traces** : les agents laissent des données de test qu'ils n'ont pas
le droit de supprimer. Les lister nommément et demander à l'humain avant de les retirer.
