# Tracebackend

Eigenständige Kopie von Asteros mit überarbeiteten mobilen Backend-Abläufen.

- [Administration](docs/download/Administration.html)
- [Web-Anwendung](docs/download/Anwendung-Web.html)
- [Mobile Anwendung](docs/download/Anwendung-Mobile.html)
- [Aktueller Testbericht](docs/download/Testbericht.html)

Backend: `backend/`; Web-Administration: `admin/`; mobile App: `mobile/`.
Der statische Prototyp im Projektstamm ist eine separate Demonstration.

Node 24 verwenden. Eigene Datenbank und Umgebungsvariablen einrichten.
Migrationen 001–004 sind vorbereitet, aber nicht auf einer produktiven Datenbank angewendet.
Produktion benötigt HTTPS und S3. Echte iPhone-, S3- und vollständige PostGIS-Abnahme stehen aus.

Die separate Traceright-App wird nicht automatisch mit diesem Backend kompatibel.
