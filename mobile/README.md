# SCTracker Coffee Mobile

Expo/React-Native-App für Android und iOS mit vollständiger Oberfläche in Deutsch, Englisch, Amharisch, Tigrinya und Afaan Oromoo (Oromia, Sprachcode `om`). Das Benutzer-Icon im Header öffnet das Benutzerkonto mit Name, E-Mail, Abmelden sowie Dropdowns für Organisation und Sprache. Die Sprachauswahl wird lokal gespeichert und ist auch vor der Anmeldung als Dropdown verfügbar. Der Organisationswechsel nutzt weiterhin die benutzer- und organisationsgetrennte lokale Datenhaltung.

## Funktionen

- Offline-fähige Lieferanten- und Kaffee-Plot-Erfassung
- Nur lesende Sendungsliste im Partnerbereich und dauerhafte Sendungszuordnung zu Plots; Liste und Auswahl erscheinen nur bei vorhandenen Datenbank-Sendungen. Anlegen und Bearbeiten erfolgen nicht mobil. Beim Auswählen wird der Lieferant übernommen, die Sendungsdaten bleiben in der Plotansicht separat sichtbar
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

### Gerätesitzungen

Die vom Server gelieferten Sitzungsgrenzen gelten auch mobil: nach 30 Minuten
ohne bestätigte Aktivität oder spätestens nach 24 Stunden ist eine erneute
Anmeldung erforderlich. Berührungen, Scrollen und Texteingaben erneuern bei
Netzverbindung im Hintergrund die Sitzung; Synchronisierung allein tut dies
nicht. Ohne Netz kann die serverseitige Grenze nicht verlängert werden.
Beim Rückkehren in die App wird die Grenze erneut geprüft. Access-/Refresh-Tokens
bleiben in SecureStore. Abmelden entfernt nur die Sitzung, nicht die gespeicherten
Entwürfe oder die Outbox: dieselbe Benutzer-/Organisationskombination lädt sie nach
erneuter Anmeldung wieder. Noch nicht gespeicherte Formularfelder sind keine
dauerhaften Entwürfe. Die vom Backend gemeldeten Rollen stehen unter dem Benutzer-Icon.

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
- `GET /api/v1/shipments`
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

## Registrierung und Erstpasswort-Aktivierung

Android, iOS und Web bieten Registrierung mit Name, E-Mail und Telefonnummer.
Die durchsuchbare Länderauswahl zeigt Flagge, Namen und Vorwahl.
Die Ländernamen werden über einen gebündelten `Intl.DisplayNames`-Polyfill
bereitgestellt, wenn die native JavaScript-Laufzeit diese API nicht unterstützt.
Telefonnummern werden mit den vollständigen Metadaten von `libphonenumber-js/max` geprüft,
dem gewählten Land zugeordnet und in E.164 normalisiert.
Die Registrierung erstellt noch keine Sitzung. Die Bestätigung ist neutral,
unabhängig davon, ob eine Adresse bereits bekannt ist; Freigabe und Rollen-/
Organisationszuweisung erfolgen administrativ, nicht durch die registrierende Person.

Zusätzliche öffentliche API-Endpunkte:

- `POST /api/v1/auth/registrations` mit `{ displayName, email, phoneCountry: "DE", phoneNumber: "+49…" }`
  (ISO-Ländercode entsprechend der Auswahl); `202` mit neutraler Nachricht im `data`-Envelope.
- `POST /api/v1/auth/activate` mit `{ token, password }`; `200` mit
  `data: { message, email }`, danach regulärer Login mit **dieser vom Server
  gelieferten E-Mail** und dem neuen Passwort.

Unterstützte Links (nur diese Hosts/Routen werden akzeptiert):

- HTTPS: `https://tracehub-ten.vercel.app/mobile-activate.html#token=<token>`
- nativer Fallback: `tracehub://activate?token=<token>`

Native Kaltstarts verwenden `Linking.getInitialURL()`, warme Starts den
React-Native-`Linking`-URL-Listener. Web behandelt initiale URL und
`hashchange`/`popstate`; nach Übernahme wird der Fragment-Token aus der
Adresszeile entfernt. Tokens und Passwörter werden nur im Arbeitsspeicher
verarbeitet, weder gespeichert noch protokolliert. Neuladen nach Entfernung des
Fragments erfordert erneutes Öffnen des ursprünglichen Links.
Vor Aktivierung wird eine vorhandene Sitzung inklusive persistentem Session-Key
entfernt; schlägt das fehl, bleibt die Aktivierung blockiert. Ein verspäteter
Login/Refresh darf die alte Sitzung nicht wiederherstellen.

Passwort und Bestätigung müssen übereinstimmen und 12 bis 1024 Zeichen enthalten.
`INVALID_ACTIVATION_TOKEN` wird als
ungültiger/abgelaufener Link angezeigt, mit Hinweis auf einen neuen Link vom
Administrator. Nach erfolgreicher Aktivierung aber fehlgeschlagener Anmeldung
kann man sich über die normale Anmeldung mit dem neuen Passwort anmelden.
Alle neuen Hinweise folgen den bestehenden DE-/EN-/AM-/TI-Übersetzungsmustern;
die Sprachauswahl ist auch vor der Anmeldung verfügbar.

### Build-, Hosting- und Signaturvoraussetzungen für Links

Diese Konfiguration ist **keine Verifikation nativer Links**. Scheme,
Associated Domains und Android-Intent-Filter benoetigen einen neuen nativen
Development-/Release-Build; Expo Go genügt wegen eigener Schemes und des
OCR-Moduls nicht. Das bloße JS-Exportieren signiert oder installiert keine App.

- Der aktuelle iOS-Build verwendet bewusst nur den `tracehub://`-Scheme-Fallback
  der HTTPS-Landingpage. `ios.associatedDomains` bleibt deaktiviert, bis sowohl
  ein passendes Provisioning-Profil als auch die Domainverifikation bereitstehen.
- iOS: Apple-Developer-Team, signierte Provisioning-Profile mit Associated-Domains-
  Berechtigung und tatsächliche Bundle-ID. Der Domainbetreiber muss
  `https://tracehub-ten.vercel.app/.well-known/apple-app-site-association`
  mit der richtigen `TEAM_ID.com.ajohannes.tracebackend`-App-ID und der Route
  `/mobile-activate.html` bereitstellen.
- Android: signierter Build für `com.ajohannes.tracebackend`; der Domainbetreiber
  muss `https://tracehub-ten.vercel.app/.well-known/assetlinks.json` mit Paketname
  und SHA-256-Fingerprints der tatsächlichen Signatur bereitstellen
  (bei Play-Verteilung insbesondere **Play App Signing**, nicht nur Upload-Key).
  `autoVerify: true` allein beweist keine Domainzuordnung.
- Web: `npm run export:web` erzeugt `dist\web` einschließlich
  `mobile-activate.html` als optionalem Einstiegspunkt derselben Expo-App.
  Dieser Export wird aktuell **nicht** produktiv gehostet: Auf Tracehub ist
  dieser Pfad fuer die HTTPS-Landingpage mit dem Button „App öffnen“ reserviert.
  Eine alternative Web-App-Bereitstellung muss Hosting, vertrauenswuerdige
  Aktivierungsroute und API-URL/CORS gemeinsam konfigurieren; keine Weiterleitung,
  die das Fragment verliert. Ein lokaler anderer Host wird absichtlich nicht als Aktivierungslink vertraut.
  Bestehende native-only Funktionen (OCR/GPS/Karte) erhalten dadurch keine
  zusätzliche Web-Funktionalität.

Domain-Verifikationsdateien sind noch nicht veroeffentlicht; Tests der
Aktivierung auf echten Geraeten stehen weiterhin aus.
Vor Freigabe Kalt-/Warmstart, bereits angemeldete Benutzer, ungültige/verbrauchte/
abgelaufene Links, Netzfehler sowie DE/EN/AM auf signierten Android-/iOS-Geräten
und dem echten Web-Host prüfen. Der Scheme-Fallback kann vom Link-Absender oder
der Hosting-Seite angeboten werden; es gibt keine automatische Weiterleitung
zu einem frei aus URL-Parametern gewählten Ziel.

Implementierungsreferenz: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/),
[Linking](https://docs.expo.dev/versions/v57.0.0/sdk/linking/) und
[App-Konfiguration](https://docs.expo.dev/versions/v57.0.0/config/app/).

## Android

Der Anzeigename auf Android und iOS sowie im Login lautet `Tracecomplaince`.
Paketname, Bundle-ID, Deep-Link-Schema und EAS-Projekt bleiben unveraendert,
damit bestehende Installationen aktualisiert werden koennen. Preview- und
Produktionsbuilds erhoehen ihre native Buildnummer automatisch ueber EAS.
Die `.easignore` im Repository-Root schliesst lokale Zugangsdaten, Zertifikate,
Backend-Dateien und generierte mobile Dateien vom Build-Upload aus.

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

Die Preview-APK verwendet aktuell dieselbe produktive Backend-URL wie der Produktionsbuild.
Für externe Tests daher Testkonten und Testdaten verwenden.

### Responsive Android-Tests

Vor der Verteilung der Preview-APK auf mindestens einem kleinen Telefon (ca. 320–360 dp),
einem Standardtelefon (ca. 390 dp) und einem Tablet (ab 600 dp) prüfen. Zusätzlich Hoch- und
Querformat, eine erhöhte Android-Schriftgröße sowie längere Beschriftungen in DE, EN, AM, TI und OM
testen. Formulare müssen bei geöffneter Tastatur scrollbar bleiben; Tabs, Dialoge und Aktionen
müssen ohne abgeschnittene Beschriftungen erreichbar und bedienbar sein.

```powershell
# Android-Bundle lokal auf Fehler prüfen
npm run export:android

# Installierbare Preview-APK über EAS erstellen
npx eas build --platform android --profile preview
```

Die APK kann nach Abschluss des EAS-Builds über dessen interne Verteilungsseite an Testpersonen
weitergegeben werden.
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
npm run export:web
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

Fuer einen bestimmten neuen Build statt einer interaktiven Buildauswahl:

```powershell
eas submit --platform ios --profile production --id <EAS_BUILD_ID> --non-interactive --wait
```

Der Upload geht an die bestehende App-Store-Connect-App `6818269361`.
Erst nach Apples Verarbeitung ist der Build in TestFlight verfuegbar;
ein erfolgreicher EAS-Build allein bestaetigt noch keinen TestFlight-Upload.
Der Anzeigename des installierten Builds wird durch `app.json` festgelegt.
Der separate App-Store-Connect-Name wird dort in den App-Informationen gepflegt.

Der Build erzeugt eine signierte IPA ueber EAS. Fuer `build` und `submit` werden
Apple-Developer-/App-Store-Connect-Berechtigungen benoetigt. Die Bundle-ID ist
`com.ajohannes.tracebackend`; der erste Build verwendet Nummer `1`, danach wird
die Buildnummer durch `autoIncrement` erhoeht.
