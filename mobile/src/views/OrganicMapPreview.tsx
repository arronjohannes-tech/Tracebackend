import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { GeoJsonPolygon, GpsTrackPoint } from "../domain";
import { createUuid } from "../domain";
import type { Translation } from "../i18n";
import { organicMapGeoJson } from "../organicMap";

export default function OrganicMapPreview({
  polygon,
  trackPoints,
  t,
}: {
  polygon: GeoJsonPolygon | null;
  trackPoints: GpsTrackPoint[];
  t: Translation;
}) {
  const [busy, setBusy] = useState(false);
  if (!polygon && !trackPoints.length) return null;

  async function openMap() {
    if (busy) return;
    setBusy(true);
    try {
      if (!await Linking.canOpenURL("om://map")) {
        Alert.alert(t.plots.organicMapInstallTitle, t.plots.organicMapInstallDetail, [
          { text: t.plots.cancel, style: "cancel" },
          {
            text: t.plots.organicMapInstallAction,
            onPress: () => {
              void Linking.openURL("https://play.google.com/store/apps/details?id=app.organicmaps")
                .catch((error: unknown) => Alert.alert(t.plots.organicMapError, String(error)));
            },
          },
        ]);
        return;
      }
      if (!FileSystem.cacheDirectory || !await Sharing.isAvailableAsync()) {
        throw new Error(t.plots.organicMapError);
      }
      const uri = `${FileSystem.cacheDirectory}astertrace-${createUuid()}.geojson`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(organicMapGeoJson(polygon, trackPoints)));
      await Sharing.shareAsync(uri, {
        mimeType: "application/geo+json",
        dialogTitle: t.plots.organicMapChoose,
      });
    } catch (error) {
      Alert.alert(t.plots.organicMapError, error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.description}>{t.plots.organicMapDetail}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => void openMap()}
        style={[styles.button, busy && styles.disabled]}
      >
        <Text style={styles.buttonText}>{t.plots.organicMapOpen}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, padding: 14, borderRadius: 12, backgroundColor: "#FFFEFA" },
  description: { color: "#14251D", fontSize: 13 },
  button: { minHeight: 48, justifyContent: "center", alignItems: "center", padding: 10, borderWidth: 1, borderColor: "#1F5A43", borderRadius: 9 },
  buttonText: { color: "#1F5A43", fontSize: 13, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.5 },
});
