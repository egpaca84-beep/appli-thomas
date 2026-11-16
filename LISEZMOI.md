# Appli Chef d'équipe — EG PACA (version 2, sans API)

Appli perso de Thomas, installable sur le téléphone. Elle n'utilise pas l'API Claude : Claude travaille dans l'appli Claude (abonnement), dans le projet « Assistant de chef d'équipe », et échange avec l'appli par le Google Drive.

## Comment ça marche

- L'appli écrit tout son état dans `etat-appli.json`, dans le dossier Drive « Appli Thomas » (Drive OIKOS). C'est aussi la sauvegarde.
- Claude lit ce fichier, et dépose ses réponses (brief, actions, questions de révision, exercices et notes d'élocution) dans le sous-dossier `boite-claude`.
- À chaque synchronisation, l'appli récupère ce que Claude a déposé.
- Chaque matin du lundi au vendredi à 5h45, une tâche programmée Claude prépare le brief, les questions de révision et les exercices d'élocution.
- Le bouton « Parler » ouvre le projet dans l'appli Claude. Après la conversation : revenir dans l'appli et synchroniser.

## Écrans

- **Accueil** : météo du chantier et décision nacelle, prévu du jour, à commander, rappel d'inventaire, synchro.
- **Parler à Claude** : ouvre le projet Claude, avec des phrases toutes faites copiées (brief, débrief, incident, révision, élocution, agenda, commande, compte rendu).
- **Brief du matin** : le brief préparé par Claude, lecture à voix haute, météo des chantiers.
- **Ordres du jour**, **Agenda** (pro en vert, perso en violet), **Matériel & outillage** (inventaires séparés, liste à commander, inventaire tous les 15 jours) : fonctionnent seuls.
- **Incident** : 15 / 18 / 112, numéro exploitant, puis Claude pour les ordres.
- **Débrief du soir** : 8 questions dans l'appli, puis le lieu et la situation de demain. Claude s'en sert pour le brief.
- **Révision** : questions du jour préparées par Claude, révision espacée (J+1, J+3, J+7, J+14, J+30), 3 onglets.
- **Élocution** : exercice du jour préparé par Claude, fait à la voix dans Claude, note qui revient dans l'appli.
- **Mails** : Gmail perso en lecture seule, 20 derniers mails gardés 24 h, envoyés sur le Drive pour le résumé du brief.
- **Base & journal**, **Réglages**.

## Mise en route

1. **Partager le dossier** « Appli Thomas » du Drive OIKOS avec l'adresse Gmail perso de Thomas, en tant qu'éditeur.
2. **Google Cloud** (console.cloud.google.com), avec le compte perso de Thomas : créer un projet, activer « Gmail API » et « Google Drive API », écran de consentement en Externe / mode Test avec son adresse comme utilisateur test, puis un ID client OAuth « Application Web » avec comme origine l'adresse GitHub Pages (`https://TONPSEUDO.github.io`). Coller l'ID dans les Réglages.
3. **GitHub Pages** : dépôt public contenant seulement les fichiers de ce dossier `code-appli` (jamais « document utile »). Settings > Pages > branche `main`, dossier racine.
4. Sur le téléphone : ouvrir l'adresse, « Ajouter à l'écran d'accueil », puis Synchroniser une première fois.

Google affichera « appli non validée » : normal pour une appli perso, cliquer sur Continuer.

## Limites

- Claude répond dans l'appli Claude, pas dans cette appli.
- Le brief est fait à 5h45 avec ce qui est noté à ce moment-là ; pour le refaire, le demander à Claude.
- Les mails du brief sont ceux récupérés à la dernière ouverture de l'appli.
- Tout ce que fait Claude compte dans l'abonnement partagé avec Benjamin.
- Sans réseau, pas de synchro (les ajouts partent à la suivante).
- La limite de vent de la nacelle est celle de la notice : l'appli ne l'invente pas.
- Open-Meteo est gratuit pour un usage non commercial : vérifier leurs conditions pour un usage pro.

## Fichiers

`index.html`, `style.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png`.

## Développement (sur le PC)

- Dossier de travail : `C:\APLI\code-appli` (hors OneDrive). L'ancien dossier OneDrive n'est plus utilisé.
- Les documents de référence sont dans `C:\APLI\document utile` : ils ne vont **jamais** sur GitHub.
- Avant de travailler : lire `CLAUDE.md`, puis la première étape non cochée de `docs/ROADMAP.md`.
- Une seule fois : `npm install` (dans le terminal de VS Code, ouvert dans le dossier).
- Après chaque modification : `npm run check` (contrôle du code + tests). Rien n'est envoyé sur GitHub si ça échoue.
- Chaque étape se vérifie sur le téléphone, pas seulement sur le PC.

