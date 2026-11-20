# Architecture — Appli chef d'équipe EG PACA

État au 16/11/2026. À mettre à jour dès que la structure change.

## Principe
Application web installable sur le téléphone (PWA), en JavaScript pur, sans framework ni compilation.
Hébergée gratuitement sur GitHub Pages. Les données restent sur le téléphone (`localStorage`)
et sont synchronisées avec Google Drive.

L'appli **n'appelle pas l'API Claude**. Claude travaille dans le projet claude.ai
« Assistant de chef d'équipe » et échange avec l'appli par fichiers sur le Drive :

```
Téléphone (appli) ──écrit──> Drive EG.PACA/Appli Thomas/<fichier d'état>.json ──lu par──> Claude
Claude ──dépose──> Drive/Appli Thomas/boite-claude/*.json ──lu par──> appli (à la synchro)
```

## Fichiers
| Fichier | Rôle |
|---|---|
| `index.html` | Page unique : zone `#view` (écran courant) + barre d'onglets `#tabs` |
| `style.css` | Charte EG PACA |
| `app.js` | Tout le fonctionnement (≈ 1 600 lignes, à découper : voir ROADMAP) |
| `sw.js` | Service worker : appli ouvrable sans réseau (réseau d'abord, cache sinon) |
| `manifest.webmanifest`, `icon-*.png` | Installation sur l'écran d'accueil |
| `tests/` | Tests automatiques (`node --test`) |
| `docs/` | Architecture et feuille de route |

## File de prompts
La file de prompts est la liste de tâches confiées une par une à Claude Code pour faire évoluer l'appli : chaque tâche a sa propre session, le travail s'accumule dans les fichiers, et une seule mise à jour est publiée à la fin de la file.

## Sections actuelles de `app.js`
1. **Stockage** — `defaults()` (forme des données), `loadState()`, `save()`, état d'écran `U` (non sauvegardé).
2. **Outils** — dates (`todayStr`, `addDays`, `mondayOf`…), `esc()` (protection HTML), `uid()`, `toast()`.
3. **Icônes** — SVG en ligne.
4. **Composants communs** — boutons, sélecteur de commune, bouton micro.
5. **Météo** — Open-Meteo (modèle Météo-France), cache 30 min, `dayHours()`, `nacelleDecision()`, `wxSummary()`.
6. **Boîte Claude** — `applyBoxMessage()` / `applyAction()` : appliquent les fichiers JSON déposés par Claude.
7. **Google** — connexion (Google Identity Services), Gmail lecture seule (20 mails, 24 h), Drive : `syncNow()`.
8. **Dictée vocale** — reconnaissance vocale du navigateur.
9. **Écrans** — une fonction `vXxx()` par écran, qui renvoie du HTML.
10. **Actions** — objet `A` : une fonction par bouton (`data-action="..."`). Objet `CH` : changements de champs.
11. **Routage et rendu** — `#hash` → écran, `render()` redessine tout `#view`.

## Données (`localStorage`, clé `egpaca_app_v1`)
- `settings` : lien du projet Claude, dossiers Drive, ID client Google, nacelle (modèle + limite en km/h), numéro d'urgence exploitant, heure du brief.
- `plans[date]` : lieux (commune + coordonnées), situation (seul / managé / chef), effectif, horaires, points sensibles.
- `orders[date]` : ordres « qui : quoi », cochables.
- `debriefs`, `briefs[date]`, `incidents`, `agenda`.
- `revision.{elec,management,marketing}` : questions + révision espacée (J+1, 3, 7, 14, 30).
- `elocution` : niveau 1 à 5, historique, exercices à refaire.
- `stock` : inventaire outillage / matériel, commandes, date du dernier inventaire.
- `base` : sections de la base (arbre, croisement, habitudes, connaissances, infos) + journal.
- Mails : clé séparée `egpaca_mails_v1`, effacés après 24 h.

## Format des fichiers de la boîte Claude
Un objet JSON avec un champ `type` :
- `brief` : `{date, text}`
- `revision` : `{tab, domaine, questions:[{q, options[], correct, expl, source}], situation, terme}`
- `elocution` : `{tab, exercice:{consigne…}}` — `elocution-note` : `{total, …}`
- `actions` : `{items:[{kind, …}]}` avec `kind` = `agenda` | `ordre` | `commande` | `journal` | `base` | `plan`

Tout fichier mal formé est ignoré et signalé (« fichier illisible »).

## Services externes
| Service | Usage | Remarque |
|---|---|---|
| Open-Meteo | Géocodage + prévisions Météo-France | Gratuit en non commercial |
| Google Identity Services | Connexion | ID client dans les réglages |
| Gmail API | Lecture seule | Seulement avec accord de l'employeur |
| Google Drive API | Synchro `etat-appli.json` + boîte Claude | Portée `drive` complète (accès à tout le Drive) : à réduire si possible |
| Google Fonts | Polices Inter, Playfair | Ne marche pas hors ligne (repli sur police système) |

## Architecture cible (après les étapes de découpage de la ROADMAP)
```
code-appli/
  index.html  style.css  sw.js  manifest.webmanifest
  js/
    main.js          routage, rendu, branchement des événements
    stockage.js      defaults, chargement, sauvegarde
    logique/         calculs purs, sans DOM, tous testés
      dates.js  meteo.js (dayHours, nacelleDecision)  stock.js  revision.js  boite.js (validation)
    services/        tout ce qui parle au réseau
      openmeteo.js  google.js  drive.js
    ecrans/          un fichier par écran (accueil, brief, débrief, incident…)
  tests/             un fichier de test par fichier de logique/
```
Règle : `logique/` n'importe jamais `services/` ni `ecrans/`.
