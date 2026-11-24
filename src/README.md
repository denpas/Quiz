# Application QUIZ (multi-enseignant)

Application web pour faire passer des quiz à des étudiants, à partir de questionnaires Excel. Chaque enseignant a son compte, son questionnaire, ses réglages et ses résultats.

## Installation et lancement

Prérequis : [Node.js](https://nodejs.org) version 18 ou plus.

```bash
cd quiz-app
npm install
npm start
```

| Qui | Adresse | Accès |
|---|---|---|
| Super admin | https://localhost:3443/superadmin | mot de passe `SUPERADMIN_PASSWORD` (par défaut `MotDePasseEPSI2026!`, **à changer** dans `.env`) |
| Enseignant | https://localhost:3443/admin | identifiant + mot de passe créés par le super admin |
| Étudiants | https://<adresse-du-serveur>:3443/q/<identifiant-enseignant> | lien affiché (et copiable) dans la zone admin de l'enseignant |

L'adresse racine seule affiche la liste des quiz disponibles. Aucun écran étudiant ne propose d'accès à la zone admin ou au super admin. Les anciennes adresses `http://…:3000` redirigent automatiquement vers HTTPS.

**HTTPS** : au premier démarrage, un certificat auto-signé est créé (`data/certificat/`) ; les navigateurs affichent un avertissement au premier accès (à accepter après avoir vérifié l'empreinte SHA-256 affichée au démarrage). Un certificat du service informatique ou un proxy HTTPS peuvent le remplacer.

**Manuel d'utilisation** (Word, avec captures d'écran et partie installation) : `Manuel_Application_Quiz.docx`.

**Hébergement sur un serveur du réseau** (Linux ou Windows, service de démarrage automatique, pare-feu, certificat, sauvegardes, mise à jour, check-list d'examen) : voir **[INSTALLATION.md](INSTALLATION.md)**.

### Configuration (fichier `.env`)

Copier `.env.example` en `.env` à côté de `server.js` et l'adapter ; redémarrer après chaque modification. Principaux réglages :

| Variable | Rôle | Défaut |
|---|---|---|
| `SUPERADMIN_PASSWORD` | Mot de passe du super admin | `MotDePasseEPSI2026!` (à changer) |
| `PORT` / `HTTPS_PORT` | Port HTTP (redirection) / port HTTPS | `3000` / `3443` |
| `HTTPS` | `auto` (certificat auto-signé) ou `off` (derrière un proxy HTTPS) | `auto` |
| `HTTPS_CERT` / `HTTPS_KEY` | Certificat et clé fournis (PEM), remplacent le mode auto | — |
| `HTTPS_NAMES` | Noms ou IP supplémentaires dans le certificat auto-signé | — |
| `HOST` | `0.0.0.0` (réseau) ou `127.0.0.1` (seulement via un proxy local) | `0.0.0.0` |
| `TRUST_PROXY` | Proxy de confiance (`loopback` ou son IP) | — |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Correction IA (prioritaires sur le réglage du super admin) | — / `claude-sonnet-5-5` |

Les variables d'environnement du système restent prioritaires sur le fichier `.env`.

## Super admin (`/superadmin`)

- **Créer un enseignant** : prénom, nom, identifiant (proposé automatiquement : initiale du prénom + nom) et mot de passe (8 caractères minimum, bouton « Générer »). Le mot de passe s'affiche une fois après la création, pour être transmis à l'enseignant.
- **Modifier** le prénom et le nom, ou **attribuer un nouveau mot de passe** (les sessions ouvertes de l'enseignant sont alors fermées).
- **Désactiver / réactiver** un compte : un compte désactivé ne peut plus se connecter et son lien étudiant ne fonctionne plus.
- **Supprimer** un compte : son questionnaire et ses résultats ne sont pas effacés mais archivés (`data/enseignants/<identifiant>-supprime-<date>` et `resultats/<identifiant>-supprime-<date>`).
- Le tableau indique pour chaque enseignant le questionnaire chargé et le nombre de participations.

Les mots de passe des enseignants sont stockés chiffrés (scrypt avec sel), jamais en clair.

**Correction des questions ouvertes par IA** : saisir la clé API Anthropic (créée sur console.anthropic.com, usage payant) et, si besoin, le modèle, puis « Tester la correction IA ». Sans clé, l'analyse locale est utilisée.

## Enseignant (`/admin`)

Connexion avec identifiant (majuscules indifférentes) et mot de passe. 5 erreurs en 5 minutes bloquent la connexion pendant 1 minute. Le nom de l'enseignant est affiché en haut de l'écran.

1. **Lien étudiant** : affiché en haut, avec un bouton « Copier le lien ».
2. **Charger le questionnaire** : bouton « Téléchargement du questionnaire ». Les anomalies détectées sont signalées.
3. **Éditer le questionnaire** : modifier, ajouter, dupliquer, réordonner ou supprimer des questions ; type, modèle, points, choix (10 max) et bonnes réponses. Les erreurs de saisie sont toutes listées, question par question.
4. **Ordre aléatoire** : case à cocher ; chaque étudiant reçoit un ordre tiré au sort. Le fichier de résultats garde l'ordre du questionnaire.
5. **Résultats** : début, fin, durée, statut, note et fichier `NOM.Prénom.xlsx` de chaque étudiant ; synthèse exportable en `.xlsx` ; bouton « Réautoriser » pour permettre à une adresse de repasser le quiz. Un badge « n à valider » signale les notes proposées non encore validées.
6. **Corriger** (questions ouvertes) : pour chaque réponse, la réponse de l'étudiant et le contenu attendu côte à côte, l'analyse élément par élément (couvert / partiel / absent, extrait de la réponse, justification), les erreurs relevées, l'appréciation, la note proposée et la confiance. L'enseignant valide la note ou l'ajuste (par pas de 0,5), ajoute un commentaire, peut relancer l'analyse IA, ou « Valider toutes les notes proposées ». Le fichier de résultats est mis à jour à chaque validation.
7. **Mot de passe** : bouton en haut de l'écran pour changer son mot de passe.
8. **Page étudiant** : ouvre le quiz de l'enseignant et le déconnecte automatiquement. Toute ouverture d'un écran étudiant (adresse tapée, retour arrière, autre onglet) déconnecte aussi l'enseignant et le super admin dans ce navigateur.

## Étudiants (`/q/<identifiant>`)

- Le nom de l'enseignant est affiché en haut de chaque écran (identification, questions, fin).
- Nom, prénom et email (format vérifié). Une adresse email ne peut lancer le quiz d'un enseignant qu'une fois (elle peut passer le quiz d'un autre enseignant).
- Une question par page, pas de retour arrière ; un rechargement de la page reprend à la question en cours.

## Format du questionnaire (« Quiz parametres.xlsx »)

Bloc **Paramètres** facultatif, au-dessus du tableau des questions :

| Colonne A | B | C |
|---|---|---|
| Paramètres | | |
| Prénom et Nom de l'enseignant | Prénom | Nom |
| Questions dans un ordre aléatoire | Oui / Non | |

« Oui / Non » règle l'option d'ordre aléatoire au chargement du fichier. Le nom affiché aux étudiants est toujours celui du **compte** de l'enseignant ; si le fichier indique un autre nom, un avertissement le signale. Le fichier téléchargé depuis la zone admin reprend le nom du compte et l'option actuelle.

Tableau des questions, colonnes repérées par leur en-tête : `Enoncé`, `Type`, `Modèle`, `Points`, `Choix 1` … `Choix 10`, `Contenu minimum attendu`.

| Type | Modèle | Affichage | Bonne(s) réponse(s) |
|---|---|---|---|
| OUVERTE | Texte | Zone de texte libre | `Contenu minimum attendu` (un point par ligne ou séparé par `;`) |
| FERMEE | Choix multiples | Cases à cocher | Cellules en **gras** |
| FERMEE | Choix unique | Boutons radio | Cellule en **gras** |
| FERMEE | Vrai / Faux | 2 boutons radio Vrai / Faux | L'énoncé est l'affirmation ; Choix 1 = VRAI, Choix 2 = FAUX, la bonne réponse en **gras** |

Le fichier doit être au format `.xlsx`.

## Notation

- Choix unique et Vrai/Faux : tous les points si la bonne réponse est cochée, sinon 0.
- Choix multiples : tous les points uniquement si la sélection correspond exactement aux réponses en gras.
- Questions ouvertes : **note proposée**, à valider par l'enseignant. Le contenu minimum attendu est découpé en éléments (un par ligne) ; chacun est jugé couvert (1), partiel (0,5) ou absent (0). Note proposée = barème × moyenne des éléments − pénalité éventuelle pour erreurs (au plus la moitié du barème), arrondie à 0,5 ; 0 si la réponse est hors sujet.
  - **Analyse IA** (clé API configurée) : Claude juge le **sens** de la réponse — reformulations, synonymes et exemples pertinents acceptés, mot-clé cité sans explication ou à tort non suffisant — relève les erreurs et contresens, détecte le hors-sujet, cite l'extrait qui justifie chaque élément et indique sa confiance. Les instructions éventuellement glissées dans la réponse de l'étudiant sont ignorées.
  - **Analyse locale** (sans clé, ou si l'API est indisponible) : comparaison du vocabulaire (racines des mots, fautes de frappe, mots repris de l'énoncé ignorés, négations repérées), crédit partiel par élément. Elle ne comprend pas le sens : ses notes sont marquées « confiance faible, à vérifier ».
  - Dans le fichier de résultats (colonne R) : statut de la note (proposée / validée / ajustée), commentaire de l'enseignant et analyse détaillée ; la note encore à valider est surlignée en jaune. La synthèse indique les notes restant à valider.

## Données

- `data/enseignants.json` : comptes enseignants (mots de passe chiffrés)
- `data/config.json` : configuration de la correction IA (clé API, modèle)
- `data/enseignants/<identifiant>/` : questionnaire et réglages de chaque enseignant ; `participations/` : un fichier par participation (`archives/` : participations réautorisées, jamais effacées)
- `data/certificat/` : certificat HTTPS auto-signé (clé privée comprise)
- `resultats/<identifiant>/` : fichiers de résultats de chaque enseignant
- `data/ancienne-version-<date>/` : données de la version mono-enseignant, mises de côté automatiquement au premier démarrage de la version 2.0
