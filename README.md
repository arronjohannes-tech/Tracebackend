# Tracebackend

Eigenständige Kopie von Asteros mit überarbeiteten mobilen Backend-Abläufen.

- [Administration](docs/download/Administration.html)
- [Web-Anwendung](docs/download/Anwendung-Web.html)
- [Mobile Anwendung](docs/download/Anwendung-Mobile.html)
- [Aktueller Testbericht](docs/download/Testbericht.html)
- [Registrierungsfreigabe und mobile Aktivierung](docs/registration-activation.md)

Backend: `backend/`; Web-Administration: `admin/`; mobile App: `mobile/`.
Tracehub (Web-Oberfläche im Projektstamm) hat zwei Ansichten, zwischen denen im Kopfbereich gewechselt wird:

- **DEMO** (`index-demo.html`, `app-demo.js`, `styles-demo.css`): statische Demonstration mit festen Demo-Daten, ohne Backend-Verbindung.
- **PROD** (`index-prod.html`, `app-prod.js`, `styles-prod.css`): produktive Ansicht mit Anmeldung und Daten der eigenen Organisation aus dem Backend, inklusive Sendungen anlegen, ändern, anzeigen und löschen.

Web- und Admin-Sitzungen enden nach 30 Minuten ohne aktive Eingabe oder spätestens 24 Stunden nach der Anmeldung. Nur sichtbare Benutzerinteraktionen melden Aktivität; Hintergrundabrufe verlängern die Sitzung nicht. Beim Ablauf werden ausschließlich Authentifizierungsdaten entfernt, lokale Entwürfe bleiben bestehen. Unter **Administration → Benutzer → Device Audit** sehen System- und Organisationsadministratoren mandantenbezogene Geräte, Sitzungen und die Ereignisse der letzten 30 Tage; die Erfassung speichert keine Tastatureingaben oder eingegebenen Inhalte.

`index.html` leitet auf die zuletzt gewählte Ansicht weiter (Standard: PROD; `?edition=demo` erzwingt die Demo). Migration `006_shipments.sql` wird für Sendungen, `008_plot_corrections.sql` für Korrekturanforderungen benötigt. Der Bereich **PlotAudit** (ehemals Parzellen-Ansicht) öffnet zunächst die Liste. „Polygon anzeigen“ zeigt ohne Auswahl die erste Parzelle, ansonsten die per Auswahlkästchen markierten Parzellen gemeinsam. „Zurück zur Liste“ erhält die Auswahl. In der Polygonansicht können berechtigte Benutzer Korrekturen pro angezeigter Parzelle, pro Gruppe (Lieferant/Produzent) oder für alle Parzellen anfordern. In der Listenansicht ergänzt ein neues Panel **Automatic evidence of deforestation** die automatische Erstbewertung je Parzelle auf Basis von GPS-Punkten und Copernicus-Bildern (Baseline 31.12.2020 vs. aktuelles Bildfenster). Zusätzlich steht dort der Unterbereich **Polygon Upload & Analyse** bereit: GeoJSON-Upload oder manuell eingegebene Polygon-Koordinaten werden wie Parzellen analysiert, einzeln oder gesammelt ausgewertet und bei Bedarf direkt im Karteneditor angepasst. Die Karte nutzt als Hintergrund ein Sentinel-2-Satellitenbild (Copernicus, benötigt die Copernicus-Konfiguration der Organisation und Migration `014_plot_geometry_versions.sql`). Mit „Position anpassen“ lassen sich die Eckpunkte (GPS-Punkte) oder die ganze Fläche auf dem Bild verschieben; das Ergebnis wird als neue GeoJSON-Version gespeichert (Versionsliste mit GeoJSON-Download) und von der mobilen App beim nächsten Abgleich übernommen.

Node 24 verwenden. Eigene Datenbank und Umgebungsvariablen einrichten.

Für den Satellitenhintergrund teilen sich nahe beieinanderliegende, markierte Parzellen einen Bildausschnitt. Weit entfernte Gruppen erhalten getrennte, geografisch positionierte Bilder; eine einzelne zu große Parzelle bleibt ohne Hintergrund. Der Browser lädt maximal drei Hintergrundbilder gleichzeitig. Die Auflösung folgt der dargestellten Kartengröße und Pixeldichte (256/512/1024/2048 Pixel an der längsten Seite, auch nach Fenstergrößenänderungen). Identische Abrufe werden pro Backend-Instanz zusammengefasst und nach Organisation, Bildausschnitt, Auflösung und Wochenintervall zwischengespeichert, sofern der Objektspeicher verfügbar ist. Zwischen getrennten Bildausschnitten wird kein Satellitenbild ergänzt.

Die Polygonansicht bietet zusätzlich „Kartenquelle“ und „Satellitenbild“. In der bestehenden Karte blendet der Schalter den Copernicus-Hintergrund aus/ein, ohne neue Bildabrufe bei ausgeschaltetem Hintergrund. Google Maps ist eine zusätzliche, ausdrücklich auswählbare Quelle mit Straßen-/Satellitenansicht, Zoomen und Verschieben. Google wird erst bei dieser Auswahl geladen und erhält dann die dargestellten Standortdaten. Die Anzeige ersetzt keine EUDR-Prüfung. Parzellenauswahl und Korrekturanforderungen bleiben erhalten; „Position anpassen“ wechselt mit Hinweis zurück in den bestehenden Positionseditor.

### Wischvergleich zum Stichtag 31.12.2020

Vor dem Rollout Migration `016_satellite_comparison.sql` anwenden. Unter **Administration → Organisation → API / EU**
den **Wischvergleich** aktivieren und die Konfiguration speichern (standardmäßig aus).
Copernicus muss eingerichtet und die Satellitenanalyse aktiviert sein; für den zweiten Vergleich zusätzlich Google Maps.
Unter **Plots → Polygon anzeigen → Wischvergleich** zwischen **31.12.2020 / Copernicus aktuell** und
**31.12.2020 / Google Maps** wählen. Der Regler blendet links das historische und rechts das Vergleichsbild ein;
er lässt sich per Maus, Touch und Tastatur bedienen. Auswahl, Korrekturanforderungen und Positionseditor bleiben erhalten.
Positionsbearbeitung beendet den Vergleich und öffnet die bestehende Karte.

Der historische Abruf ist strikt auf **31.12.2020, 00:00:00–23:59:59.999 UTC** begrenzt, unabhängig vom
konfigurierten Rückblick. Die Catalog API prüft, ob im Ausschnitt eine Aufnahme mit dem konfigurierten
Wolkenlimit existiert. Fehlt sie, erscheint ein Hinweis, ohne Ausweichdatum. Fehlende Teilflächen sind grau.
„Aktuell“ verwendet die neuesten verfügbaren Sentinel-2-Daten im angezeigten Suchzeitraum
(mindestens 60 Tage, gegebenenfalls länger laut Konfiguration), nicht zwingend eine Aufnahme von heute.
Googles Aufnahmezeitpunkt ist unbekannt. Dies ist ein visueller Vergleich, kein automatischer Entwaldungsnachweis.

Beide Vergleichsbilder werden deckungsgleich in Web Mercator angefordert; das historische Bild wird über Google
geografisch verankert und folgt Zoom/Verschieben. Der Wischregler selbst löst keine API-Abrufe aus.
Der historische Cache ist datumsfest; aktueller und bisheriger Hintergrund verwenden getrennte Wochen-Caches.
Google-Quellenangaben und Logo bleiben sichtbar. Die Aktivierung wird für jeden Vergleichsabruf serverseitig geprüft.

### Google Maps einrichten

1. Vor dem Backend-Rollout Migration `015_google_maps_config.sql` über den bestehenden Migrationslauf anwenden.
2. In einem eigenen Google-Cloud-Projekt die **Maps JavaScript API** aktivieren und ein Abrechnungskonto verknüpfen. Ein Google-Cloud-Projekt/API-Key wird nicht automatisch angelegt; je nach Nutzung entstehen Kosten.
3. Einen **Browser-API-Key** erstellen: Anwendung auf **Websites (HTTP-Referrer)** beschränken, `https://tracehub-ten.vercel.app/*` und nur tatsächlich verwendete weitere Web-Domains freigeben. API-Beschränkung auf **Maps JavaScript API** setzen; Quoten und Kostenwarnungen im Google-Cloud-Projekt einrichten. Für lokale Tests einen separaten, auf die lokale Test-Origin beschränkten Schlüssel verwenden.
4. Unter [Tracebackend Administration](https://tracehub-ten.vercel.app/admin) als System-/Organisationsadministrator die Organisation wählen, **API / EU → Google Maps** öffnen, den Schlüssel hinterlegen und Google Maps aktivieren. Leere Eingabe behält den Schlüssel. Zum Entfernen deaktivieren und „Schlüssel löschen“ wählen.
5. Unter **Plots → Polygon anzeigen → Kartenquelle: Google Maps** testen. „Satellitenbild“ schaltet zwischen Google-Straßenkarte und Satellitenansicht um. Bei Schlüssel-/Organisationswechsel oder korrigierten Google-Zugriffsbeschränkungen die Seite neu laden.

Die Konfiguration ist organisationsbezogen, der Schlüssel liegt verschlüsselt in der Datenbank. Die Adminansicht und das Audit geben ihn nicht zurück. Der Browser erhält ihn nur authentifiziert mit Parzellen-Leserecht und `Cache-Control: no-store`; für eine Browser-API ist der Schlüssel im Browser dennoch einsehbar. Deshalb sind die Google-seitigen API-/Website-Beschränkungen zwingend. Google-Kacheln werden nicht durch den Copernicus-Bildcache geleitet; Google-Logo und Quellenangaben des SDK bleiben sichtbar. Die bestehende Karte und Satellitenanalyse funktionieren unabhängig von Google Maps.

Google-Dokumentation: [Maps JavaScript API laden](https://developers.google.com/maps/documentation/javascript/load-maps-js-api), [API-Key absichern](https://developers.google.com/maps/api-security-best-practices).

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
