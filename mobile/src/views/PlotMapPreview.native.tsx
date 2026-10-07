import MapView, { Circle, Marker, Polygon, Polyline } from "react-native-maps";
import type { GeoJsonPolygon, GpsTrackPoint, Position } from "../domain";

export default function PlotMapPreview({
  positions,
  trackPoints,
  polygon,
  unavailableLabel: _unavailableLabel,
}: {
  positions: Position[];
  trackPoints: GpsTrackPoint[];
  polygon: GeoJsonPolygon | null;
  unavailableLabel?: string;
}) {
  const outline = polygon?.coordinates[0].slice(0, -1) ?? positions;
  const allPositions = outline.length ? outline : trackPoints.map((point) => point.position);
  if (!allPositions.length) return null;
  const longitudes = allPositions.map(([longitude]) => longitude);
  const latitudes = allPositions.map(([, latitude]) => latitude);
  const longitudeSpan = Math.max(...longitudes) - Math.min(...longitudes);
  const latitudeSpan = Math.max(...latitudes) - Math.min(...latitudes);

  return (
    <MapView
      style={{ height: 240, borderRadius: 12, overflow: "hidden" }}
      initialRegion={{
        latitude: (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
        longitude: (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
        latitudeDelta: Math.max(latitudeSpan * 1.8, 0.004),
        longitudeDelta: Math.max(longitudeSpan * 1.8, 0.004),
      }}
      mapType="standard"
      showsCompass
      toolbarEnabled={false}
    >
      {trackPoints.length > 1 ? (
        <Polyline
          coordinates={trackPoints.map(({ position }) => ({
            latitude: position[1],
            longitude: position[0],
          }))}
          strokeColor="#1F5A43"
          strokeWidth={3}
        />
      ) : null}
      {polygon ? (
        <Polygon
          coordinates={polygon.coordinates[0].map(([longitude, latitude]) => ({
            latitude,
            longitude,
          }))}
          fillColor="rgba(202,219,132,0.35)"
          strokeColor="#1F5A43"
          strokeWidth={2}
        />
      ) : null}
      {trackPoints.map(({ position, accuracyM, capturedAt }, index) => (
        <Circle
          key={`${capturedAt}-${index}`}
          center={{ latitude: position[1], longitude: position[0] }}
          radius={Math.max(accuracyM ?? 0, 2)}
          fillColor="rgba(31,90,67,0.12)"
          strokeColor="rgba(31,90,67,0.45)"
          strokeWidth={1}
        />
      ))}
      {trackPoints.length > 1 ? (
        <>
          <Marker
            coordinate={{
              latitude: trackPoints[0].position[1],
              longitude: trackPoints[0].position[0],
            }}
            title="Start"
          />
          <Marker
            coordinate={{
              latitude: trackPoints[trackPoints.length - 1].position[1],
              longitude: trackPoints[trackPoints.length - 1].position[0],
            }}
            title="End"
            pinColor="#A64536"
          />
        </>
      ) : trackPoints.length === 1 ? (
        <Marker
          coordinate={{
            latitude: trackPoints[0].position[1],
            longitude: trackPoints[0].position[0],
          }}
        />
      ) : null}
    </MapView>
  );
}
