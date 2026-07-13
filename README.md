# Momentum

Eine kleine, schön gestaltete Web-App für **Gewohnheiten** und **Tasks** –
gebaut für's Handy (iPhone/Android), läuft direkt im Browser, kostenlos hostbar über **GitHub Pages**.

## Funktionen

**Gewohnheiten**
- Eigene Gewohnheiten anlegen (Emoji, Name, täglich oder wöchentliches Ziel)
- Wochen-Ansicht: *Woche 1, 2, 3 …* ab einem frei wählbaren, exakten Starttag
- Abhaken nur bis zum heutigen Tag – zukünftige Tage sind gesperrt
- Alle täglichen Gewohnheiten erledigt = **100 % an dem Tag**
- **Wochenziele** wie „Gym 3×/Woche" mit eigenem Fortschritt
- **Wochen-Verlauf-Grafik** über die 7 Tage (0–100 %)
- Geschwungene Fortschrittsanalyse seit dem Start sowie für Woche, 30 Tage und 12 Monate (`S · W · M · J`)
- Gemeinsame Gewichtung von Tages- und Wochenzielen mit klarer Gesamtquote
- Persönliche Durchzieh-Rate für jede tägliche Gewohnheit
- Tage vor dem persönlichen Startpunkt werden nicht gewertet; ältere Daten bleiben beim Verschieben des Starts erhalten

**Tasks**
- Kurzfristige & langfristige Aufgaben, abhakbar und mit Fälligkeitsdatum
- Frei benennbare Aufgaben-Blöcke und automatische Nummerierung
- Aufgaben ohne Datum oder mit Kalenderdatum
- Archivieren und Wiederherstellen erledigter Aufgaben

**Kalender**
- Moderne Monatsansicht mit Tagesagenda
- Eigene Termine mit Datum, Von–Bis-Zeit und Notiz
- Fällige Tasks erscheinen automatisch im Kalender
- Aufgaben direkt für einen ausgewählten Kalendertag erstellen und bearbeiten
- Termine und Tasks mit einem Tipp in Google Kalender übernehmen

**Sonstiges**
- Benutzerkonten mit E-Mail und Passwort
- Automatische Synchronisierung zwischen Handy, Laptop und PC
- Strikt getrennte Cloud- und Offline-Daten pro Benutzer
- Admin-Übersicht für registrierte Konten
- Hell/Dunkel
- Läuft offline (PWA) & „Zum Home-Bildschirm hinzufügen"
- Daten-Export/-Import als Backup

## Wichtig: Wo liegen die Daten?

Angemeldete Benutzer speichern ihren App-Stand verschlüsselt über **Supabase** in
einem eigenen, per Row Level Security geschützten Datensatz. Zusätzlich bleibt
eine Offline-Kopie auf dem jeweiligen Gerät erhalten. Beim ersten Login wird ein
vorhandener lokaler Stand automatisch in das eigene Cloud-Konto übernommen.
Über **Einstellungen → Daten → Export** kann weiterhin ein Backup gesichert werden.

Die Datenbankstruktur und Zugriffsregeln liegen in `supabase/schema.sql`.

## Auf dem iPhone installieren

1. App-Link (deine GitHub-Pages-Adresse) in **Safari** öffnen
2. Teilen-Symbol (Quadrat mit Pfeil) → **Zum Home-Bildschirm**
3. Fertig – die App startet dann wie eine echte App im Vollbild.

## Lokal testen (am PC)

```bash
python -m http.server 8123
# dann im Browser: http://127.0.0.1:8123
```

## Über GitHub Pages veröffentlichen

**Variante A – ohne Terminal (am einfachsten):**
1. Auf github.com neues, leeres Repository anlegen (z. B. `momentum`)
2. „uploading an existing file" → alle Dateien dieses Ordners hochladen → commit
3. Repo → **Settings → Pages** → *Source: Deploy from a branch* → `main` / `root` → Save
4. Nach ~1 Min ist die App unter `https://DEINNAME.github.io/momentum/` erreichbar

**Variante B – mit Git:**
```bash
git init
git add -A
git commit -m "Momentum v1"
git branch -M main
git remote add origin https://github.com/DEINNAME/momentum.git
git push -u origin main
```
Danach: Settings → Pages → `main` / `root`.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | App-Grundgerüst |
| `styles.css` | Design |
| `app.js` | Logik (Gewohnheiten, Tasks, Speicherung) |
| `manifest.webmanifest` | PWA-Infos (Name, Icons) |
| `service-worker.js` | Offline-Fähigkeit |
| `icons/` | App-Icons |
