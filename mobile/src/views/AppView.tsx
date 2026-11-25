import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import { isSupported as isOcrSupported, recognizeText } from "expo-mlkit-ocr";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar as NativeStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import {
  ApiError,
  getApiBaseUrl,
  getCurrentAuthHeaders,
  recordSessionActivity,
  getOperation,
  getRemoteShipments,
  getRemoteSuppliers,
  registerAccount,
  submitDds,
  uploadDocument,
  validateDds,
} from "../api";
import {
  checkPositionAgainstGeofences,
  closePolygon,
  createUuid,
  evaluatePlotGeofence,
  parsePolygon,
  type GeoJsonPolygon,
  type GpsTrackPoint,
  type OperationalRequest,
  type PersistedState,
  type Plot,
  type Position,
  type PositionGeofenceCheck,
  type Shipment,
  type Supplier,
  type SyncConflict,
} from "../domain";
import {
  languages,
  isLanguage,
  translations,
  type Translation,
} from "../i18n";
import type { AppController } from "../controllers/useAppController";
import PlotMapPreview from "./PlotMapPreview";
import { normalizePhone, phoneCountries, searchPhoneCountries } from "../onboarding";

const palette = {
  ink: "#14251D",
  forest: "#1F5A43",
  dark: "#174735",
  paper: "#F4F2EA",
  panel: "#FFFEFA",
  line: "#DDE0D8",
  muted: "#68766F",
  lime: "#CADB84",
  amber: "#C88124",
  red: "#A64536",
  softGreen: "#DDEADF",
  softAmber: "#F8E8CE",
  softRed: "#F7DED9",
};

function statusLabel(status: string, t: Translation) {
  if (status === "synced" || status === "completed") return t.common.synced;
  if (status === "conflict") return t.common.conflict;
  if (status === "failed" || status === "not_configured") return t.common.failed;
  return t.common.pending;
}

function Button({
  label,
  icon,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Ionicons name={icon} size={18} color={secondary ? palette.forest : "#FFFFFF"} />
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function IconActionButton({
  label,
  icon,
  onPress,
  disabled = false,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[styles.iconButton, disabled && styles.buttonDisabled]}
    >
      <Ionicons name={icon} size={20} color={palette.forest} />
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  placeholder,
  keyboardType,
  autoCapitalize = "sentences",
  secureTextEntry = false,
  invalid = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "decimal-pad" | "number-pad" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "sentences";
  secureTextEntry?: boolean;
  invalid?: boolean;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={(text) => {
          onChangeText(text);
          void recordSessionActivity().catch((error: unknown) =>
            Alert.alert(label, error instanceof Error ? error.message : String(error)));
        }}
        placeholder={placeholder}
        placeholderTextColor="#98A29C"
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secureTextEntry}
        autoCorrect={secureTextEntry || autoCapitalize === "none" ? false : undefined}
        style={[styles.input, multiline && styles.textArea, invalid && styles.inputInvalid]}
        accessibilityLabel={label}
      />
    </View>
  );
}

function Badge({ status, t }: { status: string; t: Translation }) {
  const bad = status === "failed" || status === "conflict" || status === "not_configured";
  const good = status === "synced" || status === "completed" || status === "uploaded";
  return (
    <View style={[styles.badge, good && styles.badgeGood, bad && styles.badgeBad]}>
      <Text style={[styles.badgeText, good && styles.goodText, bad && styles.badText]}>
        {statusLabel(status, t)}
      </Text>
    </View>
  );
}

function GeofenceBadge({
  status,
  t,
}: {
  status: Plot["geofenceStatus"] | Plot["localGeofenceResult"];
  t: Translation;
}) {
  const labels = {
    pending: t.plots.geofencePending,
    inside: t.plots.geofenceInside,
    outside: t.plots.geofenceOutside,
    review_required: t.plots.geofenceReview,
    approved: t.plots.geofenceApproved,
  };
  const blocked = status === "outside" || status === "review_required";
  const good = status === "inside" || status === "approved";
  return (
    <View style={[styles.badge, good && styles.badgeGood, blocked && styles.badgeBad]}>
      <Text style={[styles.badgeText, good && styles.goodText, blocked && styles.badText]}>
        {t.plots.geofence}: {labels[status]}
      </Text>
    </View>
  );
}

function formatDistance(metres: number): string {
  return metres < 1000 ? `${Math.max(1, Math.round(metres))} m` : `${(metres / 1000).toFixed(1)} km`;
}

function LocationFix({
  fix,
  t,
}: {
  fix: { check: PositionGeofenceCheck; accuracyM: number | null };
  t: Translation;
}) {
  const { check, accuracyM } = fix;
  const accuracy = accuracyM === null ? "" : `${t.plots.locationAccuracy}: ±${Math.round(accuracyM)} m`;
  if (check.status === "pending") {
    return (
      <View accessibilityLiveRegion="polite" style={styles.fixBox}>
        <Text style={styles.fixText}>{t.plots.locationPending}</Text>
        {accuracy ? <Text style={styles.caption}>{accuracy}</Text> : null}
      </View>
    );
  }
  const inside = check.status === "inside";
  return (
    <View accessibilityLiveRegion="assertive" style={[styles.fixBox, inside ? styles.fixGood : styles.fixBad]}>
      <Text style={[styles.fixText, inside ? styles.goodText : styles.badText]}>
        {inside
          ? `${t.plots.locationInside}${check.geofence.name ? ` · ${check.geofence.name}` : ""}`
          : t.plots.locationOutside}
      </Text>
      {!inside && check.distanceM !== null ? (
        <Text style={styles.caption}>≈ {formatDistance(check.distanceM)} {t.plots.locationDistance}</Text>
      ) : null}
      {accuracy ? <Text style={styles.caption}>{accuracy}</Text> : null}
    </View>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </View>
  );
}

function CollapsibleListSection({
  title,
  count,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <View style={styles.card}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={`${title} (${count})`}
        style={styles.rowBetween}
      >
        <Text style={styles.cardTitle}>{title} ({count})</Text>
        <Ionicons
          name={collapsed ? "chevron-down" : "chevron-up"}
          size={18}
          color={palette.forest}
        />
      </Pressable>
      {!collapsed ? children : null}
    </View>
  );
}

function HomeScreen({ state, t }: { state: PersistedState; t: Translation }) {
  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t.home.title}</Text>
        <Text style={styles.heroBody}>{t.home.intro}</Text>
        <View style={styles.metrics}>
          {[
            [t.home.suppliers, state.suppliers.length],
            [t.home.plots, state.plots.length],
            [t.home.documents, state.documents.length],
          ].map(([label, value]) => (
            <View key={String(label)} style={styles.metric}>
              <Text style={styles.metricValue}>{value}</Text>
              <Text style={styles.metricLabel}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t.sync.lastSync}</Text>
        <Text style={styles.description}>
          {state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString() : t.sync.never}
        </Text>
        <Text style={styles.caption}>{state.outbox.length} {t.sync.queued}</Text>
      </View>
    </>
  );
}

function SuppliersScreen({
  state,
  update,
  t,
  online,
  shipments,
  onShipmentsLoaded,
  selectedSupplierId,
  onSelectSupplier,
  selectedShipmentId,
  onSelectShipment,
}: {
  state: PersistedState;
  update: (recipe: (current: PersistedState) => PersistedState) => void;
  t: Translation;
  online: boolean;
  shipments: Shipment[];
  onShipmentsLoaded: (shipments: Shipment[]) => void;
  selectedSupplierId: string | null;
  onSelectSupplier: (supplierId: string | null) => void;
  selectedShipmentId: string | null;
  onSelectShipment: (shipmentId: string | null) => void;
}) {
  const selectedLocal = state.suppliers.find((item) => item.id === selectedSupplierId);
  const [name, setName] = useState(selectedLocal?.name ?? "");
  const [region, setRegion] = useState(selectedLocal?.region ?? "");
  const [remoteSuppliers, setRemoteSuppliers] = useState<Supplier[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const remoteOnly = remoteSuppliers.filter(
    (remote) => !state.suppliers.some((local) => local.id === remote.id),
  );

  async function loadRemoteSuppliers() {
    setLoadingRemote(true);
    try {
      setRemoteSuppliers(await getRemoteSuppliers());
      onShipmentsLoaded(await getRemoteShipments());
    } catch (error) {
      Alert.alert(t.common.failed, error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingRemote(false);
    }
  }

  useEffect(() => {
    if (online) void loadRemoteSuppliers();
  }, [online]);

  function selectSupplier(supplier: Supplier) {
    setName(supplier.name);
    setRegion(supplier.region);
    onSelectShipment(null);
    onSelectSupplier(supplier.id);
  }

  function newSupplier() {
    setName("");
    setRegion("");
    onSelectShipment(null);
    onSelectSupplier(null);
  }

  function saveSupplier() {
    if (!name.trim() || !region.trim()) {
      Alert.alert(t.alerts.required);
      return;
    }
    const now = new Date().toISOString();
    const existing = selectedSupplierId
      ? state.suppliers.find((item) => item.id === selectedSupplierId) ??
        remoteSuppliers.find((item) => item.id === selectedSupplierId)
      : undefined;
    const supplier: Supplier = existing
      ? { ...existing, name: name.trim(), region: region.trim(), updatedAt: now, syncStatus: "pending" }
      : {
          id: createUuid(),
          name: name.trim(),
          region: region.trim(),
          producerCount: 0,
          plotCount: 0,
          updatedAt: now,
          syncStatus: "pending",
        };
    update((current) => {
      const known = current.suppliers.some((item) => item.id === supplier.id);
      return {
        ...current,
        suppliers: known
          ? current.suppliers.map((item) => (item.id === supplier.id ? supplier : item))
          : [supplier, ...current.suppliers],
        outbox: [
          ...current.outbox.filter(
            (item) => item.entityType !== "supplier" || item.entityId !== supplier.id,
          ),
          {
            id: createUuid(),
            idempotencyKey: createUuid(),
            entityType: "supplier",
            entityId: supplier.id,
            action: "upsert",
            payload: supplier,
            createdAt: now,
            attempts: 0,
          },
        ],
      };
    });
    onSelectSupplier(supplier.id);
    Alert.alert(t.alerts.saved);
  }

  function renderSupplier(supplier: Supplier) {
    const selected = supplier.id === selectedSupplierId;
    return (
      <Pressable
        key={supplier.id}
        onPress={() => selectSupplier(supplier)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={[styles.card, selected && styles.cardSelected]}
      >
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <Text style={styles.cardTitle}>{supplier.name}</Text>
            <Text style={styles.caption}>{supplier.region} · {supplier.id}</Text>
          </View>
          {selected ? (
            <Ionicons name="checkmark-circle" size={22} color={palette.forest} accessibilityLabel={t.suppliers.selected} />
          ) : null}
          <Badge status={supplier.syncStatus} t={t} />
        </View>
        <Text style={styles.description}>
          {supplier.producerCount} {t.suppliers.producerCount} · {supplier.plotCount} {t.suppliers.plotCount}
        </Text>
      </Pressable>
    );
  }

  return (
    <>
      <Section title={t.suppliers.title} description={t.suppliers.description} />
      <View style={styles.card}>
        <Field label={t.common.name} value={name} onChangeText={setName} />
        <Field label={t.common.region} value={region} onChangeText={setRegion} />
        {selectedSupplierId ? <Text style={styles.caption}>{t.suppliers.selected}: {selectedSupplierId}</Text> : null}
        <Button
          label={selectedSupplierId ? t.suppliers.update : t.suppliers.add}
          icon={selectedSupplierId ? "save" : "person-add"}
          onPress={saveSupplier}
        />
        {selectedSupplierId ? (
          <Button label={t.suppliers.newSupplier} icon="add-circle" onPress={newSupplier} secondary />
        ) : null}
      </View>
      {state.suppliers.length === 0 ? <Text style={styles.empty}>{t.suppliers.empty}</Text> : null}
      {state.suppliers.map(renderSupplier)}
      {online ? (
        <>
          <Section title={t.suppliers.remoteTitle}>
            <Button
              label={loadingRemote ? `${t.suppliers.loadRemote} ...` : t.suppliers.loadRemote}
              icon="cloud-download"
              onPress={() => void loadRemoteSuppliers()}
              secondary
              disabled={loadingRemote}
            />
          </Section>
          {!loadingRemote && remoteOnly.length === 0 ? (
            <Text style={styles.empty}>{t.suppliers.remoteEmpty}</Text>
          ) : null}
          {remoteOnly.map(renderSupplier)}
          {shipments.length > 0 ? <Section title={t.suppliers.shipmentsTitle} description={t.suppliers.shipmentsDescription}>
            {shipments.map((shipment) => (
              <View key={shipment.id} style={[styles.card, shipment.id === selectedShipmentId && styles.cardSelected]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: shipment.id === selectedShipmentId }}
                  onPress={() => {
                    onSelectShipment(shipment.id);
                    onSelectSupplier(shipment.supplierId);
                  }}
                >
                  <Text style={styles.cardTitle}>{shipment.reference} · {shipment.product}</Text>
                  <Text style={styles.caption}>
                    {shipment.quantityKg} kg · {shipment.originCountry}{shipment.originRegion ? ` / ${shipment.originRegion}` : ""}
                  </Text>
                  <Text style={styles.caption}>
                    {t.suppliers.shipmentSupplier}: {shipment.supplierName ?? t.suppliers.noSupplier}
                    {" · "}{t.suppliers.shipmentStatus}: {t.suppliers[`status_${shipment.status}`]}
                  </Text>
                  {shipment.destination ? <Text style={styles.caption}>{shipment.destination}</Text> : null}
                </Pressable>
              </View>
            ))}
            {selectedShipmentId ? (
              <Button
                label={t.suppliers.clearShipment}
                icon="close-circle"
                onPress={() => {
                  onSelectShipment(null);
                  onSelectSupplier(null);
                }}
                secondary
              />
            ) : null}
          </Section> : null}
        </>
      ) : null}
    </>
  );
}

const MAX_GPS_TRACK_POINTS = 10000;

function PlotsScreen({
  state,
  update,
  t,
  online,
  organizationId,
  selectedSupplierId,
  shipments,
  onShipmentsLoaded,
  selectedShipmentId,
  onSelectShipment,
}: {
  state: PersistedState;
  update: (recipe: (current: PersistedState) => PersistedState) => void;
  t: Translation;
  online: boolean;
  organizationId: string;
  selectedSupplierId: string | null;
  shipments: Shipment[];
  onShipmentsLoaded: (shipments: Shipment[]) => void;
  selectedShipmentId: string | null;
  onSelectShipment: (shipmentId: string | null) => void;
}) {
  const [producer, setProducer] = useState("");
  const [farm, setFarm] = useState("");
  const [area, setArea] = useState("");
  const [supplierId, setSupplierId] = useState(selectedSupplierId ?? "");
  const [documentId, setDocumentId] = useState("");
  const [trackPoints, setTrackPoints] = useState<GpsTrackPoint[]>([]);
  const trackPointsRef = useRef<GpsTrackPoint[]>([]);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const [tracking, setTracking] = useState(false);
  const [geoJsonText, setGeoJsonText] = useState("");
  const [polygon, setPolygon] = useState<GeoJsonPolygon | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"producer" | "farm" | "area", string>>>({});
  const [polygonError, setPolygonError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [fix, setFix] = useState<{ check: PositionGeofenceCheck; accuracyM: number | null } | null>(null);
  const uploadedDocuments = state.documents.filter((document) => document.status === "uploaded");
  const selectedShipment = shipments.find((shipment) => shipment.id === selectedShipmentId) ?? null;

  useEffect(() => {
    setSupplierId(selectedShipment?.supplierId ?? selectedSupplierId ?? "");
  }, [selectedShipmentId, selectedShipment?.supplierId, selectedSupplierId]);

  useEffect(() => () => {
    watchRef.current?.remove();
    watchRef.current = null;
  }, []);

  useEffect(() => {
    if (!online || shipments.length > 0) return;
    let active = true;
    void getRemoteShipments()
      .then((loaded) => {
        if (active) onShipmentsLoaded(loaded);
      })
      .catch((error) => {
        if (active) Alert.alert(t.common.failed, error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [online, shipments.length, onShipmentsLoaded, t.common.failed]);

  function replaceTrackPoints(next: GpsTrackPoint[]) {
    trackPointsRef.current = next;
    setTrackPoints(next);
  }

  function appendTrackPoint(location: Location.LocationObject) {
    const position: Position = [location.coords.longitude, location.coords.latitude];
    if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) return;
    const previous = trackPointsRef.current;
    if (previous.length >= MAX_GPS_TRACK_POINTS) {
      watchRef.current?.remove();
      watchRef.current = null;
      setTracking(false);
      Alert.alert(t.plots.trackCount, t.plots.maxPoints);
      return;
    }
    const last = previous[previous.length - 1];
    if (last) {
      const latitudeDelta = (position[1] - last.position[1]) * 111320;
      const longitudeDelta = (position[0] - last.position[0]) *
        111320 * Math.cos((position[1] * Math.PI) / 180);
      if (Math.hypot(latitudeDelta, longitudeDelta) < 2) return;
    }
    const accuracy = location.coords.accuracy;
    const next = [...previous, {
      position,
      accuracyM: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null,
      capturedAt: new Date(location.timestamp).toISOString(),
    }];
    replaceTrackPoints(next);
    showFix({ position, accuracyM: next[next.length - 1].accuracyM });
  }

  function applyPolygonText(value = geoJsonText) {
    try {
      const next = parsePolygon(value);
      setPolygon(next);
      replaceTrackPoints([]);
      setGeoJsonText(JSON.stringify(next, null, 2));
      setPolygonError(null);
    } catch {
      setPolygon(null);
      setPolygonError(t.plots.invalidPolygonDetail);
    }
  }

  function resetCapture() {
    watchRef.current?.remove();
    watchRef.current = null;
    setTracking(false);
    replaceTrackPoints([]);
    setPolygon(null);
    setGeoJsonText("");
    setPolygonError(null);
    setFix(null);
  }

  async function readPosition(): Promise<{ position: Position; accuracyM: number | null } | null> {
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(t.plots.permissionError);
        return null;
      }
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const position: Position = [location.coords.longitude, location.coords.latitude];
      if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) throw new Error("Invalid GPS fix.");
      const accuracy = location.coords.accuracy;
      return { position, accuracyM: typeof accuracy === "number" && Number.isFinite(accuracy) ? accuracy : null };
    } catch {
      Alert.alert(t.plots.gpsError);
      return null;
    } finally {
      setLocating(false);
    }
  }

  function showFix({ position, accuracyM }: { position: Position; accuracyM: number | null }) {
    let check: PositionGeofenceCheck;
    try {
      check = checkPositionAgainstGeofences(
        position,
        state.geofences.filter((item) => item.organizationId === organizationId),
      );
    } catch {
      check = { status: "pending" };
    }
    setFix({ check, accuracyM });
  }

  async function checkLocation() {
    const result = await readPosition();
    if (result) showFix(result);
  }

  async function capturePoint() {
    setLocating(true);
    const fixResult = await readPosition();
    if (!fixResult) return;
    showFix(fixResult);
    appendTrackPoint({
      coords: {
        latitude: fixResult.position[1],
        longitude: fixResult.position[0],
        accuracy: fixResult.accuracyM,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    });
  }

  async function startWalk() {
    if (tracking) return;
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(t.plots.permissionError);
        return;
      }
      setPolygon(null);
      setGeoJsonText("");
      setTracking(true);
      watchRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 3000, distanceInterval: 2 },
        appendTrackPoint,
        (error) => Alert.alert(t.plots.gpsError, error),
      );
    } catch (error) {
      setTracking(false);
      Alert.alert(t.plots.gpsError, error instanceof Error ? error.message : String(error));
    }
  }

  function finishWalk() {
    watchRef.current?.remove();
    watchRef.current = null;
    setTracking(false);
    try {
      const nextPolygon = closePolygon(trackPointsRef.current.map((point) => point.position));
      setPolygon(nextPolygon);
      setGeoJsonText(JSON.stringify(nextPolygon, null, 2));
    } catch {
      Alert.alert(t.plots.tooFewTrackPoints);
    }
  }

  function undoTrackPoint() {
    replaceTrackPoints(trackPointsRef.current.slice(0, -1));
    setPolygon(null);
    setGeoJsonText("");
  }

  async function importGeoJson() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/geo+json", "application/json", "text/json"],
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    try {
      const text = await fetch(result.assets[0].uri).then((response) => response.text());
      setGeoJsonText(text);
      applyPolygonText(text);
    } catch {
      Alert.alert(t.plots.invalidPolygon);
    }
  }

  function savePlot() {
    const parsedArea = area.trim() ? Number(area.replace(",", ".")) : Number.NaN;
    const nextFieldErrors = {
      ...(!producer.trim() ? { producer: t.plots.producerRequired } : {}),
      ...(!farm.trim() ? { farm: t.plots.farmRequired } : {}),
      ...(!area.trim()
        ? { area: t.plots.areaRequired }
        : !Number.isFinite(parsedArea) || parsedArea <= 0
          ? { area: t.plots.areaInvalid }
          : {}),
    };
    let polygonForSave = polygon;
    let nextPolygonError: string | null = null;
    if (geoJsonText.trim()) {
      try {
        polygonForSave = parsePolygon(geoJsonText);
      } catch {
        polygonForSave = null;
        nextPolygonError = t.plots.invalidPolygonDetail;
      }
    } else if (!polygonForSave && trackPoints.length >= 3) {
      try {
        polygonForSave = closePolygon(trackPoints.map((point) => point.position));
      } catch {
        nextPolygonError = t.plots.invalidPolygonDetail;
      }
    }
    if (!polygonForSave) {
      nextPolygonError ??= t.plots.polygonRequired;
    }
    setFieldErrors(nextFieldErrors);
    setPolygonError(nextPolygonError);
    if (Object.keys(nextFieldErrors).length > 0 || !polygonForSave) {
      return;
    }
    const now = new Date().toISOString();
    const localGeofenceResult = evaluatePlotGeofence(
      polygonForSave,
      state.geofences.filter((item) => item.organizationId === organizationId),
    );
    const plot: Plot = {
      id: createUuid(),
      supplierId: (selectedShipment ? selectedShipment.supplierId : supplierId.trim()) || undefined,
      ...(selectedShipment ? { shipmentId: selectedShipment.id } : {}),
      documentId: documentId || undefined,
      producer: producer.trim(),
      farmName: farm.trim(),
      areaHa: parsedArea.toFixed(2),
      polygon: polygonForSave,
      trackPoints,
      localGeofenceResult,
      geofenceStatus: localGeofenceResult === "outside"
        ? "review_required"
        : localGeofenceResult,
      capturedAt: now,
      updatedAt: now,
      syncStatus: "pending",
    };
    update((current) => ({
      ...current,
      plots: [plot, ...current.plots],
      outbox: [
        ...current.outbox,
        {
          id: createUuid(),
          idempotencyKey: createUuid(),
          entityType: "plot",
          entityId: plot.id,
          action: "upsert",
          payload: plot,
          createdAt: now,
          attempts: 0,
        },
      ],
    }));
    setProducer("");
    setFarm("");
    setArea("");
    setSupplierId(selectedSupplierId ?? "");
    setDocumentId("");
    replaceTrackPoints([]);
    setPolygon(null);
    setGeoJsonText("");
    setFix(null);
    Alert.alert(t.alerts.saved);
  }

  return (
    <>
      <Section title={t.plots.title} description={t.plots.description} />
      <View style={styles.card}>
        <Field label={t.plots.producer} value={producer} onChangeText={(value) => {
          setProducer(value);
          setFieldErrors((current) => ({ ...current, producer: undefined }));
        }} invalid={Boolean(fieldErrors.producer)} />
        {fieldErrors.producer ? <Text style={styles.errorText}>{fieldErrors.producer}</Text> : null}
        <Field label={t.plots.farm} value={farm} onChangeText={(value) => {
          setFarm(value);
          setFieldErrors((current) => ({ ...current, farm: undefined }));
        }} invalid={Boolean(fieldErrors.farm)} />
        {fieldErrors.farm ? <Text style={styles.errorText}>{fieldErrors.farm}</Text> : null}
        <Field label={t.plots.area} value={area} onChangeText={(value) => {
          setArea(value);
          setFieldErrors((current) => ({ ...current, area: undefined }));
        }} keyboardType="decimal-pad" invalid={Boolean(fieldErrors.area)} />
        {fieldErrors.area ? <Text style={styles.errorText}>{fieldErrors.area}</Text> : null}
        {shipments.length > 0 ? <>
        <Text style={styles.fieldLabel}>{t.plots.selectedShipment}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: selectedShipmentId === null }}
          onPress={() => {
            onSelectShipment(null);
            setSupplierId(selectedSupplierId ?? "");
          }}
          style={[styles.documentChoice, !selectedShipmentId && styles.documentChoiceSelected]}
        >
          <Text>{t.plots.noShipment}</Text>
        </Pressable>
        {shipments.map((shipment) => (
          <Pressable
            key={shipment.id}
            accessibilityRole="button"
            accessibilityState={{ selected: shipment.id === selectedShipmentId }}
            onPress={() => {
              onSelectShipment(shipment.id);
              setSupplierId(shipment.supplierId ?? "");
            }}
            style={[styles.documentChoice, shipment.id === selectedShipmentId && styles.documentChoiceSelected]}
          >
            <Text>{shipment.reference} · {shipment.product} · {shipment.quantityKg} kg</Text>
          </Pressable>
        ))}
        </> : null}
        {selectedShipment ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t.plots.shipment}</Text>
            <Text style={styles.caption}>{selectedShipment.originCountry}{selectedShipment.originRegion ? ` / ${selectedShipment.originRegion}` : ""} → {selectedShipment.destination || "—"}</Text>
            <Text style={styles.caption}>{t.suppliers.shipmentSupplier}: {selectedShipment.supplierName ?? t.suppliers.noSupplier}</Text>
            <Text style={styles.caption}>{t.suppliers.shipmentStatus}: {t.suppliers[`status_${selectedShipment.status}`]}</Text>
          </View>
        ) : null}
        {selectedShipment ? (
          <View>
            <Text style={styles.label}>{t.plots.supplierId}</Text>
            <Text style={styles.caption}>{selectedShipment.supplierName ?? t.suppliers.noSupplier}</Text>
          </View>
        ) : (
          <Field label={t.plots.supplierId} value={supplierId} onChangeText={setSupplierId} />
        )}
        <Text style={styles.caption}>{t.plots.trackCount}: {trackPoints.length} / {MAX_GPS_TRACK_POINTS}</Text>
        <Button
          label={locating ? "GPS ..." : t.plots.capturePoint}
          icon="locate"
          onPress={() => void capturePoint()}
          secondary
          disabled={locating}
        />
        <Button
          label={tracking ? t.plots.stopWalk : t.plots.startWalk}
          icon={tracking ? "stop-circle" : "walk"}
          onPress={() => tracking ? finishWalk() : void startWalk()}
          disabled={locating}
        />
        {trackPoints.length ? (
          <Button label={t.plots.undoPoint} icon="arrow-undo" onPress={undoTrackPoint} secondary />
        ) : null}
        <Button
          label={t.plots.checkLocation}
          icon="shield-checkmark"
          onPress={() => void checkLocation()}
          secondary
          disabled={locating}
        />
        {fix ? <LocationFix fix={fix} t={t} /> : null}
        {uploadedDocuments.length ? (
          <View>
            <Text style={styles.fieldLabel}>{t.plots.selectDocument}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setDocumentId("")}
              style={[styles.documentChoice, !documentId && styles.documentChoiceSelected]}
            >
              <Text>{t.plots.noDocument}</Text>
            </Pressable>
            {uploadedDocuments.map((document) => (
              <Pressable
                key={document.id}
                accessibilityRole="button"
                accessibilityState={{ selected: document.id === documentId }}
                onPress={() => setDocumentId(document.id)}
                style={[styles.documentChoice, document.id === documentId && styles.documentChoiceSelected]}
              >
                <Text>{document.fileName}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <PlotMapPreview
          positions={polygon?.coordinates[0].slice(0, -1) ?? []}
          trackPoints={trackPoints}
          polygon={polygon}
          unavailableLabel={t.plots.mapUnavailable}
        />
        <Button label={t.plots.importGeoJson} icon="document-attach" onPress={() => void importGeoJson()} secondary />
        <Field
          label={t.plots.polygonJson}
          value={geoJsonText}
          onChangeText={(value) => {
            setGeoJsonText(value);
            setPolygon(null);
            setPolygonError(null);
          }}
          multiline
          placeholder='{"type":"Polygon","coordinates":[...]}'
          invalid={Boolean(polygonError)}
        />
        <Text style={styles.caption}>{t.plots.polygonHint}</Text>
        {polygonError ? <Text style={styles.errorText}>{polygonError}</Text> : null}
        <Button label={t.plots.applyGeoJson} icon="checkmark-circle" onPress={() => applyPolygonText()} secondary />
        <Button label={t.plots.saveDraft} icon="save" onPress={savePlot} />
      </View>
      {state.plots.length === 0 ? <Text style={styles.empty}>{t.plots.empty}</Text> : null}
      {state.plots.map((plot) => (
        <View key={plot.id} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.flex}>
              <Text style={styles.cardTitle}>{plot.farmName}</Text>
              <Text style={styles.caption}>{plot.producer} · {plot.areaHa} ha</Text>
            </View>
            <Badge status={plot.syncStatus} t={t} />
          </View>
          <View style={styles.buttonRow}>
            <GeofenceBadge status={plot.localGeofenceResult} t={t} />
            {plot.geofenceStatus !== plot.localGeofenceResult ? (
              <GeofenceBadge status={plot.geofenceStatus} t={t} />
            ) : null}
          </View>
          {plot.geofenceStatus === "outside" || plot.geofenceStatus === "review_required" ? (
            <Text style={styles.errorText}>{t.plots.geofenceBlocked}</Text>
          ) : null}
          {plot.documentId ? (
            <Text style={styles.caption}>
              {t.plots.linkedDocument}: {state.documents.find((document) => document.id === plot.documentId)?.fileName ?? plot.documentId}
            </Text>
          ) : null}
          {plot.shipmentId ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t.plots.shipment}</Text>
              {(() => {
                const shipment = shipments.find((item) => item.id === plot.shipmentId);
                return shipment ? (
                  <>
                    <Text style={styles.caption}>{shipment.reference} · {shipment.product} · {shipment.quantityKg} kg</Text>
                    <Text style={styles.caption}>{shipment.originCountry}{shipment.originRegion ? ` / ${shipment.originRegion}` : ""} → {shipment.destination || "—"}</Text>
                    <Text style={styles.caption}>{t.suppliers.shipmentSupplier}: {shipment.supplierName ?? t.suppliers.noSupplier}</Text>
                  </>
                ) : <Text style={styles.caption}>{plot.shipmentId}</Text>;
              })()}
            </View>
          ) : null}
          <PlotMapPreview
            positions={plot.polygon.coordinates[0].slice(0, -1)}
            trackPoints={plot.trackPoints ?? []}
            polygon={plot.polygon}
            unavailableLabel={t.plots.mapUnavailable}
          />
          <Text style={styles.mono}>{JSON.stringify(plot.polygon)}</Text>
        </View>
      ))}
    </>
  );
}

function OperationsScreen({
  state,
  update,
  t,
  online,
}: {
  state: PersistedState;
  update: (recipe: (current: PersistedState) => PersistedState) => void;
  t: Translation;
  online: boolean;
}) {
  const [collapsed, setCollapsed] = useState({
    uploads: false,
    requests: false,
    downloads: false,
  });
  const configured = getApiBaseUrl() !== null;
  const evidenceOperations = state.operations.filter((operation) => operation.kind === "evidence_pack");
  const downloadableOperations = evidenceOperations.filter((operation) =>
    operation.downloadUrl || operation.localDownloadUri || operation.localDownloadStatus === "queued",
  );

  function providerError(error: unknown): string {
    if (error instanceof ApiError && error.code === "NOT_CONFIGURED") {
      return t.operations.providerBlocked;
    }
    return error instanceof Error ? error.message : String(error);
  }

  function updateOperation(
    operationId: string,
    recipe: (operation: OperationalRequest) => OperationalRequest,
  ) {
    update((current) => ({
      ...current,
      operations: current.operations.map((operation) =>
        operation.id === operationId ? recipe(operation) : operation,
      ),
    }));
  }

  function mergeOperationLocalState(
    remote: OperationalRequest,
    local?: OperationalRequest,
  ): OperationalRequest {
    const merged: OperationalRequest = {
      ...remote,
      localDownloadUri: local?.localDownloadUri,
      localDownloadStatus: local?.localDownloadStatus,
      localDownloadError: local?.localDownloadError,
    };
    if (merged.kind !== "evidence_pack" || !merged.downloadUrl || merged.localDownloadUri) {
      return merged;
    }
    if (merged.localDownloadStatus) return merged;
    return {
      ...merged,
      localDownloadStatus: "queued",
    };
  }

  async function openLocalDocument(uri: string) {
    // Android does not allow file:// URIs in intents; the share sheet hands out a FileProvider URI.
    if (Platform.OS === "android" && (await Sharing.isAvailableAsync())) {
      try {
        await Sharing.shareAsync(uri, { mimeType: "application/json" });
        return;
      } catch {
        Alert.alert(t.common.download, uri);
        return;
      }
    }
    try {
      await Linking.openURL(uri);
      return;
    } catch {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
        return;
      }
    }
    Alert.alert(t.common.download, uri);
  }

  async function queueOrDownloadEvidence(
    operation: OperationalRequest,
    openAfterDownload: boolean,
  ) {
    if (!operation.downloadUrl) return;
    if (!online) {
      updateOperation(operation.id, (current) => ({
        ...current,
        localDownloadStatus: "queued",
        localDownloadError: undefined,
      }));
      return;
    }
    updateOperation(operation.id, (current) => ({
      ...current,
      localDownloadStatus: "downloading",
      localDownloadError: undefined,
    }));
    try {
      if (!FileSystem.documentDirectory) {
        throw new Error("Document storage is unavailable.");
      }
      const destinationUri = `${FileSystem.documentDirectory}evidence-${operation.id}.json`;
      const headers = await getCurrentAuthHeaders();
      await FileSystem.deleteAsync(destinationUri, { idempotent: true });
      const file = await FileSystem.downloadAsync(operation.downloadUrl, destinationUri, {
        headers,
      });
      const localUri = file.uri;
      updateOperation(operation.id, (current) => ({
        ...current,
        localDownloadUri: localUri,
        localDownloadStatus: "downloaded",
        localDownloadError: undefined,
      }));
      if (openAfterDownload) await openLocalDocument(localUri);
    } catch (error) {
      updateOperation(operation.id, (current) => ({
        ...current,
        localDownloadStatus: "failed",
        localDownloadError: providerError(error),
      }));
    }
  }

  async function showLocalDocument(operation: OperationalRequest) {
    if (operation.localDownloadUri) {
      await openLocalDocument(operation.localDownloadUri);
      return;
    }
    if (operation.downloadUrl) {
      await queueOrDownloadEvidence(operation, true);
    }
  }

  function removeOperation(operationId: string) {
    update((current) => ({
      ...current,
      operations: current.operations.filter((operation) => operation.id !== operationId),
    }));
  }

  async function pickAndUpload() {
    if (!configured) {
      Alert.alert(t.sync.notConfigured, t.operations.providerBlocked);
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    await uploadAsset(asset.uri, asset.name, asset.mimeType ?? "application/octet-stream", asset.size ?? 0);
  }

  async function pickImageForOcr(camera: boolean) {
    if (!configured) {
      Alert.alert(t.sync.notConfigured, t.operations.providerBlocked);
      return;
    }
    if (camera) {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t.operations.scanPhoto, t.plots.permissionError);
        return;
      }
    } else {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t.operations.chooseImage, t.plots.permissionError);
        return;
      }
    }
    const result = camera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = result.assets?.[0];
    if (result.canceled || !asset) return;
    await uploadAsset(
      asset.uri,
      asset.fileName ?? `parcel-document-${Date.now()}.jpg`,
      asset.mimeType ?? "image/jpeg",
      asset.fileSize ?? 0,
    );
  }

  async function uploadAsset(uri: string, name: string, mimeType: string, size: number) {
    const localId = createUuid();
    update((current) => ({
      ...current,
      documents: [{
        id: localId,
        fileName: name,
        mimeType,
        size,
        status: "uploading",
        createdAt: new Date().toISOString(),
      }, ...current.documents],
    }));
    try {
      const uploaded = await uploadDocument({
        uri,
        name,
        mimeType,
        size,
        idempotencyKey: localId,
      });
      update((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === localId
            ? { ...document, id: uploaded.id, status: "uploaded" }
            : document,
        ),
      }));
      if (mimeType.startsWith("image/")) {
        try {
          if (Platform.OS === "web" || !isOcrSupported()) {
            Alert.alert(t.operations.ocrUnavailable);
          } else {
            const result = await recognizeText(uri);
            update((current) => ({
              ...current,
              documents: current.documents.map((document) =>
                document.id === uploaded.id
                  ? { ...document, localOcrText: result.text, localOcrReviewed: false }
                  : document,
              ),
            }));
            if (!result.text.trim()) Alert.alert(t.operations.ocrEmpty);
          }
        } catch (error) {
          Alert.alert(
            t.operations.ocrFailed,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
    } catch (error) {
      update((current) => ({
        ...current,
        documents: current.documents.map((document) =>
          document.id === localId ? { ...document, status: "failed" } : document,
        ),
      }));
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  async function refresh(operation: OperationalRequest) {
    try {
      const result = await getOperation(operation.kind, operation.id);
      update((current) => ({
        ...current,
        operations: current.operations.map((item) =>
          item.id === result.id ? mergeOperationLocalState(result, item) : item,
        ),
      }));
    } catch (error) {
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  async function mutateDds(operation: OperationalRequest, action: "validate" | "submit") {
    try {
      const result = action === "validate"
        ? await validateDds(operation.id, createUuid())
        : await submitDds(operation.id, createUuid());
      update((current) => ({
        ...current,
        operations: current.operations.map((item) =>
          item.id === result.id ? mergeOperationLocalState(result, item) : item,
        ),
      }));
    } catch (error) {
      Alert.alert(t.common.failed, providerError(error));
    }
  }

  useEffect(() => {
    if (!online) return;
    if (state.operations.some((operation) => operation.localDownloadStatus === "downloading")) return;
    const queued = state.operations.find((operation) =>
      operation.kind === "evidence_pack" &&
      operation.downloadUrl &&
      (
        operation.localDownloadStatus === "queued" ||
        (operation.status === "completed" && !operation.localDownloadUri && !operation.localDownloadStatus)
      ),
    );
    if (!queued) return;
    void queueOrDownloadEvidence(queued, false);
  }, [online, state.operations]);

  return (
    <>
      <Section title={t.operations.title} />
      {!configured ? (
        <View style={styles.blocking}>
          <Ionicons name="warning" size={23} color={palette.red} />
          <View style={styles.flex}>
            <Text style={styles.blockingTitle}>{t.sync.notConfigured}</Text>
            <Text style={styles.description}>{t.sync.notConfiguredDetail}</Text>
          </View>
        </View>
      ) : null}
      <CollapsibleListSection
        title={t.operations.uploadsList}
        count={state.documents.length}
        collapsed={collapsed.uploads}
        onToggle={() => setCollapsed((current) => ({ ...current, uploads: !current.uploads }))}
      >
        <Button label={t.operations.pickUpload} icon="cloud-upload" onPress={() => void pickAndUpload()} disabled={!configured} />
        <View style={styles.buttonRow}>
          <Button
            label={t.operations.scanPhoto}
            icon="camera"
            onPress={() => void pickImageForOcr(true)}
            secondary
            disabled={!configured}
          />
          <Button
            label={t.operations.chooseImage}
            icon="image"
            onPress={() => void pickImageForOcr(false)}
            secondary
            disabled={!configured}
          />
        </View>
        {state.documents.map((document) => (
          <View key={document.id} style={styles.listRow}>
            <View style={[styles.flex, styles.documentRow]}>
              <Text style={styles.itemTitle}>{document.fileName}</Text>
              <Text style={styles.caption}>{document.mimeType} · {document.size} B</Text>
              {typeof document.localOcrText === "string" ? (
                <>
                  <Field
                    label={t.operations.ocrText}
                    value={document.localOcrText}
                    onChangeText={(localOcrText) => update((current) => ({
                      ...current,
                      documents: current.documents.map((item) =>
                        item.id === document.id
                          ? { ...item, localOcrText, localOcrReviewed: false }
                          : item,
                      ),
                    }))}
                    multiline
                  />
                  <Pressable
                    style={styles.checkbox}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: document.localOcrReviewed === true }}
                    onPress={() => update((current) => ({
                      ...current,
                      documents: current.documents.map((item) =>
                        item.id === document.id
                          ? { ...item, localOcrReviewed: !item.localOcrReviewed }
                          : item,
                      ),
                    }))}
                  >
                    <Text style={styles.caption}>
                      {document.localOcrReviewed ? "☑" : "☐"} {t.operations.ocrReview}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
            {document.status === "failed" ? null : <Badge status={document.status} t={t} />}
          </View>
        ))}
      </CollapsibleListSection>
      <CollapsibleListSection
        title={t.operations.requestsList}
        count={state.operations.length}
        collapsed={collapsed.requests}
        onToggle={() => setCollapsed((current) => ({ ...current, requests: !current.requests }))}
      >
        {state.operations.length === 0 ? <Text style={styles.empty}>{t.operations.noItems}</Text> : null}
        {state.operations.map((operation) => (
          <View key={operation.id} style={styles.listItemCard}>
            <View style={styles.rowBetween}>
              <View style={styles.flex}>
                <Text style={styles.cardTitle}>{operation.kind.replace("_", " ")}</Text>
                <Text style={styles.caption}>{operation.subjectId} · {operation.id}</Text>
              </View>
              {operation.status === "failed" ? null : <Badge status={operation.status} t={t} />}
            </View>
            {operation.status === "not_configured" ? (
              <Text style={styles.errorText}>{t.operations.providerBlocked}</Text>
            ) : null}
            {operation.message ? <Text style={styles.description}>{operation.message}</Text> : null}
            <Button label={t.operations.checkStatus} icon="refresh" onPress={() => void refresh(operation)} secondary />
            {operation.kind === "dds" ? (
              <View style={styles.buttonRow}>
                <Button label={t.operations.validateDds} icon="checkmark" onPress={() => void mutateDds(operation, "validate")} secondary />
                <Button label={t.operations.submitDds} icon="send" onPress={() => void mutateDds(operation, "submit")} />
              </View>
            ) : null}
          </View>
        ))}
      </CollapsibleListSection>
      <CollapsibleListSection
        title={t.operations.downloadedList}
        count={downloadableOperations.length}
        collapsed={collapsed.downloads}
        onToggle={() => setCollapsed((current) => ({ ...current, downloads: !current.downloads }))}
      >
        {downloadableOperations.length === 0 ? <Text style={styles.empty}>{t.operations.noItems}</Text> : null}
        {downloadableOperations.map((operation) => (
          <View key={`download-${operation.id}`} style={styles.listRow}>
            <View style={styles.flex}>
              <Text style={styles.itemTitle}>{operation.subjectId}</Text>
              <Text style={styles.caption}>{operation.id}</Text>
              {operation.localDownloadStatus === "queued" ? (
                <Text style={styles.caption}>{t.operations.queuedDownload}</Text>
              ) : null}
              {operation.localDownloadStatus === "downloading" ? (
                <Text style={styles.caption}>{t.operations.downloading}</Text>
              ) : null}
              {operation.localDownloadStatus === "downloaded" ? (
                <Text style={styles.caption}>{t.operations.downloaded}</Text>
              ) : null}
            </View>
            <View style={styles.iconButtonRow}>
              <IconActionButton
                label={t.operations.showLocal}
                icon="eye"
                onPress={() => void showLocalDocument(operation)}
                disabled={!operation.localDownloadUri && !operation.downloadUrl}
              />
              <IconActionButton
                label={t.operations.removeItem}
                icon="trash"
                onPress={() => removeOperation(operation.id)}
              />
            </View>
          </View>
        ))}
      </CollapsibleListSection>
    </>
  );
}

function ConflictCard({
  conflict,
  resolve,
  t,
}: {
  conflict: SyncConflict;
  resolve: (conflict: SyncConflict, choice: "local" | "remote") => void;
  t: Translation;
}) {
  return (
    <View style={styles.conflictCard}>
      <Text style={styles.blockingTitle}>{t.common.conflict}: {conflict.entityType}</Text>
      <Text style={styles.caption}>{conflict.entityId}</Text>
      <Text style={styles.mono}>Local: {JSON.stringify(conflict.local)}</Text>
      <Text style={styles.mono}>Server: {JSON.stringify(conflict.remote)}</Text>
      <View style={styles.buttonRow}>
        <Button label={t.sync.keepLocal} icon="phone-portrait" onPress={() => resolve(conflict, "local")} secondary />
        <Button label={t.sync.useServer} icon="cloud" onPress={() => resolve(conflict, "remote")} />
      </View>
    </View>
  );
}

function Dropdown({
  label,
  value,
  options,
  onSelect,
  disabled = false,
}: {
  label: string;
  value: string | null;
  options: readonly { value: string; label: string }[];
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Pressable
        style={[styles.dropdownTrigger, disabled && styles.buttonDisabled]}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? label}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen(!open)}
      >
        <Text style={[styles.itemTitle, styles.flex]}>{selected?.label ?? label}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={20} color={palette.ink} />
      </Pressable>
      {open && !disabled ? (
        <ScrollView style={styles.dropdownOptions} nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => {
                setOpen(false);
                onSelect(option.value);
              }}
              style={[styles.language, option.value === value && styles.languageActive]}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === value }}
            >
              <Text style={[styles.itemTitle, option.value === value && styles.languageText]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function LanguageDropdown({ controller }: { controller: AppController }) {
  return (
    <Dropdown
      label={controller.t.chooseLanguage}
      value={controller.language}
      options={languages.map((language) => ({
        value: language,
        label: `${translations[language].languageCode} · ${translations[language].languageName}`,
      }))}
      onSelect={(value) => {
        if (isLanguage(value)) {
          void controller.setLanguage(value).catch(() => Alert.alert(translations[value].alerts.storageError));
        }
      }}
    />
  );
}

function OrganizationDropdown({ controller }: { controller: AppController }) {
  const { auth, t } = controller;
  return (
    <Dropdown
      label={t.auth.selectOrganization}
      value={auth.session?.selectedOrganizationId ?? null}
      options={auth.session?.organizations.map((organization) => ({
        value: organization.id, label: organization.name,
      })) ?? []}
      disabled={auth.busy}
      onSelect={(id) => {
        if (id !== auth.session?.selectedOrganizationId) {
          void auth.selectOrganization(id).catch((error: unknown) =>
            Alert.alert(t.auth.selectOrganization, error instanceof Error ? error.message : String(error)));
        }
      }}
    />
  );
}

function AuthLayout({ controller, children }: { controller: AppController; children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.authContent}>
          <LanguageDropdown controller={controller} />
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RegistrationScreen({ controller, onBack }: { controller: AppController; onBack: () => void }) {
  const { t, configured, language } = controller;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<ReturnType<typeof phoneCountries>[number]["code"]>("DE");
  const [search, setSearch] = useState("");
  const [countryOpen, setCountryOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<"invalidRegistration" | "requestFailed" | null>(null);
  const countries = useMemo(() => phoneCountries(language), [language]);
  const selected = countries.find((item) => item.code === country)!;

  async function submit() {
    if (submitting.current) return;
    const phoneNumber = normalizePhone(phone, country);
    if (!name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !phoneNumber) {
      setError("invalidRegistration");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await registerAccount({ displayName: name.trim(), email: email.trim(), phoneCountry: country, phoneNumber });
      setName("");
      setEmail("");
      setPhone("");
      setPending(true);
    } catch {
      setError("requestFailed");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthLayout controller={controller}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t.auth.register}</Text>
        {pending ? <Text accessibilityLiveRegion="polite">{t.auth.pendingApproval}</Text> : (
          <>
            <Field label={t.common.name} value={name} onChangeText={setName} />
            <Field label={t.auth.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <Text style={styles.label}>{t.auth.country}</Text>
            <Button label={`${selected.flag} ${selected.name} (${selected.callingCode})`} icon="chevron-down" secondary
              onPress={() => { setSearch(""); setCountryOpen(true); }} disabled={busy} />
            <Field label={t.auth.phone} value={phone} onChangeText={setPhone} keyboardType="phone-pad"
              autoCapitalize="none" placeholder={`${selected.callingCode} …`} />
            {error ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{t.auth[error]}</Text> : null}
            {!configured ? <Text style={styles.errorText}>{t.sync.notConfiguredDetail}</Text> : null}
            <Button label={busy ? `${t.auth.register} …` : t.auth.register} icon="person-add" onPress={() => void submit()} disabled={busy || !configured} />
          </>
        )}
        <Button label={t.auth.backToLogin} icon="arrow-back" secondary onPress={onBack} disabled={busy} />
      </View>
      <Modal visible={countryOpen} transparent animationType="fade" onRequestClose={() => setCountryOpen(false)}>
        <View style={styles.modal}>
          <View style={[styles.dialog, { maxHeight: "85%" }]}>
            <Field label={t.auth.searchCountry} value={search} onChangeText={setSearch} autoCapitalize="none" />
            <ScrollView keyboardShouldPersistTaps="handled">
              {searchPhoneCountries(countries, search).map((item) => (
                <Pressable key={item.code} style={styles.language} accessibilityRole="radio"
                  accessibilityState={{ checked: country === item.code }}
                  onPress={() => { setCountry(item.code); setCountryOpen(false); }}>
                  <Text>{item.flag} {item.name} ({item.callingCode})</Text>
                </Pressable>
              ))}
            </ScrollView>
            <Button label={t.close} icon="close" secondary onPress={() => setCountryOpen(false)} />
          </View>
        </View>
      </Modal>
    </AuthLayout>
  );
}

function ActivationScreen({ controller }: { controller: AppController }) {
  const { auth, t, configured } = controller;
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [invalid, setInvalid] = useState(false);
  const status = auth.activation!.status;
  const editable = status === "ready" || status === "failed";
  const messages = {
    clearing: t.auth.clearingSession, ready: t.auth.activationIntro,
    invalid: t.auth.invalidActivation, failed: t.auth.activationFailed,
    loginFailed: t.auth.activationLoginFailed, storageError: t.auth.sessionClearFailed,
  };
  async function submit() {
    if (password.length < 12 || password.length > 1024 || password !== confirmation) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    try { await auth.activate(password); }
    finally { setPassword(""); setConfirmation(""); }
  }
  return (
    <AuthLayout controller={controller}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t.auth.activate}</Text>
        <Text accessibilityLiveRegion="polite">{messages[status]}</Text>
        {editable ? <>
          <Text>{t.auth.passwordHint}</Text>
          <Field label={t.auth.password} value={password} onChangeText={setPassword} autoCapitalize="none" secureTextEntry />
          <Field label={t.auth.confirmPassword} value={confirmation} onChangeText={setConfirmation} autoCapitalize="none" secureTextEntry />
          {invalid ? <Text style={styles.errorText}>{t.auth.passwordMismatch}</Text> : null}
          {!configured ? <Text style={styles.errorText}>{t.sync.notConfiguredDetail}</Text> : null}
          <Button label={auth.busy ? `${t.auth.activate} …` : t.auth.activate} icon="key"
            onPress={() => void submit()} disabled={auth.busy || !configured} />
        </> : null}
        <Button label={t.auth.backToLogin} icon="arrow-back" secondary onPress={auth.dismissActivation}
          disabled={auth.busy || status === "clearing" || status === "storageError"} />
      </View>
    </AuthLayout>
  );
}

function LoginScreen({ controller }: { controller: AppController }) {
  const [register, setRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationSlug, setOrganizationSlug] = useState("");
  const { auth, t, configured } = controller;

  async function submit() {
    if (!email.trim() || !password) {
      Alert.alert(t.alerts.required);
      return;
    }
    try {
      await auth.login(email, password, organizationSlug);
    } catch {
      // The controller exposes a localized-screen-safe error string.
    }
  }

  if (register) return <RegistrationScreen controller={controller} onBack={() => setRegister(false)} />;
  return (
    <AuthLayout controller={controller}>
        <View style={styles.loginBrand}>
          <View style={styles.logo}><Text style={styles.logoText}>SC</Text></View>
          <Text style={styles.loginTitle}>Tracecomplaince</Text>
          <Text style={styles.headerSub}>{t.brandSubtitle}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.heading}>{t.auth.title}</Text>
          {!configured ? <Text style={styles.errorText}>{t.sync.notConfiguredDetail}</Text> : null}
          <Field
            label={t.auth.email}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Field
            label={t.auth.password}
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            secureTextEntry
          />
          <Field
            label={t.auth.organizationSlug}
            value={organizationSlug}
            onChangeText={setOrganizationSlug}
            autoCapitalize="none"
          />
          {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
          <Button
            label={auth.busy ? `${t.auth.signIn} ...` : t.auth.signIn}
            icon="log-in"
            onPress={() => void submit()}
            disabled={auth.busy || !configured}
          />
          <Button label={t.auth.register} icon="person-add" secondary onPress={() => setRegister(true)} disabled={auth.busy} />
        </View>
    </AuthLayout>
  );
}

function OrganizationScreen({ controller }: { controller: AppController }) {
  const { auth, t } = controller;
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.login}>
        <View style={styles.card}>
          <Text style={styles.heading}>{t.auth.selectOrganization}</Text>
          <OrganizationDropdown controller={controller} />
          <LanguageDropdown controller={controller} />
          {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
          <Button label={t.auth.signOut} icon="log-out" onPress={() => void auth.logout()} />
        </View>
      </View>
    </SafeAreaView>
  );
}

function UserMenu({
  controller,
  visible,
  onClose,
}: {
  controller: AppController;
  visible: boolean;
  onClose: () => void;
}) {
  const { auth, t } = controller;
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={[styles.dialog, styles.userMenuDialog]} onTouchStart={auth.recordActivity}>
          <ScrollView style={styles.userMenuContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            <View style={styles.userIdentity}>
              <Ionicons name="person-circle-outline" size={44} color={palette.forest} />
              <Text style={styles.cardTitle}>{t.userAccount}</Text>
              {auth.session?.user.displayName || auth.session?.user.name ? (
                <Text style={styles.itemTitle}>{auth.session.user.displayName ?? auth.session.user.name}</Text>
              ) : null}
              <Text style={styles.description}>{auth.session?.user.email}</Text>
            </View>
            <OrganizationDropdown controller={controller} />
            <LanguageDropdown controller={controller} />
            <Text style={styles.description}>{t.languageHint}</Text>
            {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
          </ScrollView>
          <View>
            <Button
              label={t.auth.signOut}
              icon="log-out"
              disabled={auth.busy}
              onPress={() => {
                void auth.logout();
                onClose();
              }}
            />
          </View>
          <View>
            <Button label={t.close} icon="close" onPress={onClose} secondary />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function AppView({ controller }: { controller: AppController }) {
  const { width, fontScale } = useWindowDimensions();
  const compactLayout = width < 380 || fontScale >= 1.3;
  const wideLayout = width >= 600;
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);
  const [remoteShipments, setRemoteShipments] = useState<Shipment[]>([]);
  const {
    auth,
    activeTab,
    setActiveTab,
    state,
    update,
    online,
    syncing,
    syncError,
    storageError,
    geofenceError,
    syncNow,
    resolveConflict,
    t,
    configured,
  } = controller;

  const organizationId = auth.session?.selectedOrganizationId;
  const userRoles = auth.session?.user.roles?.length
    ? auth.session.user.roles
    : auth.session?.user.role ? [auth.session.user.role] : [];
  const roleLabel = userRoles.join(", ");
  useEffect(() => {
    setUserMenuOpen(false);
    setSelectedSupplierId(null);
    setSelectedShipmentId(null);
    setRemoteShipments([]);
  }, [organizationId]);

  const screen = useMemo(() => {
    if (!state) return null;
    if (activeTab === "suppliers") {
      return (
        <SuppliersScreen
          state={state}
          update={update}
          t={t}
          online={online && configured}
          shipments={remoteShipments}
          onShipmentsLoaded={setRemoteShipments}
          selectedSupplierId={selectedSupplierId}
          onSelectSupplier={setSelectedSupplierId}
          selectedShipmentId={selectedShipmentId}
          onSelectShipment={setSelectedShipmentId}
        />
      );
    }
    if (activeTab === "plots") {
      return (
        <PlotsScreen
          state={state}
          update={update}
          t={t}
          online={online && configured}
          organizationId={auth.session?.selectedOrganizationId ?? ""}
          selectedSupplierId={selectedSupplierId}
          shipments={remoteShipments}
          onShipmentsLoaded={setRemoteShipments}
          selectedShipmentId={selectedShipmentId}
          onSelectShipment={setSelectedShipmentId}
        />
      );
    }
    if (activeTab === "operations") {
      return <OperationsScreen state={state} update={update} t={t} online={online && configured} />;
    }
    if (activeTab === "help") return <Section title={t.help.title} description={t.help.body} />;
    return <HomeScreen state={state} t={t} />;
  }, [activeTab, state, t, update, auth.session?.selectedOrganizationId, online, configured, selectedSupplierId, selectedShipmentId, remoteShipments]);

  if (auth.activation) {
    return <ActivationScreen key={auth.activation.token ?? "activation-result"} controller={controller} />;
  }

  if (!auth.ready && !storageError && !auth.error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator style={styles.loader} size="large" color={palette.lime} />
      </SafeAreaView>
    );
  }

  if (!auth.ready) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" />
        <View style={styles.login}>
          <View style={styles.blocking}>
            <Ionicons name="warning" size={23} color={palette.red} />
            <Text style={styles.errorText}>{storageError ?? auth.error}</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (!auth.session) {
    return <LoginScreen controller={controller} />;
  }

  if (!auth.session.selectedOrganizationId) {
    return <OrganizationScreen controller={controller} />;
  }

  if (!state) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator style={styles.loader} size="large" color={palette.lime} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} onTouchStart={auth.recordActivity}>
      <StatusBar style="light" />
      <View style={[styles.header, compactLayout && styles.headerCompact]}>
        <View style={styles.logo}><Text style={styles.logoText}>SC</Text></View>
        <View style={[styles.flex, compactLayout && styles.headerBrandCompact]}>
          <Text style={styles.brand} numberOfLines={1}>Tracecomplaince</Text>
          <Text style={styles.headerSub} numberOfLines={1}>{t.brandSubtitle}</Text>
        </View>
        <View style={[styles.headerActions, compactLayout && styles.headerActionsCompact]}>
          <View style={[styles.connectivity, !configured && styles.connectivityBlocked]}>
            <View style={[styles.dot, !online && styles.dotOffline]} />
            <Text style={styles.connectivityText}>
              {!configured ? t.sync.notConfigured : online ? t.sync.online : t.sync.offline}
            </Text>
          </View>
          <Pressable
            style={styles.userButton}
            onPress={() => setUserMenuOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={roleLabel ? `${t.userAccount}: ${roleLabel}` : t.userAccount}
            accessibilityState={{ expanded: userMenuOpen }}
          >
            <View style={styles.userIconRow}>
              <Ionicons name="person-circle-outline" size={30} color="#FFFFFF" />
              <Ionicons name="chevron-down" size={12} color="#FFFFFF" />
            </View>
            {roleLabel ? <Text style={styles.userRole}>{roleLabel}</Text> : null}
          </Pressable>
        </View>
      </View>
      <View style={styles.syncBar}>
        <Text style={[styles.syncText, syncError && styles.errorText]} numberOfLines={2}>
          {syncing ? t.sync.syncing : syncError ?? `${state.outbox.length} ${t.sync.queued}`}
        </Text>
        <Button
          label={syncing ? t.sync.syncing : syncError ? t.common.retry : t.sync.syncNow}
          icon={syncError ? "refresh" : "cloud-upload"}
          onPress={() => void syncNow()}
          secondary
          disabled={syncing || !online || !configured}
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          compactLayout && styles.contentCompact,
          wideLayout && styles.contentWide,
        ]}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={auth.recordActivity}>
        {storageError || geofenceError || auth.error ? (
          <View style={styles.blocking}>
            <Ionicons name="warning" size={23} color={palette.red} />
            <View style={styles.flex}>
              {storageError ? <Text style={styles.errorText}>{storageError}</Text> : null}
              {geofenceError ? <Text style={styles.errorText}>{geofenceError}</Text> : null}
              {auth.error ? <Text style={styles.errorText}>{auth.error}</Text> : null}
            </View>
          </View>
        ) : null}
        {!configured ? (
          <View style={styles.blocking}>
            <Ionicons name="warning" size={23} color={palette.red} />
            <View style={styles.flex}>
              <Text style={styles.blockingTitle}>{t.sync.notConfigured}</Text>
              <Text style={styles.description}>{t.sync.notConfiguredDetail}</Text>
            </View>
          </View>
        ) : null}
        {state.conflicts.length > 0 ? (
          <Section title={t.sync.conflicts}>
            {state.conflicts.map((conflict) => (
              <ConflictCard key={conflict.id} conflict={conflict} resolve={resolveConflict} t={t} />
            ))}
          </Section>
        ) : null}
        {screen}
      </ScrollView>
      <View style={styles.tabs}>
        {([
          ["home", "home", t.tabs.home],
          ["suppliers", "people", t.tabs.suppliers],
          ["plots", "map", t.tabs.plots],
          ["operations", "briefcase", t.tabs.operations],
          ["help", "help-circle", t.tabs.help],
        ] as const).map(([tab, icon, label]) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: activeTab === tab }}
          >
            <Ionicons name={activeTab === tab ? icon : `${icon}-outline`} size={21} color={activeTab === tab ? palette.forest : palette.muted} />
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      <UserMenu
        controller={controller}
        visible={userMenuOpen}
        onClose={() => setUserMenuOpen(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, paddingTop: Platform.OS === "android" ? NativeStatusBar.currentHeight : 0, backgroundColor: palette.ink },
  loader: { flex: 1 },
  login: { flex: 1, justifyContent: "center", gap: 24, padding: 24, backgroundColor: palette.paper, width: "100%", maxWidth: 640, alignSelf: "center" },
  authContent: { flexGrow: 1, justifyContent: "center", gap: 24, padding: 24, backgroundColor: palette.paper, width: "100%", maxWidth: 640, alignSelf: "center" },
  loginBrand: { alignItems: "center", gap: 8 },
  loginTitle: { color: palette.ink, fontSize: 28, fontWeight: "900" },
  header: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 14, backgroundColor: palette.ink },
  headerCompact: { minHeight: 0, flexWrap: "wrap", rowGap: 5, paddingVertical: 8 },
  headerBrandCompact: { minWidth: 0 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 9 },
  headerActionsCompact: { width: "100%", justifyContent: "space-between" },
  logo: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: palette.lime },
  logoText: { color: palette.ink, fontWeight: "900" },
  brand: { color: "#FFFFFF", fontSize: 17, fontWeight: "800" },
  headerSub: { color: "#AFC0B7", fontSize: 11 },
  flex: { flex: 1 },
  connectivity: { maxWidth: 160, flexDirection: "row", alignItems: "center", gap: 5, padding: 7, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.1)" },
  connectivityBlocked: { backgroundColor: "rgba(166,69,54,0.35)" },
  connectivityText: { flexShrink: 1, color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.lime },
  dotOffline: { backgroundColor: palette.amber },
  userButton: { minWidth: 48, maxWidth: 110, minHeight: 48, alignItems: "center", justifyContent: "center", gap: 2, padding: 4, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.1)" },
  userIconRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  userRole: { color: "#FFFFFF", fontSize: 10, textAlign: "center" },
  dropdownTrigger: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 13, borderWidth: 1, borderColor: palette.line, borderRadius: 9, backgroundColor: "#FFFFFF" },
  dropdownOptions: { maxHeight: 260, marginTop: 4 },
  userMenuContent: { flexShrink: 1 },
  userMenuDialog: { maxHeight: "90%" },
  userIdentity: { alignItems: "center", gap: 6, marginBottom: 12 },
  syncBar: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, backgroundColor: palette.softGreen },
  syncText: { flex: 1, color: palette.forest, fontSize: 12, fontWeight: "700" },
  scroll: { flex: 1, backgroundColor: palette.paper },
  content: { gap: 13, padding: 16, paddingBottom: 28 },
  contentCompact: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 24 },
  contentWide: { width: "100%", maxWidth: 1000, alignSelf: "center" },
  section: { gap: 8, marginBottom: 3 },
  heading: { color: palette.ink, fontFamily: Platform.select({ ios: "Georgia", android: "serif" }), fontSize: 26, fontWeight: "700" },
  description: { color: palette.muted, fontSize: 13, lineHeight: 19 },
  hero: { gap: 12, padding: 21, borderRadius: 18, backgroundColor: palette.dark },
  heroTitle: { color: "#FFFFFF", fontSize: 25, fontWeight: "800" },
  heroBody: { color: "#D7E1DB", fontSize: 14, lineHeight: 21 },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  metric: { minWidth: 112, flex: 1, padding: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.09)" },
  metricValue: { color: palette.lime, fontSize: 21, fontWeight: "900" },
  metricLabel: { color: "#FFFFFF", fontSize: 11 },
  card: { gap: 10, padding: 16, borderWidth: 1, borderColor: palette.line, borderRadius: 14, backgroundColor: palette.panel },
  cardSelected: { borderColor: palette.forest, borderWidth: 2, backgroundColor: palette.softGreen },
  cardTitle: { color: palette.ink, fontSize: 16, fontWeight: "800" },
  itemTitle: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  caption: { color: palette.muted, fontSize: 11, lineHeight: 17 },
  documentRow: { gap: 8 },
  fieldLabel: { marginTop: 5, marginBottom: 5, color: palette.ink, fontSize: 12, fontWeight: "700" },
  documentChoice: { minHeight: 48, justifyContent: "center", padding: 10, borderWidth: 1, borderColor: palette.line, borderRadius: 8, backgroundColor: "#FFFFFF" },
  documentChoiceSelected: { borderColor: palette.forest, backgroundColor: palette.softGreen },
  fixBox: { gap: 4, padding: 10, borderWidth: 1, borderColor: palette.line, borderRadius: 9, backgroundColor: "#FFFFFF" },
  fixGood: { borderColor: palette.forest, backgroundColor: palette.softGreen },
  fixBad: { borderColor: palette.red, backgroundColor: palette.softRed },
  fixText: { color: palette.ink, fontSize: 12, fontWeight: "700", lineHeight: 17 },
  label: { marginBottom: 5, color: palette.ink, fontSize: 12, fontWeight: "700" },
  input: { minHeight: 48, paddingHorizontal: 12, borderWidth: 1, borderColor: palette.line, borderRadius: 9, color: palette.ink, backgroundColor: "#FFFFFF", fontSize: 16 },
  inputInvalid: { borderColor: palette.red, borderWidth: 2, backgroundColor: palette.softRed },
  textArea: { minHeight: 130, paddingTop: 10, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), textAlignVertical: "top" },
  button: { minWidth: 124, minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: palette.forest },
  buttonSecondary: { borderWidth: 1, borderColor: palette.forest, backgroundColor: "#FFFFFF" },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { flexShrink: 1, color: "#FFFFFF", fontSize: 12, fontWeight: "800", textAlign: "center" },
  buttonTextSecondary: { color: palette.forest },
  iconButton: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.forest,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconButtonRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowBetween: { minHeight: 48, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 9 },
  listRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: palette.line },
  listItemCard: {
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
  },
  empty: { padding: 18, color: palette.muted, fontSize: 12, textAlign: "center" },
  badge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: palette.softAmber },
  badgeGood: { backgroundColor: palette.softGreen },
  badgeBad: { backgroundColor: palette.softRed },
  badgeText: { color: "#83530C", fontSize: 10, fontWeight: "800" },
  goodText: { color: palette.forest },
  badText: { color: palette.red },
  blocking: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 14, borderWidth: 1, borderColor: palette.red, borderRadius: 12, backgroundColor: palette.softRed },
  blockingTitle: { color: palette.red, fontSize: 14, fontWeight: "900" },
  conflictCard: { gap: 8, padding: 13, borderWidth: 1, borderColor: palette.red, borderRadius: 10, backgroundColor: palette.softRed },
  errorText: { color: palette.red, fontSize: 12, fontWeight: "700" },
  mono: { color: palette.muted, fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }), fontSize: 10, lineHeight: 16 },
  tabs: { minHeight: 72, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingBottom: Platform.OS === "android" ? 6 : 8, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel },
  tab: { minHeight: 56, flex: 1, alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: 2, paddingVertical: 6 },
  tabText: { color: palette.muted, fontSize: 10, fontWeight: "600", textAlign: "center" },
  tabTextActive: { color: palette.forest, fontWeight: "900" },
  modal: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(10,25,18,0.65)" },
  dialog: { gap: 9, padding: 19, borderRadius: 16, backgroundColor: palette.panel },
  language: { minHeight: 48, justifyContent: "center", paddingHorizontal: 13, borderWidth: 1, borderColor: palette.line, borderRadius: 9 },
  checkbox: { minHeight: 48, justifyContent: "center", paddingVertical: 6 },
  languageActive: { borderColor: palette.forest, backgroundColor: palette.forest },
  languageText: { color: "#FFFFFF" },
});
