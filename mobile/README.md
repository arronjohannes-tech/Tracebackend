# SCTracker Coffee Mobile

Expo/React-Native-App für Android und iOS mit vollständiger Oberfläche in Deutsch, Englisch, Amharisch und Tigrinya. Die Sprachauswahl bleibt dauerhaft im Header verfügbar und wird lokal gespeichert.

## Funktionen

- Offline-fähige Lieferanten- und Kaffee-Plot-Erfassung
- E-Mail-/Passwort-Login mit kurzlebigem Access Token, Refresh Token und Organisationsauswahl; Session verschlüsselt in Expo SecureStore
- echte GeoJSON-Polygone durch mehrere GPS-Punkte sowie JSON-Import und -Bearbeitung, inklusive Bereichs-, Flächen- und Selbstüberschneidungsprüfung
- GPS-Grenzbegehung mit zeitgestempelten Messpunkten, Genauigkeitswerten, Rücknahme, Polygonabschluss und nativer Kartenansicht; GPS-Aufzeichnungen sind Messdaten und werden nicht automatisch als rechtliche Grenze bestätigt
- lokale OCR auf dem Gerät für fotografierte/ausgewählte Bilder; erkannter Text bleibt bearbeitbar und muss manuell geprüft werden. PDFs werden weiterhin nur als Beleg hochgeladen und nicht lokal per OCR verarbeitet
- Grundstücksdokumente können nach abgeschlossenem Upload als Beleg mit einem Plot verknüpft werden; OCR-Angaben verändern niemals automatisch das GPS-Polygon
- lokale Geofence-Vorprüfung mit sichtbarem Backend-/Prüfstatus; Serverentscheidungen bleiben autoritativ
- Standortprüfung im Vordergrund: Beim Hinzufügen eines GPS-Punkts und über „Standort prüfen" zeigt die App sofort, ob der aktuelle Standort innerhalb der Geofences der Organisation liegt (mit Name, Entfernung zum nächsten Geofence und GPS-Genauigkeit). Es wird nur der Standort bei geöffneter App genutzt; Geofencing im Hintergrund („Immer"-Freigabe) ist bewusst nicht enthalten.
- strikt nach Benutzer und ausgewählter Organisation partitionierte AsyncStorage-Daten
- ungescopte V3-/V2-/Legacy-Plot-Daten werden mit Quelle, Originalformat und Rohwert in `sctracker.mobileState.legacyQuarantine.v1` quarantänisiert; sie werden keinem Login zugeordnet und nie automatisch synchronisiert
- retry-sichere Push/Pull-Synchronisierung mit UUID-/Idempotency-IDs, Outbox, Inbox-Cursor und sichtbarer Konfliktauflösung
- Dokument-Upload über Presigned-URL-Initiierung und Abschluss
- geschützter Evidence-Pack-Download als JSON mit Authentifizierungs- und Organisationsheadern, Offline-Queue und automatischem Hintergrund-Download bei wiederhergestellter Verbindung
- Satellitenanalyse, Evidence-Pack-Anforderung mit Download/Teilen sowie DDS-Entwurf, Validierung, Einreichung und Status
- auf-/zuklappbare Listen im Vorgänge-Bereich inklusive Aktionen **Anzeigen** (lokales Dokument öffnen) und **Entfernen** (Eintrag aus Liste löschen)
- sichtbarer Online-/Offline-, Konfigurations- und Synchronisierungsstatus mit manueller Wiederholung

`NOT_CONFIGURED` und eine fehlende API-URL werden immer als blockierende Fehler angezeigt und nie als Erfolg behandelt.

## Konfiguration

`.env.example` nach `.env.local` kopieren und die Backend-Basis-URL setzen:

```powershell
Copy-Item .env.example .env.local
```

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000
```

Es ist keine Produktions-URL fest eingebaut. Für ein physisches Gerät muss die URL vom Gerät erreichbar sein; `localhost` verweist dort auf das Gerät selbst.
OCR benötigt einen nativen Android-/iOS-Build (Expo Go unterstützt das native Modul nicht). Für Karten unter Android muss `GOOGLE_MAPS_API_KEY` als Build-Umgebungsvariable gesetzt sein; ohne Schlüssel bleibt die Kartenkomponente auf nativen Plattformen von der Google-Kartenkonfiguration abhängig. Die Web-Version lädt keine externen Kartenkacheln.

Die App erwartet JSON-Antworten im Format `{ "data": ..., "meta": ... }` und Fehler als `{ "error": { "code": "...", "message": "...", "details": ... } }`.

Verwendete Endpunkte:

- `POST /api/v1/auth/login` (`{ email, password, organizationSlug? }`)
- `POST /api/v1/auth/refresh` (`{ refreshToken }`)
- `POST /api/v1/auth/logout` (`{ refreshToken }`)
- `GET /api/v1/geofences`
- `POST /api/v1/sync/push`
- `GET /api/v1/sync/pull?cursor=...`
- `POST /api/v1/documents/uploads`
- `POST /api/v1/documents/uploads/:id/complete`
- `POST|GET /api/v1/satellite/analyses[/:id]`
- `POST|GET /api/v1/evidence-packs[/:id]`
- `POST|GET /api/v1/dds/drafts[/:id]`
- `POST /api/v1/dds/drafts/:id/validate`
- `POST /api/v1/dds/drafts/:id/submit`

Login/Refresh liefern unter `data` mindestens `accessToken`, `refreshToken`, `user`,
`organizations` sowie `expiresIn` (Sekunden) oder `accessTokenExpiresAt`. Jeder
geschützte Request erhält `Authorization: Bearer <accessToken>` und
`X-Organization-Id: <id>`. Bei `401` wird einmalig aktualisiert und wiederholt.

## Android

iOS und Android nutzen dieselbe Codebasis (Expo, keine nativen Ordner im Repository); es gibt keine
separate Android-Kopie. Plattformabhängig ist nur Weniges (Statusleisten-Abstand, Schriftfamilien,
Öffnen lokaler Dokumente über das Android-Teilen-Menü statt `file://`-Links).

Builds (EAS, Paket `com.ajohannes.tracebackend`):

```powershell
# APK zum direkten Installieren/Testen (interne Verteilung)
npx eas build --platform android --profile preview

# AAB für den Play Store
npx eas build --platform android --profile production
```

Der Android-Signaturschlüssel (Keystore) liegt bei EAS; Builds laufen mit `--non-interactive`. Für die
Veröffentlichung im Play Store wird zusätzlich ein Google-Play-Konto mit Service-Account-Schlüssel
benötigt (`eas submit`); die erste Version muss im Play Console einmal manuell angelegt werden.
Lokale Prüfung des Android-Bundles: `npm run export:android`.
## Legacy-Quarantäne

Ungescopte Daten aus `sctracker.mobileState.v3`, `sctracker.mobileState.v2` und
`sctracker.plotDrafts.v1` werden nicht einem Benutzer oder Mandanten zugeordnet.
Die App schreibt zuerst Quelle, Format und unveränderten Rohwert in
`sctracker.mobileState.legacyQuarantine.v1`. Nur nach erfolgreichem Schreiben
werden die aktiven Legacy-Keys best effort entfernt. Quarantänedaten werden
weder geladen noch automatisch synchronisiert; jeder neue authentifizierte
Scope beginnt leer.

`GEOFENCE_REVIEW_REQUIRED` kann unter `error.details.violations` Einträge mit
`violationId`, `operationId` und `entityId` liefern. Nur exakt passende
Plot-Operationen werden bis zum manuellen Retry pausiert; alle übrigen
Operationen werden im selben Sync-Vorgang erneut gepusht.

## Entwicklung

```powershell
npm install
npm start
```

## Prüfungen

```powershell
npm test
npm run typecheck
npx expo-doctor
npm run export:android
npm run export:ios
```

Für signierte Builds werden weiterhin Expo Application Services sowie die jeweiligen Apple-/Google-Entwicklerkonten benötigt.

## TestFlight

Vor dem ersten Build muss der Backend-Deployment-Schutz fuer
`https://tracebackend-backend-meloy.vercel.app` fuer mobile Zugriffe freigegeben
sein. Die Produktionsprofile setzen diese URL als `EXPO_PUBLIC_API_URL`.

```powershell
npx eas login
npx eas build:configure
npx eas build --platform ios --profile production
npx eas submit --platform ios --profile production
```

Der Build erzeugt eine signierte IPA ueber EAS. Fuer `build` und `submit` werden
Apple-Developer-/App-Store-Connect-Berechtigungen benoetigt. Die Bundle-ID ist
`com.ajohannes.tracebackend`; der erste Build verwendet Nummer `1`, danach wird
die Buildnummer durch `autoIncrement` erhoeht.
