# Notizen

Eine kleine Notizen-App für den Browser. Die Anwendung läuft komplett lokal und benötigt kein Backend.

## Überblick

Die App bietet eine einfache Oberfläche zum Schreiben, Verwalten und Wiederfinden von Notizen. Notizen, Einstellungen und Erinnerungen werden lokal im Browser gespeichert und bleiben erhalten, solange der lokale Browser-Speicher nicht gelöscht wird.

Enthalten sind unter anderem:

- Erstellen, Bearbeiten, Umbenennen, Duplizieren und Löschen von Notizen
- Suche, Sortierung und angepinnte Notizen
- Mehrfachauswahl mit Aktionen für mehrere Notizen
- Markdown-Vorschau und Split-Ansicht
- Erinnerungen pro Notiz mit Datum, Uhrzeit, Status und optionalem Vorschautext
- Mehrere unabhängige Erinnerungen pro Notiz
- Browser-Benachrichtigungen mit internem Toast-Fallback
- Optionaler dezenter Erinnerungston
- Optionale Textmarkierung pro Erinnerung, die beim Auslösen hervorgehoben wird
- Reminder-Übersicht, Reminder-Badge und kompakte Hinweisleiste in der Notizansicht
- Import und Export als `.txt`, `.md` oder `.json`
- Hell-, Dunkel- und System-Theme
- Einstellungen für Schriftart, Schriftgröße und Editor-Ansicht
- Responsive Darstellung für Desktop, Tablets und Smartphones
- Mobile-optimierte Dialoge für Hoch- und Querformat

## Erinnerungen

Über den Glocken-Button in der Notiz-Toolbar oder über das Notiz-Kontextmenü können Erinnerungen für die aktuell ausgewählte Notiz verwaltet werden.

Pro Erinnerung können festgelegt werden:

- Datum und Uhrzeit
- optionaler Vorschautext
- optionaler Benachrichtigungston
- optionaler Notizbereich zum Hervorheben

Im Reminder-Dialog gibt es Schnellaktionen wie `10 Min`, `1 Std` und `Morgen`. Vergangene oder ungültige Zeitpunkte werden abgefangen. Bereits gesetzte Erinnerungen können bearbeitet, deaktiviert oder gelöscht werden.

Wenn eine Erinnerung fällig wird, versucht die App die Browser Notification API zu verwenden. Falls diese nicht verfügbar oder nicht erlaubt ist, erscheint ein interner Hinweis innerhalb der App. Beim Anklicken wird die passende Notiz geöffnet und ein gespeicherter Textbereich, falls vorhanden, temporär hervorgehoben.

## Textauswahl und Hervorhebung

Beim Erstellen oder Bearbeiten einer Erinnerung kann ein Bereich der Notiz als Hervorhebung gespeichert werden. Dafür gibt es im Reminder-Dialog ein Feld mit dem Notiztext zum Markieren. Der markierte Ausschnitt wird mit Kontext gespeichert, damit er auch nach kleineren Textänderungen wiedergefunden werden kann.

Falls der ursprüngliche Bereich später nicht mehr eindeutig gefunden wird, öffnet die App trotzdem die Notiz und zeigt einen Hinweis an. Der eigentliche Notizinhalt wird durch die Hervorhebung nicht verändert.

## Projektstruktur

```text
.
├── index.html
├── assets/
│   └── site.webmanifest
├── css/
│   └── styles.css
├── icons/
│   ├── app-icon.svg
│   └── favicon.svg
└── js/
    ├── app.js
    ├── editor.js
    ├── highlighting.js
    ├── markdown.js
    ├── notes.js
    ├── notifications.js
    ├── reminders.js
    ├── settings.js
    ├── storage.js
    ├── ui.js
    └── update.js
```

## Nutzung

Die App kann direkt über die Datei `index.html` geöffnet werden. Für lokale Tests kann auch ein einfacher Webserver verwendet werden:

```bash
python -m http.server 8000
```

Danach ist die Seite unter `http://localhost:8000` erreichbar.

## Speicherung

Notizen, Einstellungen und Erinnerungen werden lokal im Browser gespeichert. Standardmäßig wird IndexedDB verwendet. Falls IndexedDB nicht verfügbar ist, nutzt die App localStorage als Fallback.

Reminder-Daten werden migrationsfreundlich an der jeweiligen Notiz gespeichert und beim Laden normalisiert. Beim Löschen einer Notiz werden zugehörige aktive Timer im laufenden Tab bereinigt.

## Import und Export

Text-, Markdown- und JSON-Exporte bleiben möglich. JSON-Exporte enthalten auch gespeicherte Erinnerungen. Beim Import werden Notizen und Reminder-Daten geprüft und ungültige Werte abgefangen.

## Hinweise

Die App verarbeitet Importdaten direkt im Browser. Ungültige oder beschädigte Dateien werden abgefangen, und Markdown-Inhalte werden vor der Vorschau bereinigt.

Notizinhalte, Vorschautexte und Reminder-Hinweise werden als Text behandelt und nicht ungefiltert als HTML gerendert.

Browser-Benachrichtigungen und Töne hängen von den Berechtigungen und Autoplay-Regeln des jeweiligen Browsers ab. Wenn der Browser sie blockiert, bleibt die App ohne Fehlermeldung nutzbar und zeigt interne Hinweise an.

Alle Dateien sind für UTF-8 ausgelegt. In `index.html` ist `<meta charset="UTF-8">` gesetzt, damit Umlaute und Sonderzeichen korrekt dargestellt werden.
