---
version: 1
slug: "page-statut"
primary_target: "docs/index.html"
related_targets: ["docs/statut.css", "docs/statut.js", ".upptimerc.yml"]
---

# Page de statut publique de Festisyn (docs/)

Mode : Read. Le visiteur comprend en un coup d'œil si festisyn.com marche, ce qui est lent, et à quelles heures.

Demande de l'utilisateur (13 novembre 2026) : « Améliore l'affichage de la page avec des informations du style ralentissement, ect... Heure de grosse affluence où le site est ralenti, ect... Dans le même style que d'autres site du genre discord. »

Réponses de l'utilisateur à l'entretien (13 novembre 2026) :
- mesures par le serveur de Festisyn (`/api/etat`) ;
- affluence en niveaux, sans chiffres ;
- quatre éléments suivis : Site et pages, Carte et recherche, Connexion et comptes, Mise à jour de nuit.

Publication : « Oui, publie-la », après la liste des choix laissés à l'agent.

## Direction contract

THESIS: les conventions des pages de statut (bannière d'état, éléments avec leurs barres de 90 jours, temps de réponse, incidents), plus une grille « jour × heure » des heures chargées et lentes ; jamais l'apparence ni les couleurs d'un autre service.

OWN-WORLD: le monde de festisyn.com, sans refonte : fond clair et cartes blanches arrondies, encre #111827, accent #3340e6 (sombre : #a3acff), police Inter, logo du site. Couleurs d'état vert, ambre et rouge, doublées d'une forme et d'un mot. Clair et sombre selon l'appareil.

STORY: la bannière dit l'état présent ; chaque élément dit le sien et ses 90 jours ; la courbe et la grille disent quand le site ralentit ; les incidents disent ce qui s'est passé. La page marche même quand festisyn.com ne répond plus : l'état vient d'abord des données d'Upptime sur GitHub.

Pas de tirage de structures : la demande nommait la structure (conventions des pages de statut). La surface vit dans ce dépôt, hors du site ; pas de DESIGN.md ici.
