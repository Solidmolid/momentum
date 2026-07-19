# Momentum 5.0 – Akzeptanzkriterien

## Bereiche und Navigation

- Es gibt sechs Bereiche: Gewohnheiten, Tasks, Kalender, Gesundheit, Fokus und Skizzen.
- In den Einstellungen gibt es auf der Hauptseite den Abschnitt „Bereiche“.
- Jeder Bereich kann ein- oder ausgeblendet werden; mindestens ein Bereich bleibt sichtbar.
- Sichtbare Bereiche können per Ziehen sowie über zugängliche Hoch-/Runter-Aktionen sortiert werden.
- Reihenfolge und Sichtbarkeit werden lokal und im Benutzerkonto gespeichert.
- Wird der aktive Bereich ausgeblendet, wechselt die App zu einem weiterhin sichtbaren Bereich.
- Die untere Navigation bleibt mit drei bis sechs sichtbaren Bereichen auf kleinen Handys bedienbar.

## Pomodoro / Fokus

- Fokusdauer, kurze Pause, lange Pause und Anzahl der Fokusphasen vor der langen Pause sind einstellbar.
- Der Timer unterstützt Start, Pause, Fortsetzen, Zurücksetzen und Überspringen.
- Der Timer basiert auf Zeitstempeln und bleibt nach Bildschirmwechsel, Reload und erneutem Öffnen korrekt.
- Optionale Töne, Vibration und – soweit die PWA-Plattform es erlaubt – Benachrichtigungen sind vorhanden.
- Abgeschlossene Fokussitzungen werden mit Datum und Dauer protokolliert.
- Der Bereich zeigt den Tagesstand und einen siebentägigen Verlauf.

## Skizzenbibliothek

- Benutzer können mehrere Skizzen erstellen, benennen, beschreiben, duplizieren und löschen.
- Jede Skizze zeigt Vorschaubild, Erstellungsdatum und letztes Änderungsdatum.
- Skizzen lassen sich nach Datum und Name sortieren und als große Vollbildansicht öffnen.
- Skizzen sind im eigenen Konto auf iPad, Handy und Laptop verfügbar.

## Skizzeneditor

- Der Editor funktioniert responsiv in Hoch- und Querformat.
- Eingaben funktionieren mit Apple Pencil/Stylus, Finger und Maus.
- Stift, Marker, Radierer, Farbe und Strichstärke sind auswählbar.
- Es gibt Undo, Redo, Zoom und Verschieben der Zeichenfläche.
- Textfelder können eingefügt, bearbeitet, verschoben und gelöscht werden.
- Ein „Nur mit Stift zeichnen“-Modus erlaubt Finger-Pan bei Stifteingabe.
- Zeichnungen werden als geräteunabhängige Vektorobjekte gespeichert und als PNG exportiert.
- Automatische Speicherung darf bestehende Inhalte nicht unbemerkt überschreiben.

## Migration, Sicherheit und Qualität

- Bestehende Konten, Gewohnheiten, Tasks, Termine und Gesundheitsdaten bleiben unverändert erhalten.
- Import, Export, Eingabevalidierung und Cloud-Merge kennen die neuen Datenstrukturen.
- Neue Freitexte werden vor HTML-Ausgabe escaped und Datenmengen werden begrenzt.
- Offlineänderungen werden lokal erhalten und nach Wiederverbindung synchronisiert.
- Automatisierte Tests decken Migration, Timerlogik, Navigation und Skizzennormalisierung ab.
- Die veröffentlichte PWA lädt Momentum 5.0 und den neuen Service-Worker-Cache.
