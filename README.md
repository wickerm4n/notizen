# Notizen

Eine lokale Notizen-App für den Browser. Sie läuft ohne Server, speichert Inhalte direkt im Browser und bietet eine ruhige Oberfläche zum Schreiben, Organisieren und Erinnern.

## Funktionen

- Notizen erstellen, bearbeiten, umbenennen, duplizieren und löschen
- Notizen anpinnen, durchsuchen und sortieren
- mehrere Notizen auswählen und gemeinsam bearbeiten
- Markdown schreiben und als Vorschau oder Split-Ansicht anzeigen
- Notizen als Text-, Markdown- oder JSON-Dateien importieren und exportieren
- Hell-, Dunkel- und System-Theme nutzen
- Schriftart, Schriftgröße, Zähler und Startansicht anpassen
- optimierte Darstellung für Desktop, Tablet und Smartphone

## Erinnerungen

Für jede Notiz können eine oder mehrere Erinnerungen angelegt werden. Eine Erinnerung besteht aus einem Datum, einer Uhrzeit und optionalen Zusatzfunktionen.

Mögliche Optionen:

- eigener Hinweistext
- auswählbare Notizzeilen zur späteren Hervorhebung
- Browser-Benachrichtigung
- Dialog innerhalb der App
- blinkender Browser-Tab
- dezenter Erinnerungston

Beim Auslösen einer Erinnerung kann die App die passende Notiz öffnen und ausgewählte Zeilen kurz hervorheben. Wenn kein Hinweistext hinterlegt ist, bleiben Benachrichtigungen und Dialoge entsprechend knapp.

## Benachrichtigungen

Erinnerungen können im Browser, innerhalb der App oder in beiden Varianten angezeigt werden. Falls Browser-Benachrichtigungen nicht erlaubt sind, nutzt die App weiterhin interne Hinweise.

Hinweise und Fehler erscheinen oben rechts als gut sichtbare Meldungen und blenden sanft ein und aus.

## Speicherung

Alle Notizen, Einstellungen und Erinnerungen werden lokal im Browser gespeichert. Es gibt keinen Server-Upload und keine Anmeldung.

Standardmäßig nutzt die App IndexedDB. Falls IndexedDB nicht verfügbar ist, wird localStorage als Fallback verwendet. Die Daten bleiben erhalten, solange der lokale Browser-Speicher nicht gelöscht wird.

## Import und Export

Notizen können einzeln oder gesammelt exportiert werden. JSON-Exporte enthalten auch gespeicherte Erinnerungen.

Beim Import prüft die App die Dateien und fängt ungültige oder beschädigte Inhalte ab. Inhalte werden sicher als Text behandelt und nicht ungefiltert als HTML ausgegeben.

## Nutzung

Die App kann direkt über `index.html` geöffnet werden.

Für lokale Tests kann ein einfacher Webserver verwendet werden:

```bash
python -m http.server 8000
```

Danach ist die App unter `http://localhost:8000` erreichbar.

## Projektstruktur

```text
.
|-- index.html
|-- assets/
|   `-- site.webmanifest
|-- css/
|   `-- styles.css
|-- icons/
|   |-- app-icon.svg
|   `-- favicon.svg
`-- js/
    |-- app.js
    |-- editor.js
    |-- highlighting.js
    |-- markdown.js
    |-- notes.js
    |-- notifications.js
    |-- reminders.js
    |-- settings.js
    |-- storage.js
    |-- ui.js
    `-- update.js
```

## Hinweise

Browser-Benachrichtigungen und Töne hängen von den Berechtigungen und Regeln des jeweiligen Browsers ab. Wenn eine Funktion blockiert wird, bleibt die App nutzbar und zeigt Hinweise innerhalb der Oberfläche an.

Die App ist für UTF-8 ausgelegt, damit Umlaute und Sonderzeichen korrekt dargestellt werden.
