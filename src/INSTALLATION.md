# Installer l'Application Quiz sur un serveur du réseau

Fiche pas à pas pour héberger l'application sur un serveur de l'école (Linux ou Windows) et la rendre accessible aux portables des étudiants connectés au même réseau.

---

## 0. En bref

- **Ce qu'il faut** : une machine allumée pendant les examens (serveur, PC ou Mac), avec [Node.js](https://nodejs.org) version 18 ou plus (version « LTS » recommandée), sur le même réseau que les portables des étudiants.
- **Ports utilisés** : `3443` (HTTPS) et `3000` (redirige vers HTTPS). Ils se changent dans le fichier `.env`.
- **Adresses** :

| Qui | Adresse |
|---|---|
| Super admin | `https://<serveur>:3443/superadmin` |
| Enseignants | `https://<serveur>:3443/admin` |
| Étudiants | `https://<serveur>:3443/q/<identifiant-enseignant>` (lien affiché dans la zone admin) |

`<serveur>` est l'adresse IP du serveur (ex. `192.168.10.20`) ou son nom sur le réseau (ex. `quiz.ecole.local`). Les adresses exactes s'affichent au démarrage de l'application.

- **Données** : tout est enregistré dans les dossiers `data/` et `resultats/` de l'application (aucune base de données à installer). Ce sont les deux dossiers à sauvegarder.
- **Capacité testée** : 150 étudiants passant simultanément un quiz de 39 questions, sans erreur, temps de réponse médian inférieur à 0,1 seconde.

---

## 1. Choisir le mode HTTPS

Le HTTPS chiffre les échanges : sans lui, les mots de passe des enseignants circulent en clair sur le réseau et peuvent être interceptés. Trois possibilités :

| Mode | Réglage dans `.env` | Avantages | Inconvénients |
|---|---|---|---|
| **A. Certificat auto-signé** (par défaut) | `HTTPS=auto` | Rien à faire : créé automatiquement au premier démarrage. | Avertissement du navigateur au premier accès sur chaque portable, sauf si le certificat est installé sur les postes (voir § 7). |
| **B. Certificat du service informatique** | `HTTPS_CERT=…` et `HTTPS_KEY=…` | Aucun avertissement. | Demander un certificat au service informatique pour le nom du serveur. |
| **C. Proxy HTTPS existant** (Caddy, nginx, IIS) | `HTTPS=off`, `HOST=127.0.0.1`, `TRUST_PROXY=loopback` | S'intègre à l'infrastructure existante, port 443 standard. | Configuration du proxy (exemples fournis dans `deploy/`). |

Pour un premier essai, le mode A suffit. Pour un usage régulier, le mode B est le plus confortable.

---

## 2. Serveur Linux (Ubuntu / Debian)

Les commandes sont à taper dans un terminal sur le serveur. `sudo` demande le mot de passe administrateur.

### 2.1 Installer Node.js

```bash
node -v        # si la version affichée est 18 ou plus, passer à 2.2
sudo apt update && sudo apt install -y nodejs npm
node -v        # vérifier : 18 ou plus (sinon, installer la version LTS depuis nodejs.org/fr/download)
```

### 2.2 Copier l'application

Copier `quiz-app.zip` sur le serveur (clé USB, `scp`, partage réseau), puis :

```bash
sudo apt install -y unzip
sudo unzip quiz-app.zip -d /opt          # crée /opt/quiz-app
cd /opt/quiz-app
sudo npm install --omit=dev              # télécharge les bibliothèques (accès Internet nécessaire une fois)
```

Ne pas copier le dossier `node_modules` d'un autre ordinateur (Mac → Linux) : toujours lancer `npm install` sur le serveur.

### 2.3 Configurer

```bash
sudo cp .env.example .env
sudo nano .env                            # Ctrl+O pour enregistrer, Ctrl+X pour quitter
```

**À faire impérativement** : remplacer `SUPERADMIN_PASSWORD` par un mot de passe long et unique (le mot de passe par défaut est connu). Pour le mode B ou C, renseigner les lignes correspondantes (voir § 1).

### 2.4 Créer un compte dédié (l'application ne tourne pas en administrateur)

```bash
sudo useradd --system --home /opt/quiz-app --shell /usr/sbin/nologin quiz
sudo chown -R quiz:quiz /opt/quiz-app/data /opt/quiz-app/resultats
sudo chown root:quiz /opt/quiz-app/.env && sudo chmod 640 /opt/quiz-app/.env
```

### 2.5 Premier lancement (test)

```bash
sudo -u quiz node /opt/quiz-app/src/server.js
```

L'écran affiche les adresses et l'**empreinte SHA-256** du certificat (à noter, voir § 7). Ouvrir l'adresse « Étudiants » depuis un portable pour vérifier l'accès, puis arrêter avec `Ctrl+C`.

### 2.6 Démarrage automatique (service)

```bash
which node                                # noter le chemin (souvent /usr/bin/node)
sudo cp /opt/quiz-app/deploy/quiz.service /etc/systemd/system/quiz.service
# si « which node » n'a pas affiché /usr/bin/node, corriger la ligne ExecStart (chemin du script : `src/server.js`) :
sudo nano /etc/systemd/system/quiz.service
sudo systemctl daemon-reload
sudo systemctl enable --now quiz          # démarre maintenant et à chaque redémarrage du serveur
sudo systemctl status quiz                # doit indiquer « active (running) »
sudo journalctl -u quiz -n 30             # affiche les messages (adresses, empreinte, erreurs)
```

Commandes utiles : `sudo systemctl restart quiz` (après une modification du `.env`), `sudo systemctl stop quiz`.

### 2.7 Ouvrir le pare-feu

```bash
sudo ufw allow 3443/tcp && sudo ufw allow 3000/tcp          # Ubuntu (ufw)
# ou, selon la distribution :
sudo firewall-cmd --permanent --add-port=3443/tcp --add-port=3000/tcp && sudo firewall-cmd --reload
```

### 2.8 (Facultatif) Utiliser le port standard 443

Dans `.env` : `HTTPS_PORT=443` et `PORT=80`, puis `sudo systemctl restart quiz` et ouvrir les ports 80 et 443 dans le pare-feu. Les adresses deviennent `https://<serveur>/admin` (plus de `:3443`). Le service fourni autorise déjà ces ports sans droits administrateur.

---

## 3. Serveur Windows (Windows Server ou Windows 10/11)

### 3.1 Installer Node.js

Télécharger et installer la version **LTS** depuis [nodejs.org/fr/download](https://nodejs.org/fr/download) (options par défaut). Vérifier dans PowerShell :

```powershell
node -v
```

### 3.2 Copier et installer l'application

Décompresser `quiz-app.zip` dans `C:\quiz-app`, puis dans PowerShell :

```powershell
cd C:\quiz-app
npm install --omit=dev
Copy-Item .env.example .env
notepad .env
```

Changer `SUPERADMIN_PASSWORD` (impératif), régler le mode HTTPS (§ 1), enregistrer.

### 3.3 Premier lancement (test)

```powershell
node src/server.js
```

Si Windows demande d'autoriser Node.js sur le réseau, accepter pour les **réseaux privés / de domaine**. Noter l'empreinte SHA-256 affichée, tester depuis un portable, puis `Ctrl+C`.

### 3.4 Ouvrir le pare-feu (PowerShell en administrateur)

```powershell
New-NetFirewallRule -DisplayName "Application Quiz" -Direction Inbound -Protocol TCP -LocalPort 3000,3443 -Action Allow -Profile Domain,Private
```

### 3.5 Démarrage automatique (service Windows avec NSSM)

1. Télécharger NSSM sur [nssm.cc/download](https://nssm.cc/download), copier `nssm.exe` (dossier `win64`) dans `C:\quiz-app\deploy\`.
2. Dans PowerShell **en administrateur** :

```powershell
cd C:\quiz-app\deploy
$node = (Get-Command node).Source
.\nssm.exe install Quiz $node "C:\quiz-app\src\server.js"
.\nssm.exe set Quiz AppDirectory C:\quiz-app
.\nssm.exe set Quiz AppStdout C:\quiz-app\data\journal.log
.\nssm.exe set Quiz AppStderr C:\quiz-app\data\journal.log
.\nssm.exe set Quiz Start SERVICE_AUTO_START
.\nssm.exe start Quiz
```

Le service « Quiz » apparaît dans `services.msc` ; les messages (adresses, empreinte, erreurs) sont dans `C:\quiz-app\data\journal.log`. Redémarrer après une modification du `.env` : `.\nssm.exe restart Quiz`.

---

## 4. Sur un Mac (usage ponctuel)

Pour un cours ponctuel depuis votre propre Mac : `cd ~/Documents/quiz-app` puis `npm start` dans le Terminal, et laisser la fenêtre ouverte. À la première connexion d'un portable, macOS peut demander d'autoriser « node » à recevoir des connexions : accepter. L'adresse IP du Mac est dans Réglages Système → Wi-Fi → Détails.

---

## 5. Réseau : vérifications avec le service informatique

- **Isolation des clients Wi-Fi** : certains réseaux Wi-Fi (souvent « invités » ou « étudiants ») empêchent les portables de joindre d'autres machines du réseau. Le serveur doit être joignable depuis le réseau des étudiants.
- **Adresse fixe** : demander une adresse IP fixe (ou réservée) pour le serveur, sinon le lien étudiant change. Mieux : un nom DNS interne (ex. `quiz.ecole.local`).
- **Test** : depuis un portable étudiant, ouvrir `https://<serveur>:3443/` — la page « Bienvenue » doit s'afficher.
- **Correction IA (facultatif)** : le serveur doit pouvoir joindre `https://api.anthropic.com` (port 443 sortant). À défaut, l'analyse locale est utilisée automatiquement.

---

## 6. Premier démarrage de l'application

1. Ouvrir `https://<serveur>:3443/superadmin` et se connecter avec le mot de passe défini dans `.env`.
2. Créer les comptes enseignants (identifiant + mot de passe, à leur transmettre).
3. (Facultatif) Saisir la clé API Anthropic pour la correction IA, puis « Tester la correction IA ».
4. Chaque enseignant se connecte sur `/admin`, charge son questionnaire et copie son **lien étudiant**.

---

## 7. Côté étudiants : l'avertissement de certificat (mode A)

Avec le certificat auto-signé, chaque navigateur affiche **une fois** un avertissement (« Votre connexion n'est pas privée », « Attention : risque probable de sécurité »…). C'est normal : le certificat n'est pas signé par une autorité connue, mais la connexion est bien chiffrée.

**Pour passer l'avertissement** (une fois par portable et par navigateur) :

| Navigateur | Manipulation |
|---|---|
| Chrome / Edge | « Paramètres avancés » → « Continuer vers … (dangereux) » |
| Firefox | « Avancé… » → « Accepter le risque et poursuivre » |
| Safari | « Afficher les détails » → « visiter ce site web » → confirmer |

**Vérification (recommandée)** : en cliquant sur l'icône à gauche de l'adresse → certificat, l'empreinte **SHA-256** doit être identique à celle affichée au démarrage de l'application. Si elle diffère, ne pas continuer (quelqu'un pourrait intercepter les échanges).

**Pour supprimer l'avertissement** sur les portables de l'école : le service informatique télécharge le certificat à l'adresse `https://<serveur>:3443/certificat` et le déploie comme certificat de confiance (stratégie de groupe Windows, MDM pour les Mac, ou manuellement : double-clic sur le fichier → l'ajouter aux certificats « racine de confiance » / au trousseau Système avec « Toujours approuver »). Ou passer au mode B (certificat du service informatique).

Le certificat auto-signé est valable un peu plus d'un an et se renouvelle automatiquement (ainsi que si l'adresse IP du serveur change) : il faudra alors le redéployer ou repasser l'avertissement.

---

## 8. Sauvegardes et restauration

**Quoi sauvegarder** : les dossiers `data/` et `resultats/` et le fichier `.env`. Ils contiennent les comptes (mots de passe chiffrés), questionnaires, participations, résultats et la configuration.

- **Linux** : `sudo /opt/quiz-app/deploy/sauvegarde.sh /var/backups/quiz` crée une archive datée et conserve les 30 dernières. Sauvegarde automatique chaque nuit à 2 h :
  ```bash
  echo '0 2 * * * root /opt/quiz-app/deploy/sauvegarde.sh /var/backups/quiz' | sudo tee /etc/cron.d/quiz-sauvegarde
  ```
- **Windows** : `powershell -ExecutionPolicy Bypass -File C:\quiz-app\deploy\sauvegarde.ps1 -Destination D:\Sauvegardes\Quiz`. Pour l'automatiser : Planificateur de tâches → Créer une tâche de base → quotidienne → Démarrer un programme `powershell.exe` avec les arguments ci-dessus.

Copier régulièrement les sauvegardes sur une autre machine. Les archives contiennent des données personnelles d'étudiants : les conserver dans un emplacement protégé (RGPD).

**Restaurer** : arrêter l'application, remplacer `data/`, `resultats/` et `.env` par ceux de l'archive, redémarrer.

---

## 9. Mettre à jour l'application

1. Faire une sauvegarde (§ 8).
2. Arrêter l'application (`sudo systemctl stop quiz` ou `.\nssm.exe stop Quiz`).
3. Remplacer **tous les fichiers sauf** `data/`, `resultats/` et `.env` par ceux de la nouvelle version.
4. `npm install --omit=dev` dans le dossier de l'application.
5. Redémarrer. Si la zone admin affiche un bandeau de version, recharger la page.

Les données des versions précédentes sont converties automatiquement au démarrage (l'ancien fichier est conservé à côté).

---

## 10. Check-list le jour de l'examen

- [ ] L'application tourne (`systemctl status quiz` / services.msc) et les sauvegardes fonctionnent.
- [ ] Depuis un portable étudiant : la page d'accueil s'ouvre et l'avertissement de certificat a été passé (ou ne s'affiche pas).
- [ ] Le questionnaire est chargé, vérifié (« Afficher les questions ») et l'option « ordre aléatoire » est réglée.
- [ ] Le lien étudiant est prêt à être affiché ou envoyé (QR code, tableau, message).
- [ ] La correction IA est testée (si utilisée) dans `/superadmin`.
- [ ] Les participations de test ont été supprimées (« Réautoriser » archive la participation et libère l'adresse email).
- [ ] Après l'examen : valider les notes proposées des questions ouvertes (« Corriger »), exporter la synthèse.

---

## 11. Dépannage

| Message ou symptôme | Cause probable | Solution |
|---|---|---|
| `le port 3443 est déjà utilisé` | L'application est déjà lancée, ou un autre logiciel utilise ce port. | Arrêter l'autre instance, ou changer `HTTPS_PORT` dans `.env`. |
| `pas le droit d'utiliser le port 443` | Ports < 1024 réservés sous Linux. | Utiliser le service fourni (`deploy/quiz.service`), ou garder 3443. |
| `ERREUR HTTPS : certificat introuvable / la clé privée ne correspond pas` | Chemins ou fichiers erronés (mode B). | Vérifier `HTTPS_CERT` et `HTTPS_KEY` (format PEM ; un fichier `.pfx` se convertit avec `openssl pkcs12`). |
| Les portables n'arrivent pas à se connecter | Pare-feu, isolation Wi-Fi, mauvaise adresse IP. | § 2.7 / 3.4 et § 5 ; tester depuis le serveur lui-même avec `https://localhost:3443`. |
| L'avertissement de certificat réapparaît | Le certificat a été renouvelé (adresse IP changée ou expiration). | Repasser l'avertissement ou redéployer `/certificat` ; demander une IP fixe. |
| La zone admin affiche « serveur … autre version » | Application mise à jour sans redémarrage. | Redémarrer le service puis recharger la page. |
| « Correction IA indisponible : API injoignable » | Le serveur n'accède pas à Internet. | Ouvrir l'accès sortant à `api.anthropic.com:443`, ou se contenter de l'analyse locale. |
| Blocage « Trop de tentatives » pour tous les utilisateurs derrière un proxy | `TRUST_PROXY` non renseigné en mode C. | Ajouter `TRUST_PROXY=loopback` (ou l'IP du proxy) dans `.env`. |
