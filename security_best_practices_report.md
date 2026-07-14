# Sicherheitsbericht: Momentum 4.2

Stand: 14. Juli 2026
Geprüfter Stand: Commit `c3be60b`
Technik: Vanilla JavaScript/PWA auf GitHub Pages, Supabase Auth/Postgres

## Behebungsstatus für Momentum 4.3

Die in diesem Bericht beschriebenen Maßnahmen wurden am 14. Juli 2026 umgesetzt und geprüft:

| Fund | Status | Umsetzung |
|---|---|---|
| SEC-001 | Behoben | Service Worker cached ausschließlich eine feste Same-Origin-Asset-Liste; alte Momentum-Caches werden entfernt. |
| SEC-002 | Behoben | Abmelden entfernt Sitzung, alle lokalen Momentum-Kontodaten und alte sensible Cacheeinträge. |
| SEC-003 | Behoben | Import-, Cloud- und Browserzustände werden streng normalisiert; gefährdete Emoji-Ausgaben werden escaped. |
| SEC-004 | Behoben | Frühe CSP-Metapolicy für GitHub Pages ergänzt. Headerbasierte Zusatzregeln bleiben eine spätere Hosting-Option. |
| SEC-005 | Behoben | Supabase JS ist exakt auf 2.110.3 gepinnt und mit SHA-384-SRI abgesichert. |
| SEC-006 | Behoben | Aktive Konten werden jetzt in RLS geprüft; gesperrte Konten können ihren Zustand nicht mehr über direkte API-Aufrufe lesen oder ändern. |

Validierung: JavaScript-Syntaxchecks, automatischer Security-Regressionstest, Browsertest mit wirksamer CSP/SRI sowie erneuter anonymer Live-Test gegen Supabase. Die drei sensiblen Tabellen antworteten ohne Anmeldung weiterhin mit HTTP 401.

## Kurzfassung

Die Supabase-Datenbankregeln trennen Konten grundsätzlich korrekt: Anonyme Zugriffe wurden im Live-Test abgewiesen und im Frontend liegt nur ein veröffentlichbarer Schlüssel. Das bloße Speichern der öffentlichen Webseite gibt daher keinen direkten Zugriff auf fremde Cloud-Daten.

Es gibt jedoch zwei dringende Risiken auf gemeinsam verwendeten Geräten: Der Service Worker cached derzeit pauschal alle GET-Antworten, einschließlich möglicher authentifizierter Supabase-Antworten, und die App lässt persönliche Daten nach dem Abmelden unverschlüsselt in `localStorage` zurück. Außerdem kann eine manipulierte Importdatei wegen unvollständiger Zustandsvalidierung gespeichertes JavaScript einschleusen. Vor einer öffentlichen Veröffentlichung oder Nutzung für sensible Gesundheitsdaten sollten SEC-001 bis SEC-003 behoben werden.

## Kritisch

### SEC-001 – Authentifizierte API-Antworten können im PWA-Cache landen

- **Rule ID:** JS-STORAGE-001 / anwendungsspezifischer Service-Worker-Befund
- **Severity:** Critical
- **Location:** `service-worker.js`, Zeilen 25–39; betroffene GET-Aufrufe in `cloud.js`, Zeilen 65–70 und 82–102
- **Evidence:** Der Fetch-Handler nimmt jede GET-Anfrage aus kontrollierten App-Seiten an. Für alle nicht als Navigation erkannten Anfragen führt er zuerst `caches.match(req)` aus und speichert anschließend jede Netzwerkantwort mit `c.put(req, copy)`. Es gibt keine Prüfung von `req.url`, `req.origin`, `req.destination`, Authentifizierungsheadern oder dem Supabase-Host.
- **Impact:** Authentifizierte Antworten wie der komplette `user_states.state`-Datensatz oder die Admin-Profilliste können im persistenten Cache des Browsers verbleiben. Cache-Schlüssel werden im Regelfall anhand von URL und `Vary` abgeglichen, nicht anhand des Bearer-Tokens. Auf demselben Browserprofil könnte dadurch eine spätere Anfrage eine zuvor autorisierte Antwort aus dem Cache erhalten. Bei einem Admin-Gerät kann das zusätzlich Namen und E-Mail-Adressen anderer Konten betreffen.
- **Fix:** Nur ausdrücklich aufgelistete, gleich-originige statische App-Dateien cachen. Für jede Cross-Origin-Anfrage und insbesondere für `uytacdogqercenlgbpgb.supabase.co` direkt `fetch(req)` verwenden und niemals `Cache.put` aufrufen. Beim Aktivieren der korrigierten Version alle alten Momentum-Caches löschen.
- **Mitigation:** Bis zum Update die App nicht in gemeinsam genutzten Browserprofilen verwenden und dort Website-Daten inklusive Cache Storage löschen.
- **False positive notes:** Ob eine konkrete Supabase-Antwort bereits im Cache eines bestimmten Geräts liegt, muss dort geprüft werden. Der Quellcode erlaubt das Speichern jedoch eindeutig; die Schutzentscheidung darf deshalb nicht von zufälligen Response-Headern abhängen.

## Hoch

### SEC-002 – Abmelden entfernt die persönliche Offline-Kopie nicht

- **Rule ID:** JS-STORAGE-001
- **Severity:** High
- **Location:** `app.js`, Zeilen 185–196, 1011–1013 und 1347–1353
- **Evidence:** Der vollständige Zustand wird als `momentum_v1_user_<user-id>` in `localStorage` geschrieben. Der Abmelde-Handler ruft Supabase `signOut()` auf, entfernt aber weder diesen Schlüssel noch Legacy-Daten oder Cache Storage.
- **Impact:** Gewohnheiten, Aufgaben, Kalender- und Gesundheitsdaten bleiben nach sichtbarem Abmelden unverschlüsselt im Browserprofil. Eine Person mit Zugriff auf dasselbe Gerät bzw. Browserprofil kann sie ohne das Passwort über Entwicklertools, ein lokales Skript unter derselben Origin oder eine spätere XSS-Lücke lesen.
- **Fix:** Nach erfolgreichem Cloud-Sync beim Abmelden den benutzerspezifischen Zustand, Legacy-Zustand und alle sensiblen App-Caches entfernen. Offline-Speicherung später nur als klar erklärte, optionale Funktion anbieten; Browser-Speicher ist keine Sicherheitsgrenze.
- **Mitigation:** Eigene Betriebssystem-/Browserprofile verwenden und auf fremden Geräten nach dem Abmelden sämtliche Website-Daten löschen.
- **False positive notes:** Auf einem ausschließlich persönlich verwendeten, gesperrten Gerät ist das Risiko kleiner. Es bleibt dennoch ein Bruch der Erwartung „abgemeldet = lokale Daten nicht mehr verfügbar“.

### SEC-003 – Manipulierte Import-/Speicherdaten können DOM-XSS auslösen

- **Rule ID:** JS-XSS-001
- **Severity:** High
- **Location:** `app.js`, Zeilen 73–138, 427, 460–484, 502–508, 1142–1160 und 1467–1478
- **Evidence:** `normalizeState()` validiert hauptsächlich Gesundheitswerte, aber nicht vollständig IDs, Habit-Symbole, Aufgabenbereiche und andere aus Import, Cloud oder Browser-Speicher stammende Felder. `importData()` prüft lediglich, ob `habits` ein Array ist. Danach werden unter anderem `habit.emoji` und mehrere IDs ohne HTML-Escaping in per `innerHTML` gerendertes Markup eingesetzt. Die vorhandene Funktion `escapeHtml()` wird nicht für alle untrusted Werte verwendet.
- **Impact:** Eine präparierte Backup-Datei oder manipulierte lokale Zustandsdatei kann Script im App-Ursprung ausführen. Dieses Script könnte die Supabase-Sitzung, lokale Aufgaben und Gesundheitsdaten auslesen und an Dritte übertragen.
- **Fix:** Einen strikten Schema-Validator für jeden importierten, lokalen und aus der Cloud geladenen Zustand einführen; unbekannte Felder verwerfen, IDs auf ein enges Format begrenzen und Längen/Typen serverunabhängig prüfen. Für sichtbare Werte `textContent` und programmatisch erzeugte DOM-Knoten verwenden. Wo String-Templates vorerst bleiben, ausnahmslos alle Datenwerte inklusive Attribute escapen.
- **Mitigation:** Bis zur Behebung keine Backup-Dateien anderer Personen importieren. Eine strenge CSP reduziert die Folgen, ersetzt aber nicht die sichere DOM-Erzeugung.
- **False positive notes:** Die normale Eingabemaske begrenzt das Emoji-Feld auf zwei Zeichen. Import, Cloudzustand und direkte Manipulation von Web Storage umgehen diese HTML-Grenze jedoch.

## Mittel

### SEC-004 – Keine Content Security Policy vorhanden

- **Rule ID:** JS-CSP-001 / JS-CSP-002
- **Severity:** Medium
- **Location:** `index.html`, insbesondere Zeilen 1–16 und 256–258; Live-Response von `https://solidmolid.github.io/momentum/`
- **Evidence:** Im Dokument gibt es kein CSP-Metaelement. Der am 14. Juli 2026 geprüfte GitHub-Pages-Response enthielt ebenfalls keinen `Content-Security-Policy`-Header.
- **Impact:** Falls eine DOM-XSS- oder Lieferkettenlücke ausgenutzt wird, begrenzt der Browser das Laden und Ausführen fremder Scripts sowie das Senden ausgelesener Daten nicht über eine App-spezifische Policy.
- **Fix:** Kurzfristig ein frühes CSP-Metaelement mit engem `script-src`, `connect-src`, `img-src`, `style-src`, `object-src 'none'` und `base-uri 'none'` ergänzen. Langfristig auf Hosting mit konfigurierbaren Response-Headern wechseln, damit auch `frame-ancestors` und Reporting wirksam gesetzt werden können.
- **Mitigation:** Zuerst die XSS-Pfade schließen und Drittanbieter-JavaScript minimieren.
- **False positive notes:** Security-Header könnten außerhalb des Repositories gesetzt werden; der Live-Test zeigt, dass dies beim aktuellen GitHub-Pages-Deployment nicht geschieht.

### SEC-005 – Supabase-Bibliothek ist nicht exakt gepinnt und hat keine Integritätsprüfung

- **Rule ID:** JS-SUPPLY-001 / JS-SRI-001
- **Severity:** Medium
- **Location:** `index.html`, Zeile 256
- **Evidence:** Die App lädt `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2` ohne exakte Patch-Version und ohne `integrity`-Attribut.
- **Impact:** Eine unerwartete Änderung des Major-Tags oder eine Kompromittierung der Lieferkette erhält dieselben Rechte wie eigener App-Code und kann Sitzung sowie persönliche Daten lesen.
- **Fix:** Eine geprüfte exakte Version selbst hosten oder mit exakter Version, passendem SRI-Hash und `crossorigin="anonymous"` laden. Die CSP auf genau diese Quelle begrenzen.
- **Mitigation:** Abhängigkeiten regelmäßig und bewusst aktualisieren, statt bewegliche Versions-Tags zu verwenden.
- **False positive notes:** jsDelivr und Supabase sind etablierte Anbieter; das senkt die Wahrscheinlichkeit, nicht aber die Wirkung eines erfolgreichen Lieferkettenangriffs.

### SEC-006 – „Gesperrt“ wird nur in der Oberfläche geprüft

- **Rule ID:** AUTHZ-APP-001
- **Severity:** Medium
- **Location:** `app.js`, Zeilen 969–1016; `supabase/schema.sql`, Zeilen 87–123
- **Evidence:** Die App lädt den Nutzerzustand vor der Statusprüfung und sperrt die Oberfläche erst bei `profile.status === "blocked"`. Die RLS-Regeln für `user_states` prüfen ausschließlich `auth.uid() = user_id`, nicht den Profilstatus.
- **Impact:** Ein gesperrtes Konto kann mit einer noch gültigen Sitzung oder direkten Supabase-Anfragen weiterhin seinen Cloudzustand lesen und verändern. Die Sperrfunktion beendet also nicht zuverlässig den Zugang.
- **Fix:** Eine sichere `is_active_user()`-Prüfung in die RLS-Regeln aufnehmen und beim Sperren serverseitig alle Sitzungen dieses Benutzers widerrufen. Dafür ist eine geschützte Admin-Funktion außerhalb des öffentlichen Frontend-Codes erforderlich.
- **Mitigation:** „Gesperrt“ bis dahin nicht als vollständige Zugangssperre darstellen.
- **False positive notes:** Die aktuellen Regeln verhindern weiterhin, dass das gesperrte Konto fremde Zustände liest. Betroffen ist die Wirksamkeit der Kontosperre selbst.

## Bereits vorhandene Schutzmaßnahmen

- Row Level Security ist für `profiles`, `user_states` und `admin_users` aktiviert.
- `user_states` darf pro Konto nur mit der eigenen `auth.uid()` gelesen und verändert werden.
- Tabellenrechte für `anon` wurden entzogen und anschließend nur notwendige Rechte für `authenticated` vergeben.
- `is_admin()` verwendet `SECURITY DEFINER` mit leerem `search_path` und prüft die aktuelle Benutzer-ID.
- Im Frontend liegt nur der öffentliche Supabase-Publishable-Key, kein `service_role`- oder Secret-Key.
- Namen, Tasktexte, Notizen und E-Mail-Adressen werden an vielen wichtigen Renderstellen bereits mit `escapeHtml()` behandelt.
- Externe Google-Kalenderlinks verwenden `rel="noopener"`.

## Empfohlene Reihenfolge

1. Service Worker auf eine feste Same-Origin-Asset-Allowlist begrenzen und alte Caches löschen.
2. Lokale Kontodaten beim Abmelden vollständig entfernen.
3. Zustandsimport streng validieren und alle DOM-Ausgaben absichern.
4. CSP ergänzen und Supabase-JavaScript exakt pinnen bzw. selbst hosten.
5. Kontosperren in RLS und serverseitiger Session-Verwaltung durchsetzen.
6. Danach erneut testen: anonym, normaler Benutzer, zweiter Benutzer, Admin, gesperrter Benutzer und gemeinsam verwendetes Browserprofil.
