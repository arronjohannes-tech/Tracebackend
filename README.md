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
In der Polygonansicht (PROD) startet „Satellitenanalyse starten“ den Abruf für alle angezeigten Parzellen. Pro Parzelle wird nacheinander ein eigener, idempotenter API-Auftrag angelegt, damit das Copernicus-Limit pro Lauf keine markierten Parzellen überspringt. Voraussetzung sind die aktivierte Satellitenfunktion und eine vollständig eingerichtete Copernicus-Process-Anbindung; starten dürfen Organisationsadministratoren, Prüfer und Feldmitarbeiter. Testläufe ohne echten Provider werden ausdrücklich gekennzeichnet. „Ergebnis / Status laden“ ruft gespeicherte Aufträge auch nach einem Neuladen ab; PNG/JPEG lassen sich authentifiziert anzeigen, TIFF herunterladen. Die Anzeige ersetzt keine fachliche Entwaldungs- oder EUDR-Bewertung.
Bei Fehlern unterscheiden neue Analyseaufträge die Schritte `geometry`, `token`, `process` und `storage`. Speicherfehler melden ausdrücklich, wenn das Satellitenbild bereits empfangen wurde, und geben Hinweise zu S3-Zugangsdaten, Berechtigungen oder dem Bucket. Ungefilterte Speicherfehlermeldungen mit internen Pfaden oder Zugangsdaten werden nicht an den Browser übermittelt. „Ergebnis / Status laden“ bestätigt die Aktualisierung, startet jedoch keinen neuen Abruf. Bereits gespeicherte generische Fehlermeldungen bleiben unverändert; zur Diagnose nach dem Backend-Update einen neuen Analyseauftrag starten.
Migrationen 001–004 sind vorbereitet, aber nicht auf einer produktiven Datenbank angewendet.
Produktion benötigt HTTPS und S3. Echte iPhone-, S3- und vollständige PostGIS-Abnahme stehen aus.

## Neon Object Storage

`neon.ts` deklariert den privaten Bucket `uploads`. Nach `neon deploy` liegen die
branchgebundenen Verbindungswerte in der ignorierten `.env.local` (bzw. `.env`).
`npm run test:neon-storage` schreibt eine kleine Textdatei mit dem Files SDK,
listet ihren eindeutigen `verification/`-Pfad und vergleicht den Download bytegenau.
Der Test hinterlaesst die Datei als Nachweis im Bucket und gibt keine Secrets aus.
Er nutzt nur die lokale Neon-Umgebung; die Vercel-Produktivvariablen und die
bisherige Backend-Zuordnung zu `tracebackend-documents` werden nicht umgestellt.

Die separate Traceright-App wird nicht automatisch mit diesem Backend kompatibel.
