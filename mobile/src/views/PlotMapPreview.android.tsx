import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { GeoJsonPolygon, GpsTrackPoint, Position } from "../domain";
import { offlineMapStyle } from "../offlineMap";

export default function PlotMapPreview({
  positions,
  trackPoints,
  polygon,
  unavailableLabel,
  offlineMapUri,
}: {
  positions: Position[];
  trackPoints: GpsTrackPoint[];
  polygon: GeoJsonPolygon | null;
  unavailableLabel: string;
  offlineMapUri?: string | null;
}) {
  const [failed, setFailed] = useState(false);
  const mapStyle = useMemo(() => offlineMapStyle(offlineMapUri ?? null), [offlineMapUri]);
  const outline = polygon?.coordinates[0].slice(0, -1) ?? positions;
  const points = outline.length ? outline : trackPoints.map((point) => point.position);
  if (!points.length) return null;
  if (failed) return <Text>{unavailableLabel}</Text>;

  const west = Math.min(...points.map(([longitude]) => longitude));
  const east = Math.max(...points.map(([longitude]) => longitude));
  const south = Math.min(...points.map(([, latitude]) => latitude));
  const north = Math.max(...points.map(([, latitude]) => latitude));
  const bounds: [number, number, number, number] = [
    west - 0.002, south - 0.002, east + 0.002, north + 0.002,
  ];
  const track = trackPoints.map((point) => point.position);

  return (
    <View>
      <Map
        style={{ height: 240 }}
        mapStyle={mapStyle}
        attribution={false}
        logo={false}
        onDidFailLoadingMap={() => setFailed(true)}
      >
        <Camera initialViewState={{ bounds, padding: { top: 20, right: 20, bottom: 20, left: 20 } }} />
        {polygon ? (
          <GeoJSONSource id="plot" data={polygon}>
            <Layer id="plot-fill" type="fill" paint={{ "fill-color": "#cadb84", "fill-opacity": 0.35 }} />
            <Layer id="plot-outline" type="line" paint={{ "line-color": "#1f5a43", "line-width": 2 }} />
          </GeoJSONSource>
        ) : null}
        {track.length > 1 ? (
          <GeoJSONSource id="track" data={{ type: "LineString", coordinates: track }}>
            <Layer id="track-line" type="line" paint={{ "line-color": "#1f5a43", "line-width": 3 }} />
          </GeoJSONSource>
        ) : null}
        {track.length ? (
          <GeoJSONSource id="points" data={{ type: "MultiPoint", coordinates: track }}>
            <Layer id="track-points" type="circle" paint={{ "circle-color": "#1f5a43", "circle-radius": 4 }} />
          </GeoJSONSource>
        ) : null}
      </Map>
      {offlineMapUri ? <Text>© OpenStreetMap contributors (ODbL) · Geofabrik</Text> : null}
    </View>
  );
}
