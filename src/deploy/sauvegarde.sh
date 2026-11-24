#!/usr/bin/env bash
# Sauvegarde de l'Application Quiz (Linux / macOS) : comptes, questionnaires, participations, résultats, configuration.
# Usage : deploy/sauvegarde.sh [dossier de destination]   (par défaut : /var/backups/quiz)
# À planifier chaque nuit, par exemple avec cron :  0 2 * * * /opt/quiz-app/deploy/sauvegarde.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-/var/backups/quiz}"
KEEP=30   # nombre de sauvegardes conservées
mkdir -p "$DEST"
FILE="$DEST/quiz-$(date +%Y-%m-%d_%H%M).tar.gz"
ITEMS=(data resultats)
[ -f "$APP_DIR/.env" ] && ITEMS+=(.env)
tar -czf "$FILE" -C "$APP_DIR" "${ITEMS[@]}"
chmod 600 "$FILE"   # contient les données des étudiants et les mots de passe chiffrés
ls -1t "$DEST"/quiz-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Sauvegarde créée : $FILE"
