# Notizen

Eine vollständig statische, moderne Notizen-App für den Browser. Die App läuft komplett clientseitig, speichert Daten lokal per IndexedDB mit localStorage-Fallback und kann ohne Build-Schritt direkt auf GitHub Pages veröffentlicht werden.

## Funktionen

- Notizen erstellen, bearbeiten, umbenennen, duplizieren, löschen und anpinnen
- Gestyltes Kontextmenü per Rechtsklick auf einzelne Notizen
- Mehrfachauswahl per Checkbox mit Export, Duplizieren und Löschen der Auswahl
- Automatisches Speichern mit sichtbarem Status
- Suche und Sortierung nach Änderungsdatum, Erstellungsdatum oder Titel
- Markdown-Editor mit Vorschau und Split-View
- Unterstützung für Überschriften, Listen, Links, Code-Blöcke, Zitate und Checkboxen
- Export einzelner oder aller Notizen als `.txt`, `.md` oder `.json`
- Import von zuvor exportierten JSON-Dateien sowie einzelner `.txt`- und `.md`-Dateien
- Fehlerbehandlung für ungültige oder beschädigte Importdaten
- Begrenzte Importgröße und validierte Importdaten für mehr Robustheit
- Light Mode, Dark Mode und System-Theme
- Einstellbare Schriftart, Schriftgröße und Editor-Ansicht
- Wort- und Zeichenzähler sowie Vollbild-Schreibmodus
- Responsive Oberfläche für Desktop, Tablet und Smartphone

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

## Lokal starten

Die App kann direkt durch Öffnen der `index.html` genutzt werden. Für einen lokalen Testserver reicht zum Beispiel:

```bash
python -m http.server 8000
```

Danach ist die App unter `http://localhost:8000` erreichbar. Ein Server ist nicht zwingend erforderlich, aber beim Testen oft angenehmer.

## GitHub Pages

1. Repository zu GitHub hochladen.
2. In den Repository-Einstellungen unter **Pages** die gewünschte Quelle auswählen, zum Beispiel den Branch `main` und den Ordner `/root`.
3. Speichern und die von GitHub angezeigte Pages-URL öffnen.

Es sind keine Build-Tools, keine serverseitigen Abhängigkeiten und keine externe Datenbank nötig.

## Speicherung

Notizen und Einstellungen bleiben lokal im Browser gespeichert, solange der Browser-Speicher nicht gelöscht wird. Primär wird IndexedDB verwendet. Falls IndexedDB nicht verfügbar ist, fällt die App automatisch auf localStorage zurück.

## Sicherheit und Robustheit

Die App kommt ohne externe Frameworks und ohne Server aus. Markdown-Inhalte werden vor der Vorschau escaped, Links werden auf sichere Protokolle geprüft und Importdaten werden validiert, damit beschädigte oder ungewöhnlich große Dateien die App nicht destabilisieren.

## UTF-8

Alle Dateien sind für UTF-8 ausgelegt. In `index.html` ist `<meta charset="UTF-8">` gesetzt, damit Umlaute und Sonderzeichen wie ä, ö, ü, Ä, Ö, Ü und ß korrekt dargestellt werden.
