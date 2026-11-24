Application QUIZ — prompt de référence (version 2.2)

Ce prompt suffit à régénérer l'application complète depuis zéro, avec les mêmes fonctionnalités.
Fichiers à joindre si possible : « Quiz parametres.xlsx » (format du questionnaire) et « Quiz résultats.xlsx » (format des résultats). Leur format est de toute façon décrit en détail ci-dessous (parties 4 et 8).


0. OBJECTIF

Crée une application web pour exécuter des quiz pour des étudiants, utilisable par plusieurs enseignants.
Elle doit fonctionner sur un Mac, un PC ou un serveur Linux / Windows du réseau de l'école, et être accessible simultanément depuis les portables des étudiants connectés au même réseau (objectif : au moins 150 étudiants en même temps). Toute l'interface, les messages et la documentation sont en français.


1. ARCHITECTURE TECHNIQUE

- Node.js 18 ou plus, lancement par « npm install » puis « npm start » (script start = « node server.js »). Aucune base de données, aucune étape de compilation.
- Dépendances : express (serveur web), exceljs (lecture et écriture des fichiers Excel), multer (envoi de fichiers, en mémoire, 5 Mo maximum), selfsigned (génération du certificat HTTPS sans outil externe, compatible Windows), et jszip (déjà fourni par exceljs) pour réparer certains fichiers Excel.
- Interface en HTML, CSS et JavaScript sans framework, sans aucun script en ligne (compatible avec une politique de sécurité stricte) ; chemins des ressources absolus (/style.css, /app.js…) car les pages sont servies sous /q/<identifiant>, /admin, /superadmin.
- Organisation :
  - server.js : serveur, routes, sessions, stockage, démarrage HTTP / HTTPS ;
  - lib/questionnaire.js : lecture et validation du questionnaire Excel, régénération du fichier questionnaire ;
  - lib/grading.js : notation (questions fermées, analyse IA et analyse locale des questions ouvertes) ;
  - lib/results.js : fichier de résultats par étudiant et synthèse Excel ;
  - lib/https.js : certificats HTTPS ;
  - public/ : index.html + app.js (étudiants), admin.html + admin.js + editor.js + correction.js (enseignants), superadmin.html + superadmin.js, style.css commun ;
  - deploy/ : quiz.service (systemd), sauvegarde.sh, sauvegarde.ps1, Caddyfile.exemple, nginx-quiz.conf.exemple ;
  - .env.example, README.md, INSTALLATION.md, exemple_questionnaire.xlsx, PROMPT_QUIZ.md (ce prompt) ;
  - data/ et resultats/ (créés au démarrage, contiennent toutes les données).
- Un numéro de version (2.2) est commun au serveur et à la page admin : si la page et le serveur n'ont pas la même version (serveur non redémarré après une mise à jour), la zone admin affiche un bandeau avec la marche à suivre.


2. RÔLES, ACCÈS ET SÉCURITÉ

Trois espaces, chacun avec sa propre adresse :
- Super admin : /superadmin, accessible avec le mot de passe « MotDePasseEPSI2026! » par défaut, à remplacer par SUPERADMIN_PASSWORD dans le fichier .env (la documentation insiste pour le changer).
- Zone admin enseignant : /admin, accessible avec un identifiant et un mot de passe créés par le super admin.
- Quiz étudiant : /q/<identifiant de l'enseignant>. L'adresse racine (/) affiche la liste des enseignants actifs qui ont un quiz disponible (un lien par enseignant).

Aucun écran étudiant ne doit proposer de bouton ou de lien vers la zone admin ou le super admin : on n'y accède qu'en tapant leur adresse.

Le passage d'un écran admin à un écran étudiant doit automatiquement déconnecter l'enseignant (et le super admin) dans ce navigateur : bouton « Page étudiant » (qui ouvre le quiz de l'enseignant), adresse tapée, retour arrière du navigateur (y compris page restaurée depuis le cache), autre onglet. Toute page étudiante appelle la déconnexion à son ouverture.

Le nom de l'enseignant (prénom NOM, celui de son compte, nom en majuscules) est affiché en haut de chaque écran : sur tous les écrans du quiz (identification, questions, fin) et dans la zone admin une fois connecté.

Chaque enseignant a ses propres données, invisibles des autres : questionnaire, réglages, participations et résultats.

Sécurité :
- Mots de passe des enseignants stockés chiffrés (scrypt avec sel aléatoire de 16 octets), jamais en clair ; comparaisons en temps constant.
- Après 5 échecs de connexion en 5 minutes depuis un même appareil, blocage d'une minute avec le temps d'attente affiché.
- Enseignant : même message « Identifiant ou mot de passe incorrect » que l'identifiant soit inconnu ou le mot de passe faux ; identifiant insensible aux majuscules ; compte désactivé : message dédié.
- Sessions par cookie HttpOnly, SameSite=Strict, Secure en HTTPS, jeton aléatoire de 32 octets, durée 8 h, conservées en mémoire (un redémarrage du serveur déconnecte les enseignants, pas les étudiants).
- Les bonnes réponses et le nombre de points ne sont jamais envoyés au navigateur de l'étudiant.
- En-têtes de sécurité sur toutes les réponses : Content-Security-Policy « default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' », X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy no-referrer, et Strict-Transport-Security avec un certificat fourni.
- Pages et scripts servis avec « Cache-Control: no-cache » (toujours la version présente sur le disque) ; erreurs du serveur toujours renvoyées en JSON avec un message explicite en français.


3. SUPER ADMIN (/superadmin)

- Créer un enseignant : prénom, nom, identifiant (login) et mot de passe.
  - L'identifiant est proposé automatiquement (initiale du prénom + nom, sans accent, ex. « pdenicou ») ; 3 à 32 caractères : minuscules sans accent, chiffres, point, tiret ou souligné, commençant par une lettre ou un chiffre (il apparaît dans le lien étudiant). Il doit être unique.
  - Mot de passe de 8 caractères minimum, avec un bouton « Générer » (10 caractères lisibles, sans caractères ambigus). Il est affiché une fois après la création pour être transmis à l'enseignant.
  - Toutes les erreurs de saisie sont affichées ensemble.
- Tableau des enseignants : nom, identifiant, date de création, questionnaire chargé (nom du fichier et nombre de questions), nombre de participations, statut (Actif / Désactivé).
- Modifier le prénom et le nom, attribuer un nouveau mot de passe (les sessions ouvertes de l'enseignant sont alors fermées).
- Désactiver / réactiver un compte : un compte désactivé ne peut plus se connecter, ses sessions sont fermées et son lien étudiant ne fonctionne plus.
- Supprimer un compte (avec confirmation) : son questionnaire, ses participations et ses résultats ne sont pas effacés mais archivés (dossiers renommés « <identifiant>-supprime-<date> »), ce qui libère l'identifiant.
- Configurer la correction IA des questions ouvertes : clé API Anthropic (affichée masquée, contrôlée au format « sk-ant- »), modèle (par défaut claude-sonnet-5-5), bouton « Tester la correction IA » (note une réponse d'exemple et affiche le résultat, ou la cause de l'échec en français), suppression de la clé. Une variable d'environnement ANTHROPIC_API_KEY reste prioritaire (l'écran indique la source de la clé).


4. FORMAT DU QUESTIONNAIRE (fichier « Quiz parametres.xlsx »)

Le fichier commence par un bloc « Paramètres » facultatif :
- ligne 1 : « Paramètres » ;
- ligne 2 : « Prénom et Nom de l'enseignant » en colonne A, prénom en colonne B, nom en colonne C. Le nom affiché reste celui du compte ; si le fichier indique un autre nom, un avertissement le signale au chargement ;
- ligne 3 : « Questions dans un ordre aléatoire » en colonne A, Oui / Non en colonne B (Oui, O, Vrai, True, 1, X acceptés). Cette valeur règle l'option d'ordre aléatoire au chargement du fichier ; une valeur non reconnue est signalée.

Vient ensuite la liste des questions, à partir de la ligne d'en-tête qui contient « Enoncé » (recherchée dans les 20 premières lignes ; ligne 5 dans le modèle). Les colonnes sont repérées par leur en-tête, sans tenir compte des accents ni des majuscules : Enoncé, Type, Modèle, Points, Choix 1 à Choix 10, Contenu minimum attendu. Un fichier sans bloc Paramètres (ancien format, en-tête en ligne 1) reste accepté. Seule la première feuille est lue (une feuille de notes peut suivre). Les lignes vides sont ignorées.

Chaque question a un type :
- Question ouverte (Type OUVERTE, Modèle Texte) = un texte à saisir dans une zone de texte. Le « Contenu minimum attendu » liste les points qui doivent être abordés (un par ligne).
- Question fermée (Type FERMEE ou FERMÉE) :
  - Modèle Choix multiples = plusieurs choix possibles dans la liste des choix proposés pouvant aller jusqu'à 10 choix. Les choix valides sont en gras.
  - Modèle Choix unique = un seul choix possible dans la liste des choix proposés pouvant aller jusqu'à 10 choix. Le choix valide est en gras.
  - Modèle Vrai / Faux = l'énoncé est l'affirmation ; Choix 1 = VRAI et Choix 2 = FAUX (valeurs booléennes Excel ou textes « Vrai » / « Faux »), la bonne réponse est en gras. Si une seule cellule est renseignée : en gras = vrai, sinon faux.

Pour chaque question le nombre de points est indiqué dans la colonne « Points » (nombre décimal accepté, virgule ou point).

Lecture du fichier :
- Une cellule est « en gras » si sa police est en gras, ou si une partie non vide de son texte enrichi est en gras. Les espaces en début et fin de texte sont retirés.
- Seul le format .xlsx est accepté (message demandant de réenregistrer un ancien .xls).
- Lecture tolérante : certains outils (LibreOffice, scripts, enregistrements hors Excel) écrivent des liens internes absolus (« /xl/tables/… ») ou des « tableaux » Excel que la bibliothèque ne relit pas. En cas d'échec, corriger le fichier en mémoire (liens rendus relatifs, puis en dernier recours retrait de la mise en forme de tableau, les données restant intactes) et réessayer ; sinon message clair demandant de réenregistrer le fichier depuis Excel.
- Au chargement, les anomalies sont signalées sans bloquer : choix unique sans réponse ou avec plusieurs réponses en gras, choix multiples sans réponse en gras, moins de 2 choix, question ouverte sans contenu attendu, points invalides (1 point retenu), type ou modèle non reconnu (ligne ignorée), énoncé vide (ligne ignorée). Un fichier sans aucune question exploitable est refusé.


5. ZONE ADMIN ENSEIGNANT (/admin)

- En haut de l'écran : nom de l'enseignant, boutons « Page étudiant », « Mot de passe », « Se déconnecter ».
- Le lien à donner aux étudiants (adresse actuelle + /q/<identifiant>) est affiché en haut avec un bouton « Copier le lien ». Si l'enseignant est connecté via « localhost », un message rappelle de le remplacer par l'adresse IP de l'ordinateur.
- Bouton « Téléchargement du questionnaire » : sélection d'un fichier questionnaire .xlsx sur le disque local et enregistrement dans l'espace de l'enseignant. Un message confirme le nombre de questions et le réglage d'ordre aléatoire lu dans le fichier, et liste les points à vérifier.
- Informations : nom du fichier, date de chargement et de dernière modification, nombre de questions, total des points.
- Bouton « Télécharger le fichier actuel » : le questionnaire est régénéré à la demande au format « Quiz parametres » (bloc Paramètres avec le nom du compte et l'option d'ordre aléatoire actuelle, en-tête en ligne 5, bonnes réponses en gras, Vrai / Faux en VRAI / FAUX).
- Bouton « Afficher / masquer les questions » : aperçu des questions (type, points) avec les bonnes réponses en évidence et le contenu attendu des questions ouvertes.
- Case « Proposer les questions dans un ordre aléatoire » : un ordre différent est tiré au sort (mélange cryptographique) pour chaque étudiant au lancement de son quiz. Le réglage est mémorisé par enseignant. Le fichier de résultats conserve l'ordre du questionnaire.
- Bouton « Editer le questionnaire » (ou « Créer un questionnaire » s'il n'y en a pas) :
  - créer une nouvelle question (par défaut : choix unique, 1 point, 4 choix vides), modifier, dupliquer, monter / descendre et supprimer (avec confirmation) les questions existantes ;
  - pour chaque question : énoncé, Type (Ouverte / Fermée), Modèle (Texte pour une question ouverte ; Choix multiples, Choix unique ou Vrai / Faux pour une question fermée), points (par pas de 0,5) ;
  - choix : de 2 à 10, ajout et retrait, avec une case « juste » (cases à cocher pour les choix multiples, boutons radio pour le choix unique), le texte des bonnes réponses apparaissant en gras ; Vrai / Faux : sélection de la bonne réponse ; question ouverte : contenu minimum attendu (un élément par ligne) ;
  - compteur de questions et de points, mention des modifications non enregistrées, avertissement si l'on quitte avec des modifications non enregistrées, bouton « Annuler » avec confirmation ;
  - à l'enregistrement, le serveur valide tout et renvoie toutes les erreurs : elles sont listées en une fois en haut de l'éditeur (cliquables pour atteindre la question) et rappelées dans chaque question avec le champ concerné encadré en rouge ; une erreur disparaît dès que la question est modifiée. Erreurs contrôlées : énoncé vide ou trop long, points vides / négatifs / non numériques / supérieurs à 1000, modèle invalide, moins de 2 ou plus de 10 choix, choix en double, choix coché juste mais vide, aucune bonne réponse, plusieurs bonnes réponses pour un choix unique, Vrai / Faux sans réponse, question ouverte sans contenu attendu ;
  - les problèmes techniques sont expliqués avec la marche à suivre (serveur injoignable, session expirée, serveur à redémarrer après mise à jour, données trop volumineuses, écriture impossible sur le disque), sans perdre les modifications en cours ;
  - le fichier Excel du questionnaire est régénéré à l'enregistrement.
- Les quiz déjà commencés gardent la version du questionnaire et l'ordre qu'ils avaient au lancement (copie figée dans chaque participation).
- Tableau des résultats (plus récents en premier) : étudiant, email, début, fin (heure de fin), durée (« 12 min 34 s » ou « 1 h 05 min »), statut (En cours, Correction…, Terminé, Erreur), note obtenue / note maximale avec un badge « n à valider » tant que des notes proposées ne sont pas validées, lien de téléchargement du fichier de résultats, bouton « Corriger » (ou « Revoir » si tout est validé) pour les quiz terminés comportant des questions ouvertes, et bouton « Réautoriser » (avec confirmation) pour permettre à une adresse de repasser le quiz : la participation est archivée, jamais effacée, et le fichier déjà produit est conservé (le suivant prendra le suffixe « (2) »). Boutons « Actualiser » et « Exporter la synthèse (.xlsx) » (une ligne par étudiant : nom, prénom, email, début, fin, durée, statut, état de la correction, points obtenus, points max, fichier).
- Écran « Corriger » (fenêtre large, en-tête et pied fixes) : pour chaque question ouverte, l'énoncé, la réponse de l'étudiant et le contenu minimum attendu côte à côte, le tableau d'analyse élément par élément (élément attendu, statut couvert / partiel / absent, extrait de la réponse entre guillemets, justification), les erreurs relevées, le hors-sujet éventuel, l'appréciation, la méthode (IA ou analyse locale) et la confiance, la cause d'un échec de l'IA, la note proposée. L'enseignant valide la note ou l'ajuste (0 à barème, par pas de 0,5) avec un commentaire facultatif, peut relancer l'analyse IA (la note redevient « proposée »), ou valider d'un coup toutes les notes proposées. Le total et le nombre de notes restant à valider sont affichés. Le fichier de résultats est régénéré à chaque validation.
- Fenêtre « Mot de passe » : mot de passe actuel, nouveau (8 caractères minimum), confirmation.
- Le script de la page doit rester utilisable même si la page et le script ne sont pas de la même version (événements branchés seulement si l'élément existe, connexion toujours fonctionnelle).


6. DÉROULEMENT DU QUIZ CÔTÉ ÉTUDIANT (/q/<identifiant>)

Le premier écran doit présenter des champs de saisie permettant de saisir le nom, le prénom et l'adresse email de l'étudiant.
Il ne doit pas être possible d'entrer autre chose qu'une adresse email dans le champ email (vérification en direct, espaces refusés, message d'aide, bouton « Commencer le quiz » inactif tant que le formulaire n'est pas valide, contrôle refait côté serveur).
Il ne doit pas être possible de lancer le quiz d'un enseignant plus d'une fois par adresse email (adresse comparée en minuscules ; une même adresse peut passer les quiz de plusieurs enseignants).
Le nom est enregistré en majuscules et le prénom avec une majuscule initiale.
Si aucun questionnaire n'est chargé : message « Aucun quiz n'est disponible pour le moment. Merci de patienter : l'enseignant va le mettre en ligne. ». Si l'identifiant est inconnu ou le compte désactivé : message demandant de vérifier le lien fourni par l'enseignant.

Le quiz doit présenter une question par page avec un bouton « Suivant » (« Terminer le quiz » pour la dernière) mais l'impossibilité de faire marche arrière : l'ordre est imposé par le serveur, qui n'accepte une réponse que pour la question courante ; le bouton « précédent » du navigateur ne permet pas de revenir ; un rechargement de la page reprend à la question en cours (jeton de quiz conservé dans le stockage de session du navigateur, propre à chaque enseignant). Une barre de progression indique « Question n / total ». Une consigne courte indique « Plusieurs réponses possibles », « Une seule réponse possible », « Vrai ou faux ? » ou « Rédigez votre réponse ». Une confirmation est demandée si l'étudiant passe une question sans répondre, et un avertissement s'affiche s'il tente de quitter la page pendant le quiz. Réponse ouverte limitée à 20 000 caractères.

Les questions à choix multiples doivent apparaître sous la forme de la proposition avec en dessous un choix par ligne avec une checkbox.
Les questions à choix uniques doivent apparaître sous la forme de la proposition avec en dessous un choix par ligne avec des boutons radio exclusifs.
Les questions Vrai/Faux doivent apparaître sous la forme de la proposition avec en dessous un choix vrai / faux matérialisé par 2 boutons radios (côte à côte).
Les questions ouvertes doivent apparaître sous la forme de la proposition avec en dessous une boîte de texte libre utilisant le reste de l'espace disponible.
Les énoncés longs (étude de cas sur plusieurs paragraphes) conservent leurs retours à la ligne.

Le nombre de points de la question ne doit pas être affiché. La note n'est pas montrée à l'étudiant : l'écran final « Merci ! » indique seulement que ses réponses ont été enregistrées.


7. INTERFACE

- Sobre et lisible, sans bibliothèque externe ni police à télécharger (police système) : fond #f5f4f0, cartes blanches à bord fin et coins arrondis, couleur d'accent bleu foncé #23466b, vert pour les réussites, rouge pour les erreurs, jaune pour les avertissements.
- Barre d'en-tête : « Application QUIZ » (QUIZ en couleur d'accent), suffixé « · Zone admin » ou « · Super admin », et à droite le nom de l'enseignant et les boutons.
- Utilisable sur un écran de portable comme sur un petit écran (mise en page qui s'adapte).
- Pied de page discret sur tous les écrans (étudiants, zone admin, super admin) : « Powered by » suivi du logo 3D TPMH (image fournie, fond transparent, recadrée ; fichiers public/img/logo-3dtpmh.png et logo-3dtpmh-56.png affichée à 28 px de haut), texte gris 0,72 rem, ensemble à 55 % d'opacité (90 % au survol).


8. RÉSULTATS

Une fois validée la dernière question, un résumé des résultats doit être stocké sous la forme d'un fichier Excel (xlsx) par candidat, au format fourni dans le fichier « Quiz résultats.xlsx », et accessible dans la zone admin de l'enseignant concerné.
Le nom du fichier sera le nom de famille du candidat (en majuscules) suivi d'un point suivi du prénom du candidat avec l'extension xlsx (ex. DURAND.Etienne.xlsx) ; caractères interdits retirés, espaces remplacés par des tirets ; suffixe « (2) », « (3) »… si le fichier existe déjà.

Format exact (feuille « Feuil1 », police Aptos Narrow 12) :
- A1 « ETUDIANT » (taille 18, gras) ; A2 nom, B2 prénom, D2 email ;
- A4 « RESULTATS » (taille 18, gras) ;
- ligne 5, en-têtes : Enoncé, Points obtenus, Type, Modèle, Points, Choix 1, « Choix  2 » (avec deux espaces, comme dans le modèle), Choix 3 à Choix 10, Contenu minimum attendu, puis deux colonnes ajoutées : Réponse de l'étudiant (Q) et Commentaire de correction (R) ;
- à partir de la ligne 6, une ligne par question dans l'ordre du questionnaire : énoncé, points obtenus, type, modèle, points ; pour les questions fermées, les choix en colonnes F à O, bonnes réponses en gras, choix de l'étudiant préfixés par « X » (Vrai / Faux écrits « Vrai » et « Faux ») ; pour les questions ouvertes, contenu minimum attendu (P), réponse de l'étudiant (Q) et commentaire (R) : statut de la note (« NOTE PROPOSÉE, à valider par l'enseignant », « Note validée par l'enseignant » ou « Note ajustée par l'enseignant (proposée : x) »), commentaire de l'enseignant, analyse détaillée (note proposée, méthode, confiance, éléments couverts / partiels / absents, erreurs, appréciation, cause d'un échec de l'IA) ; la cellule « Points obtenus » d'une note encore à valider est surlignée en jaune ;
- texte renvoyé à la ligne, alignement en haut, largeurs de colonnes reprises du modèle ;
- ligne « Total » après deux lignes vides suivant la dernière question (en gras), avec des formules SUM sur les points obtenus (B) et les points (E), valeurs calculées incluses.


9. NOTATION

Tu dois donner les points par question en prenant en compte la ou les réponses justes qui sont en gras dans le fichier de paramètres.
- Choix unique et Vrai / Faux : tous les points si la bonne réponse est choisie, sinon 0.
- Pour les questions à réponses multiples, les points sont attribués seulement si la réponse de l'étudiant est exacte (toute la sélection correspond aux réponses attendues en gras dans le fichier des paramètres).
- Tu dois évaluer la pertinence des réponses aux questions ouvertes en comparant le texte rempli par l'étudiant avec le contenu minimum attendu rédigé dans le fichier des paramètres, et faire une PROPOSITION DE NOTATION que l'enseignant valide ou ajuste. Ne te limite pas à la présence de mots-clés.

Questions ouvertes :
- Le contenu attendu est découpé en éléments : un par ligne, puce, numéro ou « ; » (à défaut, par virgule). Chaque élément est jugé « couvert » (1), « partiel » (0,5) ou « absent » (0), avec l'extrait de la réponse qui le justifie et une justification.
- Note proposée = barème × moyenne des éléments − pénalité pour erreurs ou contresens (au plus la moitié du barème), arrondie à 0,5, entre 0 et le barème ; 0 si hors sujet ; 0 et note directement validée si la réponse est vide.
- Analyse par IA (Claude, via l'API Messages d'Anthropic) si une clé est configurée :
  - requête : modèle configuré, température 0, 2000 jetons maximum, en-tête anthropic-version 2023-06-01, délai maximal 45 s, adresse de l'API remplaçable par ANTHROPIC_BASE_URL (pour les tests) ;
  - sortie structurée par appel d'outil obligatoire « noter_reponse » : criteres (numero, statut couvert / partiel / absent, citation exacte, justification), erreurs (extrait, explication), penalite, hors_sujet, confiance (haute / moyenne / faible), appreciation (1 à 3 phrases pour l'enseignant) ;
  - consignes : évaluer le SENS (reformulations, synonymes, exemples pertinents acceptés ; mot-clé cité sans explication ou à tort non suffisant), ne pas tenir compte de l'orthographe ni du style sauf incompréhension, relever les erreurs, détecter le hors-sujet ; la réponse de l'étudiant est placée entre balises et toute instruction qu'elle contient est ignorée ;
  - la note est recalculée par le serveur à partir des critères (et non reprise telle quelle).
- Sinon, ou si l'IA échoue, analyse locale, et la cause de l'échec est expliquée en français : clé refusée (401), accès refusé (403), modèle introuvable (404), requête refusée (400), limite d'utilisation atteinte (429), service indisponible ou surchargé (500, 503, 529), délai dépassé, API injoignable (pas d'accès Internet).
- Analyse locale (sans IA) :
  - mots normalisés sans accents, mots vides français ignorés, racine des mots (suffixes courants retirés, 8 caractères au plus) ;
  - deux mots correspondent si leurs racines sont égales ou l'une est le préfixe de l'autre (4 caractères au moins), ou, pour les mots de 5 lettres ou plus, si leurs trigrammes se ressemblent à au moins 50 % (fautes de frappe) ;
  - les mots repris de l'énoncé sont ignorés s'il reste d'autres notions à vérifier dans l'élément ;
  - élément couvert si au moins 60 % de ses notions sont retrouvées, partiel à partir de 30 % (et au moins une notion), absent sinon ;
  - citation = phrase de la réponse qui correspond le mieux (phrases découpées sur . ! ? ; mais pas sur les deux-points, pour ne pas couper une énumération) ; si une négation (ne, n', pas, jamais, aucun, rien, sans, ni, non) précède une notion retrouvée dans les 3 mots, l'élément couvert devient partiel avec la mention « formulation négative, sens à vérifier » (sauf si l'élément attendu est lui-même négatif) ;
  - confiance toujours « faible », appréciation « À vérifier : analyse locale, fondée sur le vocabulaire et non sur le sens… », mention « Réponse très courte » en dessous de 6 mots.
- Toute note de question ouverte non vide est « proposée » jusqu'à validation par l'enseignant.


10. RÉSEAU, HTTPS ET CONFIGURATION

Configuration par un fichier « .env » à côté de server.js (lu au démarrage par un petit analyseur intégré, lignes NOM=valeur, commentaires #, guillemets acceptés ; modèle « .env.example » entièrement commenté). Les variables d'environnement du système restent prioritaires. Réglages :
- SUPERADMIN_PASSWORD ;
- PORT (HTTP, 3000 par défaut) et HTTPS_PORT (3443 par défaut) ;
- HTTPS = auto (par défaut) ou off ; HTTPS_CERT et HTTPS_KEY (certificat fourni, prioritaire sur auto) ; HTTPS_NAMES (noms ou IP supplémentaires pour le certificat auto-signé) ;
- HOST (adresse d'écoute : 0.0.0.0 par défaut = accessible depuis le réseau ; 127.0.0.1 = seulement depuis le serveur, en mode proxy) ;
- TRUST_PROXY (loopback ou adresse du proxy) ;
- ANTHROPIC_API_KEY, ANTHROPIC_MODEL.

HTTPS obligatoire pour que les mots de passe ne circulent pas en clair :
- par défaut, certificat auto-signé généré au premier démarrage dans data/certificat/ (cert.pem, key.pem en accès restreint, cert-info.json), incluant localhost, le nom de la machine (s'il est un nom DNS valide) et toutes ses adresses IPv4 ; sujet en ASCII uniquement (un accent rend le certificat invalide pour Chrome : ERR_SSL_SERVER_CERT_BAD_FORMAT) ; RSA 2048 / SHA-256, usage serveur ; validité 397 jours (au-delà de 825 jours, Apple refuse) ; régénération automatique si une adresse change, à 30 jours de l'expiration ou si le format de génération évolue ; empreinte SHA-256 affichée au démarrage ; certificat public téléchargeable à l'adresse /certificat pour le déployer comme certificat de confiance sur les postes ;
- ou certificat fourni par le service informatique (fichiers PEM, contrôlés au démarrage : présence, correspondance clé / certificat, expiration), avec HSTS ;
- ou mode proxy (HTTPS=off, HOST=127.0.0.1, TRUST_PROXY) : HTTPS assuré par Caddy, nginx ou IIS ; l'adresse réelle de chaque portable sert au blocage des mauvais mots de passe ; cookies Secure si le proxy signale HTTPS ;
- en mode HTTPS, le port HTTP redirige (308) vers la même adresse en HTTPS (les anciens liens http:// continuent de marcher) ;
- au démarrage : adresses super admin, enseignants et étudiants (avec les adresses IP du réseau), nombre de comptes, mode de correction des questions ouvertes, mode HTTPS et empreinte ; messages clairs si le port est déjà utilisé, si le port est réservé (inférieur à 1024) ou si le certificat est invalide ; avertissement si HTTPS est désactivé sans proxy.


11. STOCKAGE DES DONNÉES

- Tout est dans des fichiers JSON, en écriture atomique (fichier temporaire puis renommage) :
  - data/enseignants.json : comptes enseignants ;
  - data/config.json : configuration de la correction IA ;
  - data/enseignants/<identifiant>/questionnaire.json, questionnaire.xlsx (fichier d'origine ou régénéré) et reglages.json ;
  - data/enseignants/<identifiant>/participations/<empreinte SHA-256 de l'email>.json : un fichier par participation (JSON compact), pour que chaque réponse ne réécrive que le fichier de l'étudiant concerné ; participations/archives/ : participations réautorisées ;
  - resultats/<identifiant>/ : fichiers de résultats.
- Une participation contient : identité, dates, statut, copie figée du questionnaire, ordre tiré au sort, question courante, réponses (rangées dans l'ordre du questionnaire), notes et analyses, jeton de quiz (24 octets aléatoires, transmis dans l'en-tête x-quiz-token). Les participations sont chargées en mémoire au premier accès, avec un index jeton → participation.
- Conversions automatiques : un ancien fichier unique participations.json est éclaté en fichiers individuels (l'ancien est conservé, renommé) ; les données d'une version mono-enseignant (questionnaire.json, participations.json, reglages.json, résultats à la racine) sont déplacées dans data/ancienne-version-<date>/.
- Performances attendues (mesurées) : 150 étudiants simultanés sur un quiz de 39 questions sans erreur, temps de réponse médian inférieur à 0,1 s.


12. ADRESSES DU SERVEUR (API JSON)

- Pages : / et /q/<identifiant> (index.html), /admin, /superadmin, /certificat (en HTTPS auto ou fichiers), /api/version.
- Super admin : POST /api/super/login, POST /api/super/logout, GET /api/super/me ; GET et POST /api/super/teachers ; PUT et DELETE /api/super/teachers/<identifiant> (prénom, nom, mot de passe, actif) ; GET et PUT /api/super/ai, POST /api/super/ai/test.
- Enseignant : POST /api/admin/login (login, password), POST /api/admin/logout (ferme aussi la session super admin), GET /api/admin/me (enseignant et disponibilité de l'IA), PUT /api/admin/password ; GET et PUT /api/admin/settings ; POST (fichier), GET et PUT (questions validées) /api/admin/questionnaire, GET /api/admin/questionnaire/file ; GET /api/admin/results, GET /api/admin/results/file/<nom>, GET /api/admin/results/synthese.xlsx ; GET et DELETE /api/admin/attempts/<email> ; PUT /api/admin/attempts/<email>/grades/<n> (note, commentaire), POST /api/admin/attempts/<email>/grades/<n>/regrade, POST /api/admin/attempts/<email>/validate-all.
- Étudiants : GET /api/teachers ; GET /api/t/<identifiant>/status ; POST /api/t/<identifiant>/quiz/start ; GET /api/t/<identifiant>/quiz/current ; POST /api/t/<identifiant>/quiz/answer (index de la question courante + réponse ; 409 si ce n'est pas la question courante).


13. LIVRABLES

- Le code complet, prêt à lancer.
- README.md en français : installation, adresses, rôles, configuration .env, HTTPS, format du questionnaire, notation, correction, données.
- INSTALLATION.md, fiche pas à pas pour héberger l'application sur un serveur du réseau :
  - prérequis, ports, adresses, capacité ;
  - choix du mode HTTPS (auto-signé, certificat du service informatique, proxy) avec avantages et inconvénients ;
  - serveur Linux (Ubuntu / Debian) : Node.js, copie dans /opt/quiz-app, npm install sur le serveur (jamais de node_modules copié d'une autre machine), .env, compte système dédié « quiz », premier lancement, service systemd, pare-feu (ufw / firewalld), port 443 ;
  - serveur Windows : Node.js LTS, C:\quiz-app, .env, pare-feu (New-NetFirewallRule), service avec NSSM, journal ;
  - Mac en usage ponctuel ;
  - vérifications réseau avec le service informatique (isolation des clients Wi-Fi, adresse IP fixe ou nom DNS, accès sortant à l'API) ;
  - premier démarrage (comptes, clé IA) ;
  - avertissement de certificat côté étudiants : manipulation par navigateur (Chrome / Edge, Firefox, Safari), vérification de l'empreinte, suppression de l'avertissement par déploiement de /certificat ou certificat du service informatique ;
  - sauvegardes (quoi, scripts, planification cron et Planificateur de tâches, données personnelles à protéger), restauration, mise à jour ;
  - check-list le jour de l'examen et tableau de dépannage.
- deploy/quiz.service : service systemd durci (utilisateur quiz, redémarrage automatique, CAP_NET_BIND_SERVICE pour les ports 80 / 443, NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp, écriture limitée à data/ et resultats/).
- deploy/sauvegarde.sh (archive datée tar.gz de data/, resultats/ et .env, droits restreints, 30 dernières conservées) et deploy/sauvegarde.ps1 (équivalent Windows en .zip).
- deploy/Caddyfile.exemple et deploy/nginx-quiz.conf.exemple (proxy HTTPS, redirection 80 → 443, taille d'envoi 10 Mo, délai 90 s pour la correction IA).
- .env.example commenté, exemple_questionnaire.xlsx au format ci-dessus (sans nom d'enseignant), et ce prompt (PROMPT_QUIZ.md).
- Manuel_Application_Quiz.docx : manuel d'utilisation Word d'aspect professionnel (A4, environ 30 pages) : couverture (titre, sous-titre, aperçu de la zone admin, version, date, public, « Powered by » + logo), sommaire paginé avec liens, en-tête et pied de page (titre, « Powered by » + logo, « Page n sur N »), chapitres Présentation, Installation (prérequis, modes HTTPS, poste, Linux, Windows, réseau, .env, premier démarrage, avertissement de certificat, sauvegardes, mise à jour), Super administrateur, Enseignant, Étudiant, Notation, Check-list, Dépannage, Annexes ; captures d'écran légendées de chaque écran (réalisées sur des données de démonstration), tableaux de référence numérotés, encadrés « Important », « Conseil », « À savoir ».


14. TESTS AVANT LIVRAISON

Tester l'ensemble dans un navigateur (Chromium) et par scripts :
- super admin : connexion, création de deux enseignants, erreurs de création, modification, nouveau mot de passe, désactivation, suppression avec archivage, configuration et test de l'IA ;
- enseignants : connexion, nom affiché, chargement du questionnaire fourni (y compris un fichier réenregistré hors Excel avec un « tableau »), édition avec erreurs puis enregistrement, ordre aléatoire, téléchargement du fichier, isolation des données entre enseignants, changement de mot de passe, déconnexion automatique en passant à l'écran étudiant ;
- étudiants : choix de l'enseignant, validation de l'email, passage complet, impossibilité de revenir en arrière, reprise après rechargement, refus d'un second passage, même adresse acceptée chez un autre enseignant, lien inconnu ;
- résultats : contenu exact du fichier Excel, synthèse ;
- correction des questions ouvertes : avec une API simulée si aucune clé n'est disponible (vérifier le format de la requête), validation, ajustement, relance, tout valider, repli sur l'analyse locale en cas d'échec, contrôle du barème ;
- HTTPS : redirection, cookies Secure, en-têtes, certificat accepté par Chromium (avertissement standard d'autorité inconnue, pas d'erreur de format), certificat fourni et ses erreurs, mode proxy (cookie Secure, blocage par appareil), écoute limitée à 127.0.0.1 ;
- parcours complet en HTTPS avec la politique de sécurité active, sans aucune violation ni erreur JavaScript ;
- conversion des anciennes données et archivage lors d'une réautorisation ;
- charge : au moins 150 étudiants simultanés sur un quiz d'une quarantaine de questions, sans erreur.
