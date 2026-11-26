import { Camera, GeoJSONSource, Layer, Map } from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useState } from "react";
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
  useEffect(() => { setFailed(false); }, [offlineMapUri]);
  const outline = polygon?.coordinates[0].slice(0, -1) ?? positions;
  const track = trackPoints.map((point) => point.position);
  const points = [...outline, ...track];
  if (!points.length) return null;
  if (failed) return <Text>{unavailableLabel}</Text>;

  const west = Math.min(...points.map(([longitude]) => longitude));
  const east = Math.max(...points.map(([longitude]) => longitude));
  const south = Math.min(...points.map(([, latitude]) => latitude));
  const north = Math.max(...points.map(([, latitude]) => latitude));
  const bounds: [number, number, number, number] = [
    west - 0.002, south - 0.002, east + 0.002, north + 0.002,
  ];

  return (
    <View>
      <Map
        style={{ height: 320 }}
        mapStyle={mapStyle}
        attribution={false}
        logo={false}
        onDidFailLoadingMap={() => setFailed(true)}
      >
        <Camera bounds={bounds} padding={{ top: 32, right: 32, bottom: 32, left: 32 }} duration={300} />
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
        {outline.length ? (
          <GeoJSONSource id="boundary-points" data={{ type: "MultiPoint", coordinates: outline }}>
            <Layer id="boundary-vertices" type="circle" paint={{
              "circle-color": "#f0ac35", "circle-radius": 5, "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5,
            }} />
          </GeoJSONSource>
        ) : null}
      </Map>
      {offlineMapUri ? <Text>© OpenStreetMap contributors (ODbL) · Geofabrik</Text> : null}
    </View>
  );
}
