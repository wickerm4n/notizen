# Notizen

Eine kleine Notizen-App für den Browser. Die Anwendung läuft komplett lokal und benötigt kein Backend.

## Überblick

Die App bietet eine einfache Oberfläche zum Schreiben und Verwalten von Notizen. Notizen werden im Browser gespeichert und bleiben erhalten, solange der lokale Browser-Speicher nicht gelöscht wird.

Enthalten sind unter anderem:

- Erstellen, Bearbeiten, Umbenennen, Duplizieren und Löschen von Notizen
- Suche, Sortierung und angepinnte Notizen
- Mehrfachauswahl mit Aktionen für mehrere Notizen
- Markdown-Vorschau und Split-Ansicht
- Import und Export als `.txt`, `.md` oder `.json`
- Hell-, Dunkel- und System-Theme
- Einstellungen für Schriftart, Schriftgröße und Editor-Ansicht
- Responsive Darstellung für Desktop und mobile Geräte

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
    ├── markdown.js
    ├── notes.js
    ├── settings.js
    ├── storage.js
    └── ui.js
```

## Nutzung

Die App kann direkt über die Datei `index.html` geöffnet werden. Für lokale Tests kann auch ein einfacher Webserver verwendet werden:

```bash
python -m http.server 8000
```

Danach ist die Seite unter `http://localhost:8000` erreichbar.

## Speicherung

Notizen und Einstellungen werden lokal im Browser gespeichert. Standardmäßig wird IndexedDB verwendet. Falls IndexedDB nicht verfügbar ist, nutzt die App localStorage als Fallback.

## Hinweise

Die App verarbeitet Importdaten direkt im Browser. Ungültige oder beschädigte Dateien werden abgefangen, und Markdown-Inhalte werden vor der Vorschau bereinigt.

Alle Dateien sind für UTF-8 ausgelegt. In `index.html` ist `<meta charset="UTF-8">` gesetzt, damit Umlaute und Sonderzeichen korrekt dargestellt werden.
