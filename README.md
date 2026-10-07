# Tracebackend

Eigenständige Kopie von Asteros mit überarbeiteten mobilen Backend-Abläufen.

- [Administration](docs/download/Administration.html)
- [Web-Anwendung](docs/download/Anwendung-Web.html)
- [Mobile Anwendung](docs/download/Anwendung-Mobile.html)
- [Aktueller Testbericht](docs/download/Testbericht.html)

Backend: `backend/`; Web-Administration: `admin/`; mobile App: `mobile/`.
Tracehub (Web-Oberfläche im Projektstamm) hat zwei Ansichten, zwischen denen im Kopfbereich gewechselt wird:

- **DEMO** (`index-demo.html`, `app-demo.js`, `styles-demo.css`): statische Demonstration mit festen Demo-Daten, ohne Backend-Verbindung.
- **PROD** (`index-prod.html`, `app-prod.js`, `styles-prod.css`): produktive Ansicht mit Anmeldung und Daten der eigenen Organisation aus dem Backend, inklusive Sendungen anlegen, ändern, anzeigen und löschen.

`index.html` leitet auf die zuletzt gewählte Ansicht weiter (Standard: PROD; `?edition=demo` erzwingt die Demo). Migration `006_shipments.sql` wird für Sendungen, `008_plot_corrections.sql` für Korrekturanforderungen benötigt. Die Parzellen-Ansicht (PROD) öffnet zunächst die Liste. „Polygon anzeigen“ zeigt ohne Auswahl die erste Parzelle, ansonsten die per Auswahlkästchen markierten Parzellen gemeinsam. „Zurück zur Liste“ erhält die Auswahl. In der Polygonansicht können berechtigte Benutzer Korrekturen pro angezeigter Parzelle, pro Gruppe (Lieferant/Produzent) oder für alle Parzellen anfordern.

Node 24 verwenden. Eigene Datenbank und Umgebungsvariablen einrichten.
Migrationen 001–004 sind vorbereitet, aber nicht auf einer produktiven Datenbank angewendet.
Produktion benötigt HTTPS und S3. Echte iPhone-, S3- und vollständige PostGIS-Abnahme stehen aus.

Die separate Traceright-App wird nicht automatisch mit diesem Backend kompatibel.
