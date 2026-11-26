export const languages = ["de", "en", "am", "ti", "om"] as const;
export type Language = (typeof languages)[number];

export type Translation = {
  languageName: string;
  userAccount: string;
  languageCode: string;
  chooseLanguage: string;
  languageHint: string;
  close: string;
  brandSubtitle: string;
  auth: {
    title: string;
    email: string;
    password: string;
    organizationSlug: string;
    signIn: string;
    signOut: string;
    selectOrganization: string;
    register: string;
    phone: string;
    country: string;
    searchCountry: string;
    invalidRegistration: string;
    pendingApproval: string;
    requestFailed: string;
    backToLogin: string;
    activate: string;
    activationIntro: string;
    confirmPassword: string;
    passwordHint: string;
    passwordMismatch: string;
    invalidActivation: string;
    activationFailed: string;
    activationLoginFailed: string;
    clearingSession: string;
    sessionClearFailed: string;
  };
  tabs: { home: string; suppliers: string; plots: string; operations: string; help: string };
  common: {
    save: string;
    create: string;
    refresh: string;
    retry: string;
    download: string;
    share: string;
    status: string;
    name: string;
    region: string;
    subjectId: string;
    pending: string;
    synced: string;
    failed: string;
    conflict: string;
  };
  sync: {
    online: string;
    offline: string;
    syncing: string;
    queued: string;
    lastSync: string;
    never: string;
    syncNow: string;
    configured: string;
    notConfigured: string;
    notConfiguredDetail: string;
    success: string;
    error: string;
    conflicts: string;
    keepLocal: string;
    useServer: string;
  };
  home: { title: string; intro: string; suppliers: string; plots: string; documents: string };
  suppliers: {
    title: string;
    description: string;
    add: string;
    empty: string;
    producerCount: string;
    plotCount: string;
    update: string;
    newSupplier: string;
    selected: string;
    remoteTitle: string;
    remoteEmpty: string;
    loadRemote: string;
    shipmentsTitle: string;
    shipmentsDescription: string;
    shipmentsEmpty: string;
    editShipment: string;
    newShipment: string;
    shipmentReference: string;
    shipmentProduct: string;
    shipmentHsCode: string;
    shipmentQuantity: string;
    shipmentOriginCountry: string;
    shipmentOriginRegion: string;
    shipmentSupplier: string;
    noSupplier: string;
    shipmentDestination: string;
    shipmentStatus: string;
    status_planned: string;
    status_in_transit: string;
    status_arrived: string;
    status_cancelled: string;
    shipmentExpectedArrival: string;
    shipmentNotes: string;
    createShipment: string;
    updateShipment: string;
    clearShipment: string;
  };
  plots: {
    title: string;
    description: string;
    producer: string;
    farm: string;
    area: string;
    supplierId: string;
    selectedShipment: string;
    shipment: string;
    noShipment: string;
    producerRequired: string;
    farmRequired: string;
    areaRequired: string;
    areaInvalid: string;
    polygonRequired: string;
    invalidPolygonDetail: string;
    polygonHint: string;
    capturePoint: string;
    pointCount: string;
    polygonJson: string;
    importGeoJson: string;
    applyGeoJson: string;
    saveDraft: string;
    empty: string;
    invalidPolygon: string;
    gpsError: string;
    permissionError: string;
    geofence: string;
    geofencePending: string;
    geofenceInside: string;
    geofenceOutside: string;
    geofenceReview: string;
    geofenceApproved: string;
    geofenceBlocked: string;
    maxPoints: string;
    reset: string;
    cancel: string;
    duplicatePoint: string;
    checkLocation: string;
    locationInside: string;
    locationOutside: string;
    locationDistance: string;
    locationPending: string;
    locationAccuracy: string;
    startWalk: string;
    stopWalk: string;
    undoPoint: string;
    trackCount: string;
    selectDocument: string;
    noDocument: string;
    linkedDocument: string;
    mapUnavailable: string;
    organicMapOpen: string;
    organicMapDetail: string;
    organicMapChoose: string;
    organicMapInstallTitle: string;
    organicMapInstallDetail: string;
    organicMapInstallAction: string;
    organicMapError: string;
    offlineMapInfo: string;
    offlineMapReady: string;
    offlineMapDownload: string;
    offlineMapDownloading: string;
    offlineMapRemove: string;
    offlineMapRemoveConfirm: string;
    offlineMapError: string;
    tooFewTrackPoints: string;
  };
  operations: {
    title: string;
    plotSelection: string;
    plotUploadRequired: string;
    documents: string;
    pickUpload: string;
    uploadsList: string;
    requestsList: string;
    downloadedList: string;
    satellite: string;
    requestSatellite: string;
    evidence: string;
    requestEvidence: string;
    dds: string;
    createDds: string;
    validateDds: string;
    submitDds: string;
    checkStatus: string;
    showLocal: string;
    removeItem: string;
    queuedDownload: string;
    downloading: string;
    downloaded: string;
    noItems: string;
    providerBlocked: string;
    scanPhoto: string;
    chooseImage: string;
    ocrText: string;
    ocrReview: string;
    ocrUnavailable: string;
    ocrFailed: string;
    ocrEmpty: string;
  };
  help: { title: string; body: string };
  alerts: { required: string; saved: string; storageError: string };
};

export const translations = {
  de: {
    userAccount: "Benutzerkonto",
    languageName: "Deutsch", languageCode: "DE", chooseLanguage: "Sprache auswählen",
    languageHint: "Die Auswahl wird auf diesem Gerät gespeichert.", close: "Schließen",
    brandSubtitle: "Kaffee-Nachweise",
    auth: {
      title: "Anmelden", email: "E-Mail", password: "Passwort",
      organizationSlug: "Organisationskürzel (optional)", signIn: "Anmelden",
      signOut: "Abmelden", selectOrganization: "Organisation auswählen",
      register: "Registrierung anfragen", phone: "Telefonnummer", country: "Land",
      searchCountry: "Land oder Vorwahl suchen",
      invalidRegistration: "Bitte Name, gültige E-Mail und eine gültige Telefonnummer für das gewählte Land eingeben.",
      pendingApproval: "Vielen Dank. Falls die Anfrage berücksichtigt werden kann, wird sie geprüft. Nach Freigabe erhalten Sie eine E-Mail mit den nächsten Schritten.",
      requestFailed: "Die Anfrage konnte nicht gesendet werden. Bitte Verbindung prüfen und erneut versuchen.",
      backToLogin: "Zur Anmeldung", activate: "Passwort festlegen und anmelden",
      activationIntro: "Legen Sie Ihr erstes Passwort fest. Anschließend werden Sie angemeldet.",
      confirmPassword: "Passwort bestätigen", passwordHint: "Mindestens 12 Zeichen. Die Passwortregeln des Servers gelten zusätzlich.",
      passwordMismatch: "Bitte mindestens 12 Zeichen eingeben und das Passwort identisch bestätigen.",
      invalidActivation: "Dieser Aktivierungslink ist ungültig oder abgelaufen. Bitte einen neuen Link beim Administrator anfordern.",
      activationFailed: "Aktivierung nicht abgeschlossen. Verbindung und Passwortregeln prüfen und erneut versuchen. Bei abgelaufenem Link den Administrator kontaktieren.",
      activationLoginFailed: "Das Passwort wurde gespeichert, aber die Anmeldung ist fehlgeschlagen. Bitte mit Ihrer E-Mail und dem neuen Passwort anmelden.",
      clearingSession: "Vorherige Sitzung wird sicher entfernt …",
      sessionClearFailed: "Die vorherige Sitzung konnte nicht sicher entfernt werden. Bitte lokalen App-Speicher löschen und den Link erneut öffnen.",
    },
    tabs: { home: "Start", suppliers: "Partner", plots: "Plots", operations: "Vorgänge", help: "Hilfe" },
    common: {
      save: "Speichern", create: "Erstellen", refresh: "Aktualisieren", retry: "Erneut versuchen",
      download: "Herunterladen", share: "Teilen", status: "Status", name: "Name", region: "Region",
      subjectId: "Referenz-ID", pending: "Ausstehend", synced: "Synchronisiert", failed: "Fehlgeschlagen",
      conflict: "Konflikt",
    },
    sync: {
      online: "Online", offline: "Offline", syncing: "Synchronisierung ...", queued: "in Warteschlange",
      lastSync: "Letzte Synchronisierung", never: "Noch nie", syncNow: "Jetzt synchronisieren",
      configured: "Backend konfiguriert", notConfigured: "Backend nicht konfiguriert",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL fehlt. Synchronisierung und Provider-Vorgänge sind blockiert.",
      success: "Synchronisierung abgeschlossen", error: "Synchronisierung fehlgeschlagen",
      conflicts: "Synchronisierungskonflikte", keepLocal: "Lokale Version behalten", useServer: "Serverversion verwenden",
    },
    home: {
      title: "Feldübersicht", intro: "Offline erfassen, sicher synchronisieren und Compliance-Vorgänge verfolgen.",
      suppliers: "Lieferanten", plots: "Kaffee-Plots", documents: "Dokumente",
    },
    suppliers: {
      title: "Lieferanten", description: "Lieferanten werden offline angelegt und über die Outbox synchronisiert.",
      add: "Lieferant hinzufügen", empty: "Noch keine Lieferanten.", producerCount: "Produzenten", plotCount: "Plots",
      update: "Lieferant aktualisieren", newSupplier: "Neuer Lieferant", selected: "Ausgewählt",
      remoteTitle: "Lieferanten aus der Datenbank", remoteEmpty: "Keine weiteren Lieferanten in der Datenbank.",
      loadRemote: "Aus Datenbank laden",
      shipmentsTitle: "Sendungen", shipmentsDescription: "Vorhandene Sendungen ansehen und für die Zuordnung zu einem Plot auswählen.",
      shipmentsEmpty: "Noch keine Sendungen vorhanden.", editShipment: "Sendung bearbeiten", newShipment: "Neue Sendung",
      shipmentReference: "Referenz", shipmentProduct: "Produkt", shipmentHsCode: "HS-Code",
      shipmentQuantity: "Menge (kg)", shipmentOriginCountry: "Ursprungsland", shipmentOriginRegion: "Ursprungsregion",
      shipmentSupplier: "Lieferant", noSupplier: "Kein Lieferant", shipmentDestination: "Ziel",
      shipmentStatus: "Sendungsstatus", status_planned: "Geplant", status_in_transit: "Unterwegs",
      status_arrived: "Eingetroffen", status_cancelled: "Storniert", shipmentExpectedArrival: "Erwartete Ankunft (JJJJ-MM-TT)",
      shipmentNotes: "Notizen", createShipment: "Sendung erstellen", updateShipment: "Sendung speichern",
      clearShipment: "Sendungsauswahl aufheben",
    },
    plots: {
      title: "GeoJSON-Plots", description: "Eine Grundstücksgrenze per GPS-Begehung erfassen oder ein GeoJSON-Polygon importieren.",
      producer: "Produzent", farm: "Plot- oder Farmname", area: "Fläche (ha)", supplierId: "Lieferanten-ID (optional)",
      selectedShipment: "Ausgewählte Sendung", shipment: "Sendungsdetails", noShipment: "Keine Sendung",
      producerRequired: "Bitte den Produzentennamen eingeben.",
      farmRequired: "Bitte den Plot- oder Farmnamen eingeben.",
      areaRequired: "Bitte die Fläche in Hektar eingeben.",
      areaInvalid: "Die Fläche muss eine Zahl größer als 0 sein.",
      polygonRequired: "Bitte ein GeoJSON-Polygon übernehmen oder mindestens drei GPS-Punkte erfassen.",
      invalidPolygonDetail: "GeoJSON muss ein Polygon enthalten. Koordinaten als [Längengrad, Breitengrad] angeben; mindestens drei verschiedene Punkte verwenden und den ersten Punkt am Ende wiederholen.",
      polygonHint: "GeoJSON Polygon mit Koordinaten [Längengrad, Breitengrad]. GPS-Punkte werden beim Speichern automatisch zu einem Polygon geschlossen.",
      capturePoint: "GPS-Punkt hinzufügen", pointCount: "Punkte", polygonJson: "GeoJSON Polygon",
      importGeoJson: "GeoJSON importieren", applyGeoJson: "GeoJSON übernehmen", saveDraft: "Offline-Plot speichern",
      empty: "Noch keine Plot-Entwürfe.", invalidPolygon: "Das Polygon ist ungültig. Mindestens drei unterschiedliche Positionen sind erforderlich.",
      gpsError: "Der Standort konnte nicht ermittelt werden.", permissionError: "Standortberechtigung wurde nicht erteilt.",
      geofence: "Geofence", geofencePending: "Ausstehend", geofenceInside: "Innerhalb",
      geofenceOutside: "Außerhalb", geofenceReview: "Prüfung erforderlich",
      geofenceApproved: "Freigegeben", geofenceBlocked: "Lokal blockiert; das Backend entscheidet endgültig.",
      maxPoints: "Die GPS-Aufzeichnung ist auf 10.000 Punkte begrenzt.", reset: "Reset", cancel: "Abbrechen",
      duplicatePoint: "Dieser GPS-Punkt liegt zu nah an einem bereits erfassten Punkt. Bitte einige Meter weitergehen und erneut erfassen.",
      checkLocation: "Standort prüfen", locationInside: "Standort innerhalb des Geofence",
      locationOutside: "Standort außerhalb aller Geofences. Eine hier erfasste Parzelle wird zur Prüfung vorgelegt.",
      locationDistance: "bis zum nächsten Geofence",
      locationPending: "Für diese Organisation sind keine Geofences geladen; der Standort kann nicht geprüft werden.",
      locationAccuracy: "Genauigkeit",
      startWalk: "Grenzbegehung starten",
      stopWalk: "Begehung beenden und Polygon bilden",
      undoPoint: "Letzten GPS-Punkt entfernen",
      trackCount: "Aufgezeichnete GPS-Punkte",
      selectDocument: "Grundstücksdokument als Beleg verknüpfen",
      noDocument: "Kein Dokument verknüpft",
      linkedDocument: "Verknüpft",
      mapUnavailable: "Die Kartenansicht ist auf dieser Plattform nicht verfügbar.",
      organicMapOpen: "In Organic Maps öffnen",
      organicMapDetail: "Grenzen und GPS-Spur werden als Momentaufnahme geteilt. Wählen Sie Organic Maps; die Anzeige wird nicht live aktualisiert. Für Offline-Karten laden Sie die Region dort vorher herunter.",
      organicMapChoose: "Organic Maps auswählen",
      organicMapInstallTitle: "Organic Maps installieren",
      organicMapInstallDetail: "Für die Kartenansicht wird die kostenlose App Organic Maps benötigt. Nach der Installation bitte erneut öffnen.",
      organicMapInstallAction: "Zum Play Store",
      organicMapError: "Die Karte konnte nicht geöffnet werden.",
      offlineMapInfo: "Offline-Karte Äthiopien: einmaliger Download von etwa 350 MB. GPS funktioniert auch ohne Karte.",
      offlineMapReady: "Die Offline-Karte Äthiopien ist auf diesem Gerät gespeichert.",
      offlineMapDownload: "Offline-Karte herunterladen",
      offlineMapDownloading: "Karte wird heruntergeladen",
      offlineMapRemove: "Offline-Karte entfernen",
      offlineMapRemoveConfirm: "Die gespeicherte Karte entfernen? GPS und Plot-Entwürfe bleiben erhalten.",
      offlineMapError: "Die Offline-Karte konnte nicht geladen werden",
      tooFewTrackPoints: "Für eine Grenze sind mindestens drei unterschiedliche GPS-Punkte erforderlich.",
    },
    operations: {
      title: "Compliance-Vorgänge", plotSelection: "Plot-ID auswählen", plotUploadRequired: "Wählen Sie einen synchronisierten Plot und stellen Sie eine Internetverbindung her.", documents: "Dokumente", pickUpload: "Dokument auswählen und hochladen",
      uploadsList: "Upload-Liste", requestsList: "Vorgangs-Liste", downloadedList: "Downloads",
      satellite: "Satellitenanalyse", requestSatellite: "Analyse anfordern", evidence: "Evidence Pack",
      requestEvidence: "Evidence Pack anfordern", dds: "DDS-Entwurf", createDds: "DDS-Entwurf erstellen",
      validateDds: "Validieren", submitDds: "Einreichen", checkStatus: "Status abrufen",
      showLocal: "Anzeigen", removeItem: "Entfernen", queuedDownload: "Wird heruntergeladen, sobald online.",
      downloading: "Download läuft ...", downloaded: "Lokal gespeichert",
      noItems: "Noch keine Vorgänge.", providerBlocked: "Provider-Konfiguration fehlt. Dieser Vorgang ist blockiert.",
      scanPhoto: "Dokument fotografieren und hochladen",
      chooseImage: "Bild auswählen und hochladen",
      ocrText: "Lokal erkannter Text (bearbeitbar, bitte manuell prüfen)",
      ocrReview: "OCR-Text manuell geprüft",
      ocrUnavailable: "Lokale Texterkennung ist auf diesem Gerät nicht verfügbar.",
      ocrFailed: "Lokale Texterkennung fehlgeschlagen",
      ocrEmpty: "Kein Text erkannt. Bildqualität und Ausrichtung prüfen.",
    },
    help: {
      title: "Offline und Datenschutz",
      body: "GPS- und Personendaten nur mit Einwilligung erfassen. Lokale Änderungen bleiben bis zur bestätigten Synchronisierung erhalten. Konflikte werden nie automatisch überschrieben.",
    },
    alerts: { required: "Bitte alle erforderlichen Felder ausfüllen.", saved: "Offline gespeichert.", storageError: "Lokale Daten konnten nicht sicher gespeichert werden." },
  },
  en: {
    userAccount: "User account",
    languageName: "English", languageCode: "EN", chooseLanguage: "Choose language",
    languageHint: "The selection is saved on this device.", close: "Close",
    brandSubtitle: "Coffee Evidence",
    auth: {
      title: "Sign in", email: "Email", password: "Password",
      organizationSlug: "Organization slug (optional)", signIn: "Sign in",
      signOut: "Sign out", selectOrganization: "Select organization",
      register: "Request registration", phone: "Phone number", country: "Country",
      searchCountry: "Search country or calling code",
      invalidRegistration: "Enter your name, a valid email and a valid phone number for the selected country.",
      pendingApproval: "Thank you. If the request is eligible, it will be reviewed. After approval, an email will explain the next steps.",
      requestFailed: "The request could not be sent. Check your connection and try again.",
      backToLogin: "Back to sign in", activate: "Set password and sign in",
      activationIntro: "Set your initial password. You will then be signed in.",
      confirmPassword: "Confirm password", passwordHint: "At least 12 characters. Server password rules also apply.",
      passwordMismatch: "Enter at least 12 characters and an identical password confirmation.",
      invalidActivation: "This activation link is invalid or expired. Ask your administrator for a new link.",
      activationFailed: "Activation was not completed. Check your connection and password rules, then retry. Contact your administrator if the link expired.",
      activationLoginFailed: "Your password was saved, but sign-in failed. Sign in with your email and new password.",
      clearingSession: "Securely removing the previous session …",
      sessionClearFailed: "The previous session could not be safely removed. Clear local app storage and reopen the link.",
    },
    tabs: { home: "Home", suppliers: "Partners", plots: "Plots", operations: "Operations", help: "Help" },
    common: {
      save: "Save", create: "Create", refresh: "Refresh", retry: "Retry", download: "Download",
      share: "Share", status: "Status", name: "Name", region: "Region", subjectId: "Reference ID",
      pending: "Pending", synced: "Synced", failed: "Failed", conflict: "Conflict",
    },
    sync: {
      online: "Online", offline: "Offline", syncing: "Synchronising ...", queued: "queued",
      lastSync: "Last sync", never: "Never", syncNow: "Sync now", configured: "Backend configured",
      notConfigured: "Backend not configured",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL is missing. Synchronisation and provider operations are blocked.",
      success: "Synchronisation completed", error: "Synchronisation failed", conflicts: "Sync conflicts",
      keepLocal: "Keep local version", useServer: "Use server version",
    },
    home: {
      title: "Field overview", intro: "Capture offline, synchronise safely, and track compliance operations.",
      suppliers: "Suppliers", plots: "Coffee plots", documents: "Documents",
    },
    suppliers: {
      title: "Suppliers", description: "Suppliers are created offline and synchronised through the outbox.",
      add: "Add supplier", empty: "No suppliers yet.", producerCount: "Producers", plotCount: "Plots",
      update: "Update supplier", newSupplier: "New supplier", selected: "Selected",
      remoteTitle: "Suppliers from the database", remoteEmpty: "No further suppliers in the database.",
      loadRemote: "Load from database",
      shipmentsTitle: "Shipments", shipmentsDescription: "View existing shipments and select one to link to a plot.",
      shipmentsEmpty: "No shipments yet.", editShipment: "Edit shipment", newShipment: "New shipment",
      shipmentReference: "Reference", shipmentProduct: "Product", shipmentHsCode: "HS code",
      shipmentQuantity: "Quantity (kg)", shipmentOriginCountry: "Origin country", shipmentOriginRegion: "Origin region",
      shipmentSupplier: "Supplier", noSupplier: "No supplier", shipmentDestination: "Destination",
      shipmentStatus: "Shipment status", status_planned: "Planned", status_in_transit: "In transit",
      status_arrived: "Arrived", status_cancelled: "Cancelled", shipmentExpectedArrival: "Expected arrival (YYYY-MM-DD)",
      shipmentNotes: "Notes", createShipment: "Create shipment", updateShipment: "Save shipment",
      clearShipment: "Clear shipment selection",
    },
    plots: {
      title: "GeoJSON plots", description: "Record a parcel boundary while walking with GPS, or import a GeoJSON Polygon.",
      producer: "Producer", farm: "Plot or farm name", area: "Area (ha)", supplierId: "Supplier ID (optional)",
      selectedShipment: "Selected shipment", shipment: "Shipment details", noShipment: "No shipment",
      producerRequired: "Enter the producer name.",
      farmRequired: "Enter the plot or farm name.",
      areaRequired: "Enter the area in hectares.",
      areaInvalid: "Area must be a number greater than 0.",
      polygonRequired: "Apply a GeoJSON Polygon or capture at least three GPS points.",
      invalidPolygonDetail: "GeoJSON must contain a Polygon. Use coordinates as [longitude, latitude], include at least three distinct points, and repeat the first point at the end.",
      polygonHint: "GeoJSON Polygon coordinates use [longitude, latitude]. GPS points are automatically closed into a polygon when saved.",
      capturePoint: "Add GPS point", pointCount: "Points", polygonJson: "GeoJSON Polygon",
      importGeoJson: "Import GeoJSON", applyGeoJson: "Apply GeoJSON", saveDraft: "Save offline plot",
      empty: "No plot drafts yet.", invalidPolygon: "The polygon is invalid. At least three distinct positions are required.",
      gpsError: "The current location could not be determined.", permissionError: "Location permission was not granted.",
      geofence: "Geofence", geofencePending: "Pending", geofenceInside: "Inside",
      geofenceOutside: "Outside", geofenceReview: "Review required",
      geofenceApproved: "Approved", geofenceBlocked: "Locally blocked; the backend remains authoritative.",
      maxPoints: "GPS recording is limited to 10,000 points.", reset: "Reset", cancel: "Cancel",
      duplicatePoint: "This GPS point is too close to a point already captured. Move a few metres and capture again.",
      checkLocation: "Check location", locationInside: "Location is inside the geofence",
      locationOutside: "Location is outside all geofences. A plot captured here will be submitted for review.",
      locationDistance: "to the nearest geofence",
      locationPending: "No geofences are loaded for this organization; the location cannot be checked.",
      locationAccuracy: "Accuracy",
      startWalk: "Start boundary walk",
      stopWalk: "Finish walk and create polygon",
      undoPoint: "Remove last GPS point",
      trackCount: "Recorded GPS points",
      selectDocument: "Link a parcel document as evidence",
      noDocument: "No document linked",
      linkedDocument: "Linked",
      mapUnavailable: "Map preview is not available on this platform.",
      organicMapOpen: "Open in Organic Maps",
      organicMapDetail: "Boundaries and GPS tracks are shared as a snapshot. Select Organic Maps; the display does not update live. Download the region there first for offline maps.",
      organicMapChoose: "Select Organic Maps",
      organicMapInstallTitle: "Install Organic Maps",
      organicMapInstallDetail: "The free Organic Maps app is required for the map view. Please try again after installing it.",
      organicMapInstallAction: "Open Play Store",
      organicMapError: "The map could not be opened.",
      offlineMapInfo: "Offline map of Ethiopia: a one-time download of about 350 MB. GPS also works without the map.",
      offlineMapReady: "The offline map of Ethiopia is saved on this device.",
      offlineMapDownload: "Download offline map",
      offlineMapDownloading: "Downloading map",
      offlineMapRemove: "Remove offline map",
      offlineMapRemoveConfirm: "Remove the saved map? GPS and plot drafts will be kept.",
      offlineMapError: "The offline map could not be loaded",
      tooFewTrackPoints: "At least three distinct GPS points are required for a boundary.",
    },
    operations: {
      title: "Compliance operations", plotSelection: "Select plot ID", plotUploadRequired: "Select a synchronized plot and connect to the internet.", documents: "Documents", pickUpload: "Pick and upload document",
      uploadsList: "Upload list", requestsList: "Operation list", downloadedList: "Downloads",
      satellite: "Satellite analysis", requestSatellite: "Request analysis", evidence: "Evidence pack",
      requestEvidence: "Request evidence pack", dds: "DDS draft", createDds: "Create DDS draft",
      validateDds: "Validate", submitDds: "Submit", checkStatus: "Check status", noItems: "No operations yet.",
      showLocal: "Show", removeItem: "Remove", queuedDownload: "Will download automatically when online.",
      downloading: "Downloading ...", downloaded: "Saved locally",
      providerBlocked: "Provider configuration is missing. This operation is blocked.",
      scanPhoto: "Photograph and upload document",
      chooseImage: "Choose and upload image",
      ocrText: "Locally recognized text (editable; review manually)",
      ocrReview: "OCR text manually reviewed",
      ocrUnavailable: "On-device text recognition is not available on this device.",
      ocrFailed: "On-device text recognition failed",
      ocrEmpty: "No text recognized. Check image quality and orientation.",
    },
    help: {
      title: "Offline and privacy",
      body: "Capture GPS and personal data only with consent. Local changes remain until sync is confirmed. Conflicts are never overwritten automatically.",
    },
    alerts: { required: "Complete all required fields.", saved: "Saved offline.", storageError: "Local data could not be stored safely." },
  },
  am: {
    userAccount: "የተጠቃሚ መለያ",
    languageName: "አማርኛ", languageCode: "አማ", chooseLanguage: "ቋንቋ ይምረጡ",
    languageHint: "ምርጫው በዚህ መሣሪያ ላይ ይቀመጣል።", close: "ዝጋ", brandSubtitle: "የቡና ማስረጃ",
    auth: {
      title: "ይግቡ", email: "ኢሜይል", password: "የይለፍ ቃል",
      organizationSlug: "የድርጅት አጭር መለያ (አማራጭ)", signIn: "ይግቡ",
      signOut: "ውጣ", selectOrganization: "ድርጅት ይምረጡ",
      register: "የምዝገባ ጥያቄ ያስገቡ", phone: "ስልክ ቁጥር", country: "አገር",
      searchCountry: "አገር ወይም የመደወያ ኮድ ይፈልጉ",
      invalidRegistration: "ስምዎን፣ ትክክለኛ ኢሜይል እና ለተመረጠው አገር ትክክለኛ ስልክ ቁጥር ያስገቡ።",
      pendingApproval: "እናመሰግናለን። ጥያቄው ብቁ ከሆነ ይገመገማል። ከጸደቀ በኋላ የሚቀጥሉት እርምጃዎች በኢሜይል ይላካሉ።",
      requestFailed: "ጥያቄው አልተላከም። ግንኙነትዎን ያረጋግጡ እና እንደገና ይሞክሩ።",
      backToLogin: "ወደ መግቢያ ተመለስ", activate: "የይለፍ ቃል ያዘጋጁ እና ይግቡ",
      activationIntro: "የመጀመሪያ የይለፍ ቃልዎን ያዘጋጁ። ከዚያ ወደ መለያዎ ይገባሉ።",
      confirmPassword: "የይለፍ ቃል ያረጋግጡ", passwordHint: "ቢያንስ 12 ቁምፊዎች። የሰርቨሩ የይለፍ ቃል ደንቦችም ተፈጻሚ ናቸው።",
      passwordMismatch: "ቢያንስ 12 ቁምፊዎች እና ተመሳሳይ ማረጋገጫ ያስገቡ።",
      invalidActivation: "የማግበሪያ አገናኙ ልክ አይደለም ወይም ጊዜው አልፏል። አዲስ አገናኝ ከአስተዳዳሪዎ ይጠይቁ።",
      activationFailed: "ማግበሩ አልተጠናቀቀም። ግንኙነትና የይለፍ ቃል ደንቦችን ያረጋግጡ። አገናኙ ካለፈ አስተዳዳሪዎን ያነጋግሩ።",
      activationLoginFailed: "የይለፍ ቃልዎ ተቀምጧል፣ ግን መግባት አልተሳካም። በኢሜይልዎ እና በአዲሱ የይለፍ ቃል ይግቡ።",
      clearingSession: "የቀድሞው ክፍለ ጊዜ በደህንነት እየተወገደ ነው …",
      sessionClearFailed: "የቀድሞው ክፍለ ጊዜ አልተወገደም። የመተግበሪያውን አካባቢያዊ ማከማቻ ያጽዱ እና አገናኙን እንደገና ይክፈቱ።",
    },
    tabs: { home: "መነሻ", suppliers: "አጋሮች", plots: "መሬቶች", operations: "ሂደቶች", help: "እገዛ" },
    common: {
      save: "አስቀምጥ", create: "ፍጠር", refresh: "አድስ", retry: "እንደገና ሞክር", download: "አውርድ",
      share: "አጋራ", status: "ሁኔታ", name: "ስም", region: "ክልል", subjectId: "የማጣቀሻ መለያ",
      pending: "በመጠባበቅ ላይ", synced: "ተመሳስሏል", failed: "አልተሳካም", conflict: "ግጭት",
    },
    sync: {
      online: "መስመር ላይ", offline: "ከመስመር ውጭ", syncing: "በማመሳሰል ላይ ...", queued: "ተሰልፏል",
      lastSync: "የመጨረሻ ማመሳሰል", never: "አልተደረገም", syncNow: "አሁን አመሳስል",
      configured: "የጀርባ ስርዓት ተዋቅሯል", notConfigured: "የጀርባ ስርዓት አልተዋቀረም",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL የለም። ማመሳሰልና የአቅራቢ ሂደቶች ታግደዋል።",
      success: "ማመሳሰል ተጠናቋል", error: "ማመሳሰል አልተሳካም", conflicts: "የማመሳሰል ግጭቶች",
      keepLocal: "የአካባቢውን ስሪት አቆይ", useServer: "የሰርቨር ስሪት ተጠቀም",
    },
    home: {
      title: "የመስክ አጠቃላይ እይታ", intro: "ከመስመር ውጭ መዝግብ፣ በደህንነት አመሳስል እና የተገዢነት ሂደቶችን ተከታተል።",
      suppliers: "አቅራቢዎች", plots: "የቡና መሬቶች", documents: "ሰነዶች",
    },
    suppliers: {
      title: "አቅራቢዎች", description: "አቅራቢዎች ከመስመር ውጭ ይፈጠራሉ እና በመላኪያ ወረፋ ይመሳሰላሉ።",
      add: "አቅራቢ ጨምር", empty: "ገና አቅራቢ የለም።", producerCount: "አምራቾች", plotCount: "መሬቶች",
      update: "አቅራቢን አዘምን", newSupplier: "አዲስ አቅራቢ", selected: "ተመርጧል",
      remoteTitle: "ከመረጃ ቋት የመጡ አቅራቢዎች", remoteEmpty: "በመረጃ ቋቱ ውስጥ ተጨማሪ አቅራቢ የለም።",
      loadRemote: "ከመረጃ ቋት ጫን",
      shipmentsTitle: "ጭነቶች", shipmentsDescription: "ያሉትን ጭነቶች ይመልከቱ እና ከመሬት ጋር ለማያያዝ አንዱን ይምረጡ።",
      shipmentsEmpty: "ገና ጭነት የለም።", editShipment: "ጭነት አርትዕ", newShipment: "አዲስ ጭነት",
      shipmentReference: "ማጣቀሻ", shipmentProduct: "ምርት", shipmentHsCode: "HS ኮድ",
      shipmentQuantity: "መጠን (ኪ.ግ.)", shipmentOriginCountry: "የመነሻ አገር", shipmentOriginRegion: "የመነሻ ክልል",
      shipmentSupplier: "አቅራቢ", noSupplier: "አቅራቢ የለም", shipmentDestination: "መድረሻ",
      shipmentStatus: "የጭነት ሁኔታ", status_planned: "ታቅዷል", status_in_transit: "በመጓጓዣ ላይ",
      status_arrived: "ደርሷል", status_cancelled: "ተሰርዟል", shipmentExpectedArrival: "የሚጠበቅበት ቀን (YYYY-MM-DD)",
      shipmentNotes: "ማስታወሻዎች", createShipment: "ጭነት ፍጠር", updateShipment: "ጭነት አስቀምጥ",
      clearShipment: "የጭነት ምርጫ አጽዳ",
    },
    plots: {
      title: "GeoJSON መሬቶች", description: "የመሬት ድንበርን በGPS ጉዞ ይመዝግቡ ወይም GeoJSON Polygon ያስገቡ።",
      producer: "አምራች", farm: "የመሬት ወይም የእርሻ ስም", area: "ስፋት (ሄክታር)",
      supplierId: "የአቅራቢ መለያ (አማራጭ)", capturePoint: "GPS ነጥብ ጨምር", pointCount: "ነጥቦች",
      selectedShipment: "የተመረጠ ጭነት", shipment: "የጭነት ዝርዝሮች", noShipment: "ጭነት የለም",
      producerRequired: "የአምራቹን ስም ያስገቡ።",
      farmRequired: "የመሬቱን ወይም የእርሻውን ስም ያስገቡ።",
      areaRequired: "ስፋቱን በሄክታር ያስገቡ።",
      areaInvalid: "ስፋቱ ከ0 በላይ የሆነ ቁጥር መሆን አለበት።",
      polygonRequired: "GeoJSON Polygon ይተግብሩ ወይም ቢያንስ ሶስት የGPS ነጥቦችን ይመዝግቡ።",
      invalidPolygonDetail: "GeoJSON Polygon መያዝ አለበት። ኮርዲኔቶችን [ኬንትሮስ፣ ኬክሮስ] ቅርጽ ይጠቀሙ፤ ቢያንስ ሶስት የተለያዩ ነጥቦችን ያስገቡና የመጀመሪያውን በመጨረሻ ይድገሙ።",
      polygonHint: "GeoJSON Polygon ኮርዲኔቶች [ኬንትሮስ፣ ኬክሮስ] ናቸው። የGPS ነጥቦች ሲቀመጡ ወደ Polygon ይዘጋሉ።",
      polygonJson: "GeoJSON Polygon", importGeoJson: "GeoJSON አስገባ", applyGeoJson: "GeoJSON ተግብር",
      saveDraft: "መሬቱን ከመስመር ውጭ አስቀምጥ", empty: "ገና የመሬት ረቂቅ የለም።",
      invalidPolygon: "ፖሊጎኑ ትክክል አይደለም። ቢያንስ ሶስት የተለያዩ ቦታዎች ያስፈልጋሉ።",
      gpsError: "የአሁኑን ቦታ ማወቅ አልተቻለም።", permissionError: "የቦታ ፈቃድ አልተሰጠም።",
      geofence: "Geofence", geofencePending: "በመጠባበቅ ላይ", geofenceInside: "ውስጥ",
      geofenceOutside: "ውጭ", geofenceReview: "ምርመራ ያስፈልጋል",
      geofenceApproved: "ጸድቋል", geofenceBlocked: "በአካባቢው ታግዷል፤ የጀርባ ስርዓቱ የመጨረሻ ውሳኔ ይሰጣል።",
      maxPoints: "የGPS ቀረጻ እስከ 10,000 ነጥቦች ድረስ ብቻ ነው።", reset: "ዳግም አስጀምር", cancel: "ሰርዝ",
      duplicatePoint: "ይህ GPS ነጥብ ቀደም ብሎ ከተመዘገበ ነጥብ ጋር በጣም ቅርብ ነው። ጥቂት ሜትሮች ተንቀሳቅሰው እንደገና ይመዝግቡ።",
      checkLocation: "ቦታ ይፈትሹ", locationInside: "የአሁኑ ቦታ በጂኦፌንስ ውስጥ ነው",
      locationOutside: "የአሁኑ ቦታ ከሁሉም ጂኦፌንሶች ውጭ ነው። እዚህ የተመዘገበ መሬት ለግምገማ ይቀርባል።",
      locationDistance: "እስከ ቅርቡ ጂኦፌንስ",
      locationPending: "ለዚህ ድርጅት ጂኦፌንስ አልተጫነም፤ ቦታው መፈተሽ አይቻልም።",
      locationAccuracy: "ትክክለኛነት",
      startWalk: "የድንበር ጉዞ ጀምር",
      stopWalk: "ጉዞውን አጠናቅቅና ፖሊጎን ፍጠር",
      undoPoint: "የመጨረሻውን GPS ነጥብ አስወግድ",
      trackCount: "የተመዘገቡ GPS ነጥቦች",
      selectDocument: "የመሬት ሰነድን እንደ ማስረጃ አያይዝ",
      noDocument: "ምንም ሰነድ አልተያያዘም",
      linkedDocument: "ተያይዟል",
      mapUnavailable: "በዚህ መድረክ የካርታ ቅድመ እይታ አይገኝም።",
      organicMapOpen: "በOrganic Maps ክፈት",
      organicMapDetail: "ድንበሮችና የGPS መንገድ እንደ ቅጽበታዊ መረጃ ይጋራሉ። Organic Maps ይምረጡ፤ ማሳያው በቀጥታ አይዘመንም። ኦፍላይን ለመጠቀም ክልሉን አስቀድመው ያውርዱ።",
      organicMapChoose: "Organic Maps ይምረጡ",
      organicMapInstallTitle: "Organic Maps ይጫኑ",
      organicMapInstallDetail: "ካርታውን ለማየት ነፃው Organic Maps መተግበሪያ ያስፈልጋል። ከጫኑ በኋላ እንደገና ይሞክሩ።",
      organicMapInstallAction: "Play Store ክፈት",
      organicMapError: "ካርታውን መክፈት አልተቻለም።",
      offlineMapInfo: "የኢትዮጵያ ኦፍላይን ካርታ፦ አንድ ጊዜ 350 MB ያህል ያውርዱ። GPS ያለ ካርታም ይሰራል።",
      offlineMapReady: "የኢትዮጵያ ኦፍላይን ካርታ በዚህ መሳሪያ ተቀምጧል።",
      offlineMapDownload: "ኦፍላይን ካርታ አውርድ",
      offlineMapDownloading: "ካርታ በመውረድ ላይ",
      offlineMapRemove: "ኦፍላይን ካርታ አስወግድ",
      offlineMapRemoveConfirm: "የተቀመጠውን ካርታ ማስወገድ ይፈልጋሉ? GPS እና የመሬት ረቂቆች ይቀራሉ።",
      offlineMapError: "ኦፍላይን ካርታውን መጫን አልተቻለም",
      tooFewTrackPoints: "ለድንበር ቢያንስ ሶስት የተለያዩ GPS ነጥቦች ያስፈልጋሉ።",
    },
    operations: {
      title: "የተገዢነት ሂደቶች", plotSelection: "የመሬት መለያ ይምረጡ", plotUploadRequired: "የተመሳሰለ መሬት ይምረጡ እና ከኢንተርኔት ጋር ይገናኙ።", documents: "ሰነዶች", pickUpload: "ሰነድ ምረጥና ስቀል",
      uploadsList: "የማስቀመጫ ዝርዝር", requestsList: "የሂደት ዝርዝር", downloadedList: "የወረዱ ፋይሎች",
      satellite: "የሳተላይት ትንተና", requestSatellite: "ትንተና ጠይቅ", evidence: "የማስረጃ ጥቅል",
      requestEvidence: "የማስረጃ ጥቅል ጠይቅ", dds: "የDDS ረቂቅ", createDds: "የDDS ረቂቅ ፍጠር",
      validateDds: "አረጋግጥ", submitDds: "አስገባ", checkStatus: "ሁኔታን አረጋግጥ",
      showLocal: "አሳይ", removeItem: "አስወግድ", queuedDownload: "ኦንላይን ሲሆን በራስ-ሰር ይወርዳል።",
      downloading: "በማውረድ ላይ ...", downloaded: "በአካባቢ ተቀምጧል",
      noItems: "ገና ሂደት የለም።", providerBlocked: "የአቅራቢ ውቅር የለም። ይህ ሂደት ታግዷል።",
      scanPhoto: "ሰነድ ፎቶ አንስተው ይጫኑ",
      chooseImage: "ምስል ይምረጡና ይጫኑ",
      ocrText: "በአካባቢው የታወቀ ጽሑፍ (ሊታረም ይችላል፤ በእጅ ይመርምሩ)",
      ocrReview: "የOCR ጽሑፍ በእጅ ተመርምሯል",
      ocrUnavailable: "በዚህ መሣሪያ ላይ የአካባቢ ጽሑፍ ማወቂያ አይገኝም።",
      ocrFailed: "የአካባቢ ጽሑፍ ማወቂያ አልተሳካም",
      ocrEmpty: "ጽሑፍ አልተገኘም። የምስሉን ጥራትና አቅጣጫ ይፈትሹ።",
    },
    help: {
      title: "ከመስመር ውጭ እና ግላዊነት",
      body: "GPS እና የግል መረጃን በፈቃድ ብቻ ይመዝግቡ። የአካባቢ ለውጦች ማመሳሰል እስኪረጋገጥ ይቆያሉ። ግጭቶች በራስ-ሰር አይተኩም።",
    },
    alerts: { required: "እባክዎ ሁሉንም አስፈላጊ መስኮች ይሙሉ።", saved: "ከመስመር ውጭ ተቀምጧል።", storageError: "የአካባቢ ውሂብ በደህንነት ሊቀመጥ አልቻለም።" },
  },
  ti: {
    userAccount: "ናይ ተጠቃሚ መለያ",
    languageName: "ትግርኛ", languageCode: "ትግ", chooseLanguage: "ቋንቋ ምረጹ",
    languageHint: "እቲ ምርጫ ኣብዚ መሳርሒ ይዕቀብ።", close: "ዕጸው", brandSubtitle: "መርትዖ ቡን",
    auth: {
      title: "እቶ", email: "ኢመይል", password: "መሕለፊ ቃል",
      organizationSlug: "ሓጺር መለለዪ ትካል (ኣማራጺ)", signIn: "እቶ",
      signOut: "ውጻእ", selectOrganization: "ትካል ምረጽ",
      register: "ምዝገባ ሕተት", phone: "ቁጽሪ ስልኪ", country: "ሃገር",
      searchCountry: "ሃገር ወይ ኮድ ስልኪ ድለ",
      invalidRegistration: "ስም፣ ቅኑዕ ኢመይልን ናይታ ዝተመርጸት ሃገር ቅኑዕ ቁጽሪ ስልክን ኣእቱ።",
      pendingApproval: "የቐንየልና። እቲ ሕቶ ብቑዕ እንተኾይኑ ክግምገም እዩ። ምስ ጸደቐ ዝቕጽሉ ስጉምትታት ብኢመይል ክለኣኹ እዮም።",
      requestFailed: "ሕቶ ኣይተላእከን። ምትእስሳርካ ኣረጋግጽ እሞ ደጊምካ ፈትን።",
      backToLogin: "ናብ መእተዊ ተመለስ", activate: "መሕለፊ ቃል ኣዳሉ እሞ እቶ",
      activationIntro: "ናይ መጀመርታ መሕለፊ ቃልካ ኣዳሉ። ድሕሪኡ ክትኣቱ ኢኻ።",
      confirmPassword: "መሕለፊ ቃል ኣረጋግጽ", passwordHint: "ብውሑዱ 12 ፊደላት። ሕግታት መሕለፊ ቃል ሰርቨር እውን ይምልከቱ።",
      passwordMismatch: "ብውሑዱ 12 ፊደላትን ተመሳሳሊ መረጋገጺን ኣእቱ።",
      invalidActivation: "እዚ መጋበሪ መላግቦ ቅኑዕ ኣይኮነን ወይ ግዜኡ ሓሊፉ። ካብ ኣመሓዳሪኻ ሓድሽ መላግቦ ሕተት።",
      activationFailed: "ምግባር ኣይተዛዘመን። ምትእስሳርን ሕግታት መሕለፊ ቃልን ኣረጋግጽ። ግዜኡ እንተሓሊፉ ኣመሓዳሪኻ ተወከስ።",
      activationLoginFailed: "መሕለፊ ቃልካ ተዓቂቡ፣ ግን ምእታው ኣይተዓወተን። ብኢመይልካን ሓድሽ መሕለፊ ቃልካን እቶ።",
      clearingSession: "ናይ ቅድሚ ሕጂ ክፍለ ግዜ ብውሑስ ይእለ ኣሎ …",
      sessionClearFailed: "ናይ ቅድሚ ሕጂ ክፍለ ግዜ ኣይተኣልየን። ናይ ኣፕ ከባቢያዊ መኽዘን ኣጽሪ እሞ መላግቦ ደጊምካ ክፈት።",
    },
    tabs: { home: "መበገሲ", suppliers: "መሻርኽቲ", plots: "ግራውቲ", operations: "መስርሓት", help: "ሓገዝ" },
    common: {
      save: "ዓቅብ", create: "ፍጠር", refresh: "ኣሐድስ", retry: "ደጊምካ ፈትን", download: "ኣውርድ",
      share: "ኣካፍል", status: "ኩነታት", name: "ስም", region: "ክልል", subjectId: "መወከሲ መለለዪ",
      pending: "ይጽበ ኣሎ", synced: "ተመሳሲሉ", failed: "ኣይተዓወተን", conflict: "ግጭት",
    },
    sync: {
      online: "ኣብ መስመር", offline: "ካብ መስመር ወጻኢ", syncing: "ይመሳሰል ኣሎ ...", queued: "ተሰሪዑ",
      lastSync: "ናይ መወዳእታ ምትእስሳር", never: "ኣይተገብረን", syncNow: "ሕጂ ኣመሳስል",
      configured: "ስርዓተ-ድሕሪት ተዋቒሩ", notConfigured: "ስርዓተ-ድሕሪት ኣይተዋቐረን",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL የለን። ምትእስሳርን ናይ ኣቕራቢ መስርሓትን ተዓጽዮም።",
      success: "ምትእስሳር ተዛዚሙ", error: "ምትእስሳር ኣይተዓወተን", conflicts: "ናይ ምትእስሳር ግጭታት",
      keepLocal: "ናይ መሳርሒ ስሪት ዓቅብ", useServer: "ናይ ሰርቨር ስሪት ተጠቐም",
    },
    home: {
      title: "ሓፈሻዊ እዋን መስክ", intro: "ካብ መስመር ወጻኢ መዝግቡ፣ ብውሕስነት ኣመሳስሉ፣ መስርሓት ምኽባር ሕጊ ተኸታተሉ።",
      suppliers: "ኣቕረብቲ", plots: "ግራውቲ ቡን", documents: "ሰነዳት",
    },
    suppliers: {
      title: "ኣቕረብቲ", description: "ኣቕረብቲ ካብ መስመር ወጻኢ ይፍጠሩን ብመስርዕ ልኡኽ ይመሳሰሉን።",
      add: "ኣቕራቢ ወስኽ", empty: "ገና ኣቕራቢ የለን።", producerCount: "ኣፍረይቲ", plotCount: "ግራውቲ",
      update: "ኣቕራቢ ኣሐድስ", newSupplier: "ሓድሽ ኣቕራቢ", selected: "ተመሪጹ",
      remoteTitle: "ካብ መዝገብ ሓበሬታ ዝመጹ ኣቕረብቲ", remoteEmpty: "ኣብ መዝገብ ሓበሬታ ተወሳኺ ኣቕራቢ የለን።",
      loadRemote: "ካብ መዝገብ ሓበሬታ ጽዓን",
      shipmentsTitle: "ልኡኻት", shipmentsDescription: "ዘለዉ ልኡኻት ርኣዩን ምስ ግራት ንምትእስሳር ሓደ ምረጹን።",
      shipmentsEmpty: "ገና ልኡኽ የለን።", editShipment: "ልኡኽ ኣሐድስ", newShipment: "ሓድሽ ልኡኽ",
      shipmentReference: "መወከሲ", shipmentProduct: "ፍርያት", shipmentHsCode: "ኮድ HS",
      shipmentQuantity: "መጠን (ኪ.ግ.)", shipmentOriginCountry: "ሃገር መበገሲ", shipmentOriginRegion: "ክልል መበገሲ",
      shipmentSupplier: "ኣቕራቢ", noSupplier: "ኣቕራቢ የለን", shipmentDestination: "መዳረሻ",
      shipmentStatus: "ኩነታት ልኡኽ", status_planned: "ተመዲቡ", status_in_transit: "ኣብ መንገዲ",
      status_arrived: "በጺሑ", status_cancelled: "ተሰሪዙ", shipmentExpectedArrival: "ዝጽበ ቀንዲ መበጽሒ (YYYY-MM-DD)",
      shipmentNotes: "መዘኻኸሪ", createShipment: "ልኡኽ ፍጠር", updateShipment: "ልኡኽ ዓቅብ",
      clearShipment: "ምርጫ ልኡኽ ኣጽሪ",
    },
    plots: {
      title: "GeoJSON ግራውቲ", description: "ዶብ መሬት ብGPS ጉዕዞ መዝግቡ ወይ GeoJSON Polygon ኣእትዉ።",
      producer: "ኣፍራዪ", farm: "ስም ግራት ወይ ሕርሻ", area: "ስፍሓት (ሄክታር)",
      supplierId: "መለለዪ ኣቕራቢ (ኣማራጺ)", capturePoint: "ነጥቢ GPS ወስኽ", pointCount: "ነጥብታት",
      selectedShipment: "ዝተመርጸ ልኡኽ", shipment: "ዝርዝር ልኡኽ", noShipment: "ልኡኽ የለን",
      producerRequired: "ስም ኣፍራዪ ኣእትዉ።",
      farmRequired: "ስም ግራት ወይ ሕርሻ ኣእትዉ።",
      areaRequired: "ስፍሓት ብሄክታር ኣእትዉ።",
      areaInvalid: "ስፍሓት ካብ 0 ዝዓቢ ቁጽሪ ክኸውን ኣለዎ።",
      polygonRequired: "GeoJSON Polygon ተግብሩ ወይ እንተወሓደ ሰለስተ ነጥብታት GPS መዝግቡ።",
      invalidPolygonDetail: "GeoJSON Polygon ክሕዝ ኣለዎ። ኮርዲኔት [ንውሓት፣ ላቲቱድ] ተጠቐሙ፤ እንተወሓደ ሰለስተ ዝተፈላለዩ ነጥብታት ኣእትዉን እቲ ቀዳማይ ኣብ መወዳእታ ድገሙን።",
      polygonHint: "GeoJSON Polygon ኮርዲኔት [ንውሓት፣ ላቲቱድ] ይጥቀም። ነጥብታት GPS ኣብ ግዜ ምቕማጥ ናብ Polygon ይዕጸዉ።",
      polygonJson: "GeoJSON Polygon", importGeoJson: "GeoJSON ኣእቱ", applyGeoJson: "GeoJSON ተግብር",
      saveDraft: "ግራት ካብ መስመር ወጻኢ ዓቅብ", empty: "ገና ንድፊ ግራት የለን።",
      invalidPolygon: "እቲ ፖሊጎን ቅኑዕ ኣይኮነን። እንተወሓደ ሰለስተ ዝተፈላለዩ ቦታታት የድልዩ።",
      gpsError: "እዋናዊ ቦታ ክፍለጥ ኣይከኣለን።", permissionError: "ፍቓድ ቦታ ኣይተዋህበን።",
      geofence: "Geofence", geofencePending: "ይጽበ ኣሎ", geofenceInside: "ውሽጢ",
      geofenceOutside: "ወጻኢ", geofenceReview: "ግምገማ የድሊ",
      geofenceApproved: "ጸዲቑ", geofenceBlocked: "ኣብ መሳርሒ ተዓጽዩ፤ ናይ መወዳእታ ውሳነ ናይ ሰርቨር እዩ።",
      maxPoints: "ናይ GPS ቀረጻ ክሳብ 10,000 ነጥብታት ጥራይ እዩ።", reset: "ዳግማይ ጀምር", cancel: "ሰርዝ",
      duplicatePoint: "እዚ GPS ነጥቢ ምስ ዝተመዝገበ ነጥቢ ኣዝዩ ቀረባ እዩ። ውሑዳት ሜትሮ ተንቀሳቐሱ ደጊምኩም መዝግቡ።",
      checkLocation: "ቦታ ፈትሽ", locationInside: "ናይ ሕጂ ቦታ ኣብ ውሽጢ ጂኦፌንስ እዩ",
      locationOutside: "ናይ ሕጂ ቦታ ካብ ኩሎም ጂኦፌንሳት ወጻኢ እዩ። ኣብዚ ዝተመዝገበ መሬት ንግምገማ ይቀርብ።",
      locationDistance: "ክሳብ ዝቐረበ ጂኦፌንስ",
      locationPending: "ንዚ ውድብ ጂኦፌንስ ኣይተጻዕነን፤ ቦታ ክፍተሽ ኣይከኣልን።",
      locationAccuracy: "ትኽክልነት",
      startWalk: "ናይ ዶብ ጉዕዞ ጀምር",
      stopWalk: "ጉዕዞ ዛዝምን ፖሊጎን ፍጠርን",
      undoPoint: "ናይ መወዳእታ GPS ነጥቢ ኣወግድ",
      trackCount: "ዝተመዝገቡ GPS ነጥብታት",
      selectDocument: "ሰነድ መሬት ከም መርትዖ ኣተሓሕዝ",
      noDocument: "ዝተኣሳሰረ ሰነድ የለን",
      linkedDocument: "ተኣሳሲሩ",
      mapUnavailable: "ኣብዚ መድረኽ ቅድመ ርኢቶ ካርታ የለን።",
      organicMapOpen: "ብOrganic Maps ክፈት",
      organicMapDetail: "ዶባትን ናይ GPS መስመርን ከም ናይ ሓደ ግዜ መረዳእታ ይካፈሉ። Organic Maps ምረጽ፤ ብቐጥታ ኣይሕደስን። ኦፍላይን ንምጥቃም ነቲ ከባቢ ቀዲምካ ኣውርድ።",
      organicMapChoose: "Organic Maps ምረጽ",
      organicMapInstallTitle: "Organic Maps ጽዓን",
      organicMapInstallDetail: "ንካርታ እቲ ነጻ Organic Maps መተግበሪ የድሊ። ምስ ጸዓንካዮ እንደገና ፈትን።",
      organicMapInstallAction: "Play Store ክፈት",
      organicMapError: "ካርታ ክኽፈት ኣይከኣለን።",
      offlineMapInfo: "ናይ ኢትዮጵያ ኦፍላይን ካርታ፦ ሓደ ግዜ ኣስታት 350 MB ኣውርድ። GPS ብዘይ ካርታውን ይሰርሕ።",
      offlineMapReady: "ናይ ኢትዮጵያ ኦፍላይን ካርታ ኣብዚ መሳርሒ ተቐሚጡ ኣሎ።",
      offlineMapDownload: "ኦፍላይን ካርታ ኣውርድ",
      offlineMapDownloading: "ካርታ ይወርድ ኣሎ",
      offlineMapRemove: "ኦፍላይን ካርታ ኣወግድ",
      offlineMapRemoveConfirm: "ዝተቐመጠ ካርታ ክወግድ? GPSን ናይ መሬት ንድፍታትን ይተርፉ።",
      offlineMapError: "ኦፍላይን ካርታ ክጽዓን ኣይከኣለን",
      tooFewTrackPoints: "ንዶብ እንተወሓደ ሰለስተ ዝተፈላለዩ GPS ነጥብታት የድልዩ።",
    },
    operations: {
      title: "መስርሓት ምኽባር ሕጊ", plotSelection: "መለለዪ ግራት ምረጽ", plotUploadRequired: "ዝተመሳሰለ ግራት ምረጽን ኢንተርነት ተጠቐምን።", documents: "ሰነዳት", pickUpload: "ሰነድ ምረጽን ስቐልን",
      uploadsList: "ዝርዝር ምስቃል", requestsList: "ዝርዝር መስርሕ", downloadedList: "ዝወረዱ ፋይላት",
      satellite: "ትንተና ሳተላይት", requestSatellite: "ትንተና ሕተት", evidence: "ጥርናፈ መርትዖ",
      requestEvidence: "ጥርናፈ መርትዖ ሕተት", dds: "ንድፊ DDS", createDds: "ንድፊ DDS ፍጠር",
      validateDds: "ኣረጋግጽ", submitDds: "ኣቕርብ", checkStatus: "ኩነታት ርአ",
      showLocal: "ኣርኢ", removeItem: "ኣወግድ", queuedDownload: "ኣብ መስመር ምስ ኮነ ብኣውቶ ክወርድ እዩ።",
      downloading: "ይወርድ ኣሎ ...", downloaded: "ኣብ መሳርሒ ተዓቂቡ",
      noItems: "ገና መስርሕ የለን።", providerBlocked: "ውቅር ኣቕራቢ የለን። እዚ መስርሕ ተዓጽዩ።",
      scanPhoto: "ሰነድ ፎቶ ኣንስእን ስቐልን",
      chooseImage: "ምስሊ ምረጽን ስቐልን",
      ocrText: "ብኣካባቢ ዝተፈለጠ ጽሑፍ (ክእረም ይኽእል፤ ብኢድ መርምር)",
      ocrReview: "ጽሑፍ OCR ብኢድ ተመርሚሩ",
      ocrUnavailable: "ኣብዚ መሳርሒ ናይ ኣካባቢ ምፍላጥ ጽሑፍ የለን።",
      ocrFailed: "ናይ ኣካባቢ ምፍላጥ ጽሑፍ ኣይተዓወተን",
      ocrEmpty: "ጽሑፍ ኣይተረኽበን። ጽሬትን ኣንፈትን ምስሊ ፈትሽ።",
    },
    help: {
      title: "ካብ መስመር ወጻኢን ብሕታውነትን",
      body: "GPSን ውልቃዊ ሓበሬታን ብፍቓድ ጥራይ መዝግቡ። ናይ መሳርሒ ለውጥታት ምትእስሳር ክሳብ ዝረጋገጽ ይጸንሑ። ግጭታት ብራስ-ሰር ኣይትክኡን።",
    },
    alerts: { required: "በጃኹም ኩሎም ዘድልዩ ቦታታት ምልኡ።", saved: "ካብ መስመር ወጻኢ ተዓቂቡ።", storageError: "ናይ መሳርሒ ዳታ ብውሕስነት ክዕቀብ ኣይከኣለን።" },
  },
  om: {
    userAccount: "Herrega fayyadamaa",
    languageName: "Afaan Oromoo (Oromia)", languageCode: "OM", chooseLanguage: "Afaan filadhu",
    languageHint: "Filannoon meeshaa kana irratti kuufama.", close: "Cufi",
    brandSubtitle: "Ragaa buna",
    auth: {
      title: "Seeni", email: "Imeelii", password: "Jecha darbii",
      organizationSlug: "Koodii dhaabbataa (dirqama miti)", signIn: "Seeni",
      signOut: "Ba'i", selectOrganization: "Dhaabbata filadhu",
      register: "Galmee gaafadhu", phone: "Lakkoofsa bilbilaa", country: "Biyya",
      searchCountry: "Biyya yookaan koodii bilbilaa barbaadi",
      invalidRegistration: "Maqaa, imeelii sirrii fi lakkoofsa bilbilaa biyya filatameef sirrii ta'e galchi.",
      pendingApproval: "Galatoomi. Gaaffiin ulaagaalee yoo guute ni ilaalama. Erga hayyamamee booda tarkaanfii itti aanu imeeliidhaan argatta.",
      requestFailed: "Gaaffii erguun hin danda'amne. Walqunnamtii kee ilaaliitii irra deebi'i.",
      backToLogin: "Gara seensaatti deebi'i", activate: "Jecha darbii kaa'iitii seeni",
      activationIntro: "Jecha darbii jalqabaa kaa'i. Sana booda ni seenta.",
      confirmPassword: "Jecha darbii mirkaneessi",
      passwordHint: "Yoo xiqqaate qubee 12. Seerri jecha darbii sarvaraas ni hojjeta.",
      passwordMismatch: "Yoo xiqqaate qubee 12 galchiitii jecha darbii wal fakkaatuun mirkaneessi.",
      invalidActivation: "Geessituun kun sirrii miti yookaan yeroon isaa darbeera. Bulchaa kee geessituu haaraa gaafadhu.",
      activationFailed: "Hojiirra oolchuun hin xumuramne. Walqunnamtii fi seera jecha darbii ilaaliitii irra deebi'i. Yeroon geessituu yoo darbe bulchaa qunnami.",
      activationLoginFailed: "Jechi darbii kuufameera, garuu seenuun hin milkoofne. Imeelii fi jecha darbii haaraadhaan seeni.",
      clearingSession: "Seensa duraanii nageenyaan haqaa jira ...",
      sessionClearFailed: "Seensa duraanii nageenyaan haquun hin danda'amne. Kuusaa appii keessaa haqiitii geessituu irra deebi'ii bani.",
    },
    tabs: { home: "Jalqaba", suppliers: "Michoota", plots: "Lafa", operations: "Hojiiwwan", help: "Gargaarsa" },
    common: {
      save: "Kuusi", create: "Uumi", refresh: "Haaromsi", retry: "Irra deebi'i",
      download: "Buufadhu", share: "Qoodi", status: "Haala", name: "Maqaa", region: "Naannoo",
      subjectId: "ID wabii", pending: "Eegaa jira", synced: "Walsimeera", failed: "Hin milkoofne",
      conflict: "Walitti bu'iinsa",
    },
    sync: {
      online: "Toora irra", offline: "Toora ala", syncing: "Walsimsiisaa jira ...", queued: "tarree eegumsaa keessa",
      lastSync: "Walsimsiisa dhumaa", never: "Gonkumaa", syncNow: "Amma walsimsiisi",
      configured: "Sarvarri qophaa'eera", notConfigured: "Sarvarri hin qophoofne",
      notConfiguredDetail: "EXPO_PUBLIC_API_URL hin jiru. Walsimsiisuu fi hojiiwwan dhiyeessaa cufamaniiru.",
      success: "Walsimsiisuun xumurameera", error: "Walsimsiisuun hin milkoofne",
      conflicts: "Walitti bu'iinsa walsimsiisaa", keepLocal: "Kan meeshaa keessaa tursiisi", useServer: "Kan sarvaraa fayyadami",
    },
    home: {
      title: "Haala hojii dirree", intro: "Toora ala galmeessi, nageenyaan walsimsiisi, hojiiwwan ulaagaalee hordofi.",
      suppliers: "Dhiyeessitoota", plots: "Lafa buna", documents: "Sanadoota",
    },
    suppliers: {
      title: "Dhiyeessitoota", description: "Dhiyeessitoonni toora ala galmaa'anii tarree ergaatiin walsimu.",
      add: "Dhiyeessaa dabali", empty: "Dhiyeessaan hin jiru.", producerCount: "Oomishtoota", plotCount: "Lafa",
      update: "Dhiyeessaa haaromsi", newSupplier: "Dhiyeessaa haaraa", selected: "Filatame",
      remoteTitle: "Dhiyeessitoota kuusaa deetaa keessaa", remoteEmpty: "Kuusaa deetaa keessa dhiyeessaan dabalataa hin jiru.",
      loadRemote: "Kuusaa deetaa irraa fe'i",
      shipmentsTitle: "Ergaawwan", shipmentsDescription: "Ergaawwan jiran ilaaliitii lafa waliin walqabsiisuuf tokko filadhu.",
      shipmentsEmpty: "Ergaan hin jiru.", editShipment: "Ergaa gulaali", newShipment: "Ergaa haaraa",
      shipmentReference: "Wabii", shipmentProduct: "Oomisha", shipmentHsCode: "Koodii HS",
      shipmentQuantity: "Baay'ina (kg)", shipmentOriginCountry: "Biyya madda", shipmentOriginRegion: "Naannoo madda",
      shipmentSupplier: "Dhiyeessaa", noSupplier: "Dhiyeessaa malee", shipmentDestination: "Bakka ga'umsaa",
      shipmentStatus: "Haala ergaa", status_planned: "Karoorfame", status_in_transit: "Karaa irra",
      status_arrived: "Ga'eera", status_cancelled: "Haqame", shipmentExpectedArrival: "Guyyaa ga'umsaa eegamu (YYYY-MM-DD)",
      shipmentNotes: "Yaadannoowwan", createShipment: "Ergaa uumi", updateShipment: "Ergaa kuusi",
      clearShipment: "Filannoo ergaa haqi",
    },
    plots: {
      title: "Lafa GeoJSON", description: "Daangaa lafaa miilaan deemaa GPS fayyadamuun galmeessi yookaan poligoonii GeoJSON galchi.",
      producer: "Oomishtuu", farm: "Maqaa lafaa yookaan qonnaa", area: "Bal'ina (ha)", supplierId: "ID dhiyeessaa (dirqama miti)",
      selectedShipment: "Ergaa filatame", shipment: "Odeeffannoo ergaa", noShipment: "Ergaa malee",
      producerRequired: "Maqaa oomishtuu galchi.", farmRequired: "Maqaa lafaa yookaan qonnaa galchi.",
      areaRequired: "Bal'ina hektaaraan galchi.", areaInvalid: "Bal'inni lakkoofsa 0 caalu ta'uu qaba.",
      polygonRequired: "Poligoonii GeoJSON fayyadami yookaan yoo xiqqaate tuqaalee GPS sadii galmeessi.",
      invalidPolygonDetail: "GeoJSON poligoonii qabaachuu qaba. Qindoomina [longitude, latitude] fayyadami; tuqaalee adda addaa sadii qabaadhu, tuqaa jalqabaa dhuma irratti irra deebi'i.",
      polygonHint: "Qindoominni GeoJSON [longitude, latitude] fayyadama. Tuqaaleen GPS yeroo kuufaman poligooniitti cufamu.",
      capturePoint: "Tuqaa GPS dabali", pointCount: "Tuqaalee", polygonJson: "Poligoonii GeoJSON",
      importGeoJson: "GeoJSON galchi", applyGeoJson: "GeoJSON fayyadami", saveDraft: "Lafa toora ala kuusi",
      empty: "Wixineen lafaa hin jiru.", invalidPolygon: "Poligooniin sirrii miti. Bakkeewwan adda addaa yoo xiqqaate sadii barbaachisu.",
      gpsError: "Bakki ammaa hin argamne.", permissionError: "Hayyamni bakka argachuu hin kennamne.",
      geofence: "Daangaa naannoo", geofencePending: "Eegaa jira", geofenceInside: "Keessa",
      geofenceOutside: "Ala", geofenceReview: "Sakatta'iinsa barbaada",
      geofenceApproved: "Hayyamame", geofenceBlocked: "Meeshaa irratti cufame; murtiin dhumaa kan sarvaraati.",
      maxPoints: "Galmeen GPS tuqaalee 10,000 irratti daangeffameera.", reset: "Haqi", cancel: "Dhiisi",
      duplicatePoint: "Tuqaan GPS kun tuqaa duraan galmaa'etti baay'ee dhihaata. Meetira muraasa deemii irra deebi'i.",
      checkLocation: "Bakka ilaali", locationInside: "Bakki kun daangaa naannoo keessa jira",
      locationOutside: "Bakki kun daangaawwan naannoo hundaa ala jira. Lafti asitti galmaa'u sakatta'iinsaaf ni ergama.",
      locationDistance: "gara daangaa naannoo dhihootti",
      locationPending: "Dhaabbata kanaaf daangaan naannoo hin fe'amne; bakki ilaalamuu hin danda'u.",
      locationAccuracy: "Sirrummaa", startWalk: "Deemsa daangaa jalqabi",
      stopWalk: "Deemsa xumuriitii poligoonii uumi", undoPoint: "Tuqaa GPS dhumaa haqi",
      trackCount: "Tuqaalee GPS galmaa'an", selectDocument: "Sanada lafaa akka ragaatti walqabsiisi",
      noDocument: "Sanadni hin walqabanne", linkedDocument: "Walqabate",
      mapUnavailable: "Meeshaa kana irratti kaartaan hin argamu.",
      organicMapOpen: "Organic Maps keessatti bani",
      organicMapDetail: "Daangaa fi karaan GPS yeroo ammaatti qoodamu. Organic Maps filadhu; agarsiisni ofumaan hin haaromu. Kaartaa offline fayyadamuuf naannoo dursii buufadhu.",
      organicMapChoose: "Organic Maps filadhu",
      organicMapInstallTitle: "Organic Maps fe'i",
      organicMapInstallDetail: "Kaartaa ilaaluuf appiin bilisaa Organic Maps barbaachisa. Erga fe'amee booda irra deebi'ii yaali.",
      organicMapInstallAction: "Play Store bani",
      organicMapError: "Kaartaa banuun hin danda'amne.",
      offlineMapInfo: "Kaartaa Itoophiyaa intarneeta malee: yeroo tokko qofa gara 350 MB buufadhu. GPS kaartaa malees ni hojjeta.",
      offlineMapReady: "Kaartaan Itoophiyaa meeshaa kana irratti kuufameera.",
      offlineMapDownload: "Kaartaa intarneeta malee buufadhu",
      offlineMapDownloading: "Kaartaan buufamaa jira",
      offlineMapRemove: "Kaartaa kuufame haqi",
      offlineMapRemoveConfirm: "Kaartaa kuufame haqxuu? GPS fi wixineewwan lafaa ni turu.",
      offlineMapError: "Kaartaa kuufame fe'uun hin danda'amne",
      tooFewTrackPoints: "Daangaaf tuqaalee GPS adda addaa yoo xiqqaate sadii barbaachisu.",
    },
    operations: {
      title: "Hojiiwwan ulaagaalee", plotSelection: "ID lafaa filadhu", plotUploadRequired: "Lafa walsimsiifame filadhuutii intarneetatti walqabsiisi.", documents: "Sanadoota", pickUpload: "Sanada filadhuutii ol fe'i",
      uploadsList: "Tarree ol fe'umsaa", requestsList: "Tarree hojiiwwanii", downloadedList: "Kan buufaman",
      satellite: "Xiinxala saatalaayitii", requestSatellite: "Xiinxala gaafadhu", evidence: "Tuuta ragaa",
      requestEvidence: "Tuuta ragaa gaafadhu", dds: "Wixinee DDS", createDds: "Wixinee DDS uumi",
      validateDds: "Mirkaneessi", submitDds: "Dhiyeessi", checkStatus: "Haala ilaali",
      showLocal: "Agarsiisi", removeItem: "Haqi", queuedDownload: "Yeroo toora irra deebitu ofumaan buufama.",
      downloading: "Buufamaa jira ...", downloaded: "Meeshaa irratti kuufame",
      noItems: "Hojiiwwan hin jiran.", providerBlocked: "Qindaa'inni dhiyeessaa hin jiru. Hojiin kun cufameera.",
      scanPhoto: "Sanada suuraa kaasiitii ol fe'i", chooseImage: "Suuraa filadhuutii ol fe'i",
      ocrText: "Barruu meeshaa irratti adda baafame (gulaalamuu danda'a; harkaan ilaali)",
      ocrReview: "Barruun OCR harkaan ilaalameera",
      ocrUnavailable: "Meeshaa kana irratti barruu adda baasuun hin danda'amu.",
      ocrFailed: "Barruu adda baasuun hin milkoofne",
      ocrEmpty: "Barruun hin argamne. Qulqullinaa fi kallattii suuraa ilaali.",
    },
    help: {
      title: "Toora ala fi iccitii",
      body: "GPS fi deetaa dhuunfaa hayyama qofaan galmeessi. Jijjiiramni meeshaa keessaa hanga walsimsiisuun mirkanaa'utti ni tura. Walitti bu'iinsi ofumaan hin irra barreeffamu.",
    },
    alerts: { required: "Dirreewwan barbaachisan hunda guuti.", saved: "Toora ala kuufame.", storageError: "Deetaan meeshaa irratti nageenyaan kuufamuu hin dandeenye." },
  },
} satisfies Record<Language, Translation>;

export function isLanguage(value: string | null): value is Language {
  return value !== null && (languages as readonly string[]).includes(value);
}
