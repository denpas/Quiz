# Sauvegarde de l'Application Quiz (Windows) : comptes, questionnaires, participations, résultats, configuration.
# Usage (PowerShell) : powershell -ExecutionPolicy Bypass -File C:\quiz-app\deploy\sauvegarde.ps1 [-Destination D:\Sauvegardes\Quiz]
# À planifier chaque nuit avec le Planificateur de tâches (voir INSTALLATION.md).
param([string]$Destination = "C:\Sauvegardes\Quiz", [int]$Garder = 30)
$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $PSScriptRoot
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$Fichier = Join-Path $Destination ("quiz-" + (Get-Date -Format "yyyy-MM-dd_HHmm") + ".zip")
$Elements = @((Join-Path $AppDir "data"), (Join-Path $AppDir "resultats"))
if (Test-Path (Join-Path $AppDir ".env")) { $Elements += (Join-Path $AppDir ".env") }
Compress-Archive -Path $Elements -DestinationPath $Fichier
Get-ChildItem $Destination -Filter "quiz-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Garder | Remove-Item
Write-Output "Sauvegarde créée : $Fichier"
