# Notizen

Eine moderne, lokale Notizen-App für den Browser. Sie läuft ohne Server, speichert deine Daten im Browser und ist darauf ausgelegt, beim Schreiben, Wiederfinden und Erinnern angenehm unaufdringlich zu bleiben.

## Überblick

Mit der App kannst du Notizen erstellen, bearbeiten, sortieren, durchsuchen und bei Bedarf mit Erinnerungen versehen. Die Oberfläche unterstützt kurze Alltagsnotizen genauso wie längere Texte mit Markdown-Vorschau.

Wichtige Funktionen:

- Notizen erstellen, umbenennen, duplizieren, löschen und anpinnen
- Suche, Sortierung und Mehrfachauswahl
- Editor-, Vorschau- und Split-Ansicht
- Markdown-Vorschau mit sicherer Darstellung
- Import und Export von Text-, Markdown- und JSON-Dateien
- Hell-, Dunkel- und System-Theme
- Einstellungen für Schriftart, Schriftgröße, Zähler und Startansicht
- Responsive Darstellung für Desktop, Tablet und Smartphone
- Erinnerungen pro Notiz mit Datum, Uhrzeit und optionalem Hinweistext

## Erinnerungen

Über den Glocken-Button in der Notiz-Toolbar kannst du Erinnerungen für die aktuelle Notiz verwalten. Pro Notiz sind mehrere Erinnerungen möglich.

Eine Erinnerung kann enthalten:

- Datum und Uhrzeit
- einen optionalen Hinweistext
- ausgewählte Notizzeilen, die beim Öffnen hervorgehoben werden
- Browser-Benachrichtigung, In-App-Dialog oder beides
- optionales Tab-Blinken
- optionalen dezenten Erinnerungston

Für schnelle Erinnerungen gibt es Schaltflächen wie `10 Min`, `1 Std` und `Morgen`. Datum und Uhrzeit können direkt eingetragen werden; im Erinnerungsdialog lassen sich die Werte auch mit dem Mausrad hoch- oder runterstellen.

Wenn kein Hinweistext eingetragen wurde, zeigt die App auch keinen künstlichen Hinweistext an. Browser-Benachrichtigungen, In-App-Dialoge und interne Hinweise bleiben dann bewusst schlank und konzentrieren sich auf Titel, Zeitpunkt und ausgewählte Zeilen.

## Notizzeilen Auswählen

Im Erinnerungsdialog muss kein Text mehr mit der Maus markiert werden. Stattdessen werden die vorhandenen Notizzeilen als klickbare Liste angezeigt.

Du kannst eine oder mehrere Zeilen anklicken. Ausgewählte Zeilen werden klar hervorgehoben und zusammen mit der Erinnerung gespeichert. Wenn die Erinnerung später geöffnet wird, springt die App zur passenden Notiz und hebt die gespeicherten Zeilen temporär hervor.

Falls sich die Notiz zwischenzeitlich geändert hat und eine gespeicherte Zeile nicht mehr eindeutig gefunden wird, öffnet die App trotzdem die Notiz und zeigt einen verständlichen Hinweis an. Der eigentliche Notizinhalt wird dadurch nicht verändert.

## Benachrichtigungen

Beim Auslösen einer Erinnerung kann die App je nach Einstellung unterschiedlich reagieren:

- eine Browser-Benachrichtigung anzeigen
- einen gestalteten Dialog innerhalb der App öffnen
- beide Varianten gleichzeitig nutzen
- den Browser-Tab kurz blinken lassen
- optional einen dezenten Ton abspielen

Wenn Browser-Benachrichtigungen nicht erlaubt oder nicht verfügbar sind, bleibt die App nutzbar und zeigt die Erinnerung innerhalb der App an. Hinweise und Fehler erscheinen oben rechts als gut sichtbare App-Hinweise und blenden sanft ein und aus.

## Speicherung

Notizen, Einstellungen und Erinnerungen werden lokal im Browser gespeichert. Standardmäßig nutzt die App IndexedDB; falls das nicht verfügbar ist, wird localStorage als Fallback verwendet.

Die Daten bleiben erhalten, solange der lokale Browser-Speicher nicht gelöscht wird. Es gibt keinen Server-Upload und keine Anmeldung.

## Import und Export

Du kannst Notizen als Text-, Markdown- oder JSON-Dateien exportieren. JSON-Exporte enthalten auch gespeicherte Erinnerungen.

Beim Import prüft die App die Dateien und fängt ungültige oder beschädigte Inhalte ab. Notizinhalte werden nicht ungefiltert als HTML dargestellt.

## Projektstruktur

Die App ist modular aufgebaut:

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

## Nutzung

Die App kann direkt über `index.html` geöffnet werden.

Für lokale Tests kann auch ein einfacher Webserver verwendet werden:

```bash
python -m http.server 8000
```

Danach ist die App unter `http://localhost:8000` erreichbar.

## Hinweise

Browser-Benachrichtigungen und Töne hängen von den Berechtigungen und Autoplay-Regeln des jeweiligen Browsers ab. Wenn der Browser etwas blockiert, bricht die App nicht ab, sondern nutzt die internen Hinweise.

Alle Inhalte wie Notizen, Hinweistexte und ausgewählte Zeilen werden als Text behandelt. So bleiben Vorschau, Dialoge und Benachrichtigungen gegen ungefilterte HTML-Ausgabe geschützt.
