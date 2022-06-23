# Rendezvousonline Bot

Un robot pour vous aider à trouver un rendez-vous rapide et proche de chez vous.

Les disponibilités sont vérifiées périodiquement dans un périmètre géographique
défini et des alertes email avec les nouveaux rendez-vous disponibles (désistements)
sont envoyées.

## Installation

Cloner ce dépôt et rentrer dans le dossier :

```
git clone https://github.com/corbin-c/rdv-online-bot.git
cd rdv-online-bot
```

Installer les dépendances :

```
npm install
```

## Configuration

```
npm run config
```

## Initialisation

```
npm run init
```

## Exécution

Une fois le programme configuré et initialisé, il faut définir un cronjob pour
l'exécuter périodiquement. Ici par exemple toutes les deux heures :

```
0 */2 * * * cd /path/to/repo/rdv-online-bot/ && node index.js > bot.log 2>&1
```
