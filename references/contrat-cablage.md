# Contrat de câblage : le template des 7 maillons

À écrire AVANT de coder un module ou une feature qui touche de la donnée.
Trois minutes. Dix lignes. À déposer dans `docs/cablage/<module>.md` du repo.

Si un maillon ne peut pas être rempli, ce n'est pas un détail à régler plus tard :
c'est la feature qui n'est pas encore comprise.

---

## Template

```md
# Câblage · <nom du module>

1. DÉCLENCHEUR  — <clic sur quel bouton / webhook de qui / cron à quelle heure / agent>
2. CONTRAT      — args : <liste>. Appelant autorisé : <rôle / client / agent>. Garde : <helper>
3. ÉCRITURE     — table <nom>. Idempotence : <clé, ou "aucune, expliquer pourquoi">
4. INDEX        — by_<champs> — utilisé par la lecture n°5
5. LECTURE      — query <module>.<fn>, bornée par <index / take / paginate>
6. SURFACE      — écran <chemin>. Vide : <ce qui s'affiche>. Chargement : <…>. Panne : <…>
7. TRACE        — événement <nom> dans <table>. Alerte si <condition> vers <canal>
```

---

## Exemple rempli (projet client B, alerte RDV)

```md
# Câblage · Notification de RDV pris

1. DÉCLENCHEUR  — webhook iClosed à la prise de RDV + fallback cron 15 min
2. CONTRAT      — args : { eventId, email, startsAt, closer }. Appelant : iClosed
                  uniquement, vérifié par signature partagée (pas d'identité Clerk)
3. ÉCRITURE     — os_sales_calls. Idempotence : eventId unique, upsert et non insert
4. INDEX        — by_eventId (dédoublonnage), by_startsAt (agenda)
5. LECTURE      — booking.prochains, bornée par by_startsAt + take(50)
6. SURFACE      — /agenda. Vide : « aucun RDV à venir ». Chargement : squelette.
                  Panne d'iClosed : bandeau « synchro RDV interrompue depuis <date> »
7. TRACE        — événement rdv_recu dans os_agent_events. Alerte Telegram si aucun
                  événement reçu depuis 6 h alors qu'on est en heures ouvrées
```

---

## Les deux maillons systématiquement oubliés

**Le 6, dans ses trois états.** Quasiment tout le monde code l'état « il y a de la
donnée ». Personne ne code « c'est vide » ni « c'est en panne ». Résultat : une
intégration morte ressemble trait pour trait à une intégration qui n'a rien à afficher.
C'est la raison n°1 pour laquelle une panne dort des semaines.

**Le 7.** Sans trace, le débogage repart de zéro à chaque fois : on relit du code au lieu
de lire un journal. Une ligne d'événement à l'écriture coûte trente secondes et fait
gagner des heures sur chaque incident.

## Le maillon 3, à ne pas bâcler

Toute donnée qui entre par un canal qui peut rejouer (webhook, retry, cron, agent) a
besoin d'une clé d'idempotence **stockée et indexée**. « Ça n'arrivera pas deux fois »
est faux par construction : la livraison at-least-once est la norme de tous les
fournisseurs de webhooks. Sans clé, on n'obtient pas une erreur : on obtient des doublons
silencieux qui faussent tous les chiffres en aval.
