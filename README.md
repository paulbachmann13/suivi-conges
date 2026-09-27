# Suivi congés

Petite PWA (HTML/CSS/JS vanilla, sans build) pour **placer et compter mes jours de congé**
pendant mon stage de 6 mois chez Becker Technologies.

- **Calendrier** : je touche un jour pour poser une journée, puis une demi-journée, puis je le retire.
  Le compteur « jours restants à placer » se met à jour tout de suite.
- **Poser une période** : du … au …, seuls les jours travaillés sont décomptés.
- Jours fériés **NRW** (ou France) et **jours offerts** par l'entreprise exclus automatiquement.
- **Acquisition mois par mois** (2,5 j/mois par défaut) : les jours posés avant d'être acquis sont marqués ⚠︎.
- **Bilan** : acquis à ce jour, solde, périodes posées (avec le nombre de jours de repos d'affilée),
  tableau mois par mois, ponts possibles, liste des fériés.
- **Version + bouton ↻** en haut de l'écran : vérifier et charger la dernière version de l'appli installée.
- Les données restent **sur le téléphone** (localStorage) ; export/import JSON pour les sauvegarder.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des 3 onglets (Calendrier, Bilan, Réglages) |
| `style.css` | Thème sombre (clair en option), mobile-first |
| `app.js` | Dates, jours fériés, calculs, stockage, interface |
| `sw.js` | Service worker (hors ligne) |
| `manifest.webmanifest`, `icons/` | Installation sur l'écran d'accueil (`node tools/make-icons.js` pour les régénérer) |
| `tests/calc.test.js` | Tests des calculs |

## Activer GitHub Pages

1. Sur GitHub, ouvrez le dépôt → **Settings** → **Pages**.
2. *Build and deployment* → **Source : Deploy from a branch**.
3. Branche **`main`**, dossier **`/ (root)`** → **Save**.
4. Au bout d'une minute, l'appli est en ligne sur
   `https://<votre-pseudo>.github.io/suivi-conges/`.

## Installer sur iPhone

1. Ouvrez l'adresse GitHub Pages dans **Safari**.
2. Bouton **Partager** → **Sur l'écran d'accueil** → **Ajouter**.
3. Au premier lancement, saisissez les dates du stage dans **Réglages**.

## Tests

```bash
node --test tests/*.test.js
```

## Mettre à jour l'appli

Après une modification, incrémentez la version dans `app.js` (`APP_VERSION`)
**et** dans `sw.js` (`VERSION`) : les téléphones récupèrent alors la nouvelle version
(bouton ↻ en haut à droite), et le numéro affiché permet de vérifier qu'elle est à jour.
