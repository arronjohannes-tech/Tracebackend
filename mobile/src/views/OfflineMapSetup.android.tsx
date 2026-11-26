import * as FileSystem from "expo-file-system/legacy";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import type { Translation } from "../i18n";
import { isSqliteHeader } from "../offlineMap";

const MAP_URL = "https://download.geofabrik.de/africa/ethiopia-shortbread-1.0.mbtiles";
const MIN_MAP_BYTES = 50 * 1024 * 1024;
let activeDownload: Promise<void> | null = null;
let downloadProgress: number | null = null;
const progressListeners = new Set<(value: number | null) => void>();

async function validMap(uri: string) {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory || info.size < MIN_MAP_BYTES) return false;
  const header = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 16,
  });
  return isSqliteHeader(header);
}

function downloadMap(mapUri: string, errorMessage: string) {
  if (activeDownload) return activeDownload;
  const temporaryUri = `${mapUri}.download`;
  downloadProgress = null;
  activeDownload = (async () => {
    try {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      const task = FileSystem.createDownloadResumable(MAP_URL, temporaryUri, {}, (event) => {
        if (event.totalBytesExpectedToWrite > 0) {
          downloadProgress = Math.floor(event.totalBytesWritten / event.totalBytesExpectedToWrite * 100);
          progressListeners.forEach((listener) => listener(downloadProgress));
        }
      });
      const result = await task.downloadAsync();
      if (!result || result.status !== 200 || !await validMap(temporaryUri)) {
        throw new Error(errorMessage);
      }
      const info = await FileSystem.getInfoAsync(temporaryUri);
      const lengthHeader = Object.entries(result.headers).find(([name]) => name.toLowerCase() === "content-length")?.[1];
      const length = lengthHeader ? Number(lengthHeader) : null;
      if (!info.exists || (length !== null && Number.isFinite(length) && length > 0 && info.size !== length)) {
        throw new Error(errorMessage);
      }
      const existing = await FileSystem.getInfoAsync(mapUri);
      if (existing.exists) {
        if (await validMap(mapUri)) throw new Error("Offline map already exists.");
        await FileSystem.deleteAsync(mapUri);
      }
      await FileSystem.moveAsync({ from: temporaryUri, to: mapUri });
    } catch (reason) {
      try {
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      } catch (cleanupError) {
        const cause = reason instanceof Error ? reason.message : String(reason);
        const cleanup = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`${cause}; ${cleanup}`);
      }
      throw reason;
    } finally {
      activeDownload = null;
    }
  })();
  return activeDownload;
}

export default function OfflineMapSetup({
  t,
  onMapChange,
  offerDownload = false,
}: {
  t: Translation;
  onMapChange: (uri: string | null) => void;
  offerDownload?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = FileSystem.documentDirectory;
  const mapUri = base ? `${base}ethiopia-shortbread.mbtiles` : null;

  useEffect(() => {
    let active = true;
    if (!mapUri) {
      setError(t.plots.offlineMapError);
      return;
    }
    progressListeners.add(setProgress);
    if (activeDownload) {
      setDownloading(true);
      setProgress(downloadProgress);
    }
    const pending = activeDownload ?? Promise.resolve();
    void pending.then(() => validMap(mapUri)).then((valid) => {
      if (!active) return;
      setReady(valid);
      onMapChange(valid ? mapUri : null);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (active) setDownloading(false);
    });
    return () => {
      active = false;
      progressListeners.delete(setProgress);
    };
  }, [mapUri, onMapChange, t.plots.offlineMapError]);

  async function download() {
    if (!mapUri || downloading) return;
    setDownloading(true);
    setProgress(null);
    setError(null);
    try {
      await downloadMap(mapUri, t.plots.offlineMapError);
      setReady(true);
      onMapChange(mapUri);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setDownloading(false);
    }
  }

  function remove() {
    if (!mapUri) return;
    Alert.alert(t.plots.offlineMapRemove, t.plots.offlineMapRemoveConfirm, [
      { text: t.plots.cancel, style: "cancel" },
      {
        text: t.plots.offlineMapRemove,
        style: "destructive",
        onPress: () => {
          void FileSystem.deleteAsync(mapUri).then(() => {
            setReady(false);
            onMapChange(null);
          }).catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : String(reason));
          });
        },
      },
    ]);
  }

  if (!offerDownload && !ready && !error && !downloading) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.description}>{ready ? t.plots.offlineMapReady : t.plots.offlineMapInfo}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: downloading }}
        disabled={downloading}
        onPress={ready ? remove : () => Alert.alert(t.plots.offlineMapDownload, t.plots.offlineMapInfo, [
          { text: t.plots.cancel, style: "cancel" },
          { text: t.plots.offlineMapDownload, onPress: () => void download() },
        ])}
        style={[styles.button, downloading && styles.disabled]}
      >
        <Text style={styles.buttonText}>
          {downloading
            ? `${t.plots.offlineMapDownloading}${progress === null ? "" : ` ${progress}%`}`
            : ready ? t.plots.offlineMapRemove : t.plots.offlineMapDownload}
        </Text>
      </Pressable>
      {error ? <Text style={styles.error}>{t.plots.offlineMapError}: {error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: "#FFFEFA" },
  description: { color: "#14251D", fontSize: 13 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", padding: 10, borderWidth: 1, borderColor: "#1F5A43", borderRadius: 9 },
  buttonText: { color: "#1F5A43", fontSize: 13, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.5 },
  error: { color: "#A64536", fontSize: 12 },
});
