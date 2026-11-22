# Swing-Depot

Private Web-App für Swingtrading mit kleinen Beträgen: Kopie des Trade-Republic-Depots, Beobachtungsliste und Bewertung jeder Aktie nach festen Regeln (kaufen, abwarten, nicht kaufen), mit Kaufkurs, Notbremse (Stop-Loss) und Ziel. Keine Anlageberatung.

- **App:** `index.html` (installierbar auf Android: im Chrome-Menü „App installieren“ bzw. „Zum Startbildschirm hinzufügen“)
- **Rechen-Kern:** `engine.js` (läuft in der App und im täglichen Lauf)
- **Täglicher Lauf:** `.github/workflows/daily.yml` + `scripts/daily.js`, werktags 17:10 UTC: Kurse von Yahoo Finance, Regeln, Push über ntfy (Secret `NTFY_TOPIC`)
- **Beobachtungsliste:** `config/watch.json` (schreibt die App per GitHub-Token; nur Kürzel, Namen, Notbremse, Ziel)
- **Kurse:** `data/` (vom Lauf geschrieben)

Depot und Trades liegen nur im Browser des Handys. Sicherung unter „Regeln → Sicherung speichern“.
