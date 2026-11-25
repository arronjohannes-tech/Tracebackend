import type { GeoJsonPolygon, GpsTrackPoint, Position } from "./domain";

type MapFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "Point"; coordinates: Position } | { type: "LineString"; coordinates: Position[] };
};

export function organicMapGeoJson(polygon: GeoJsonPolygon | null, trackPoints: GpsTrackPoint[]) {
  const features: MapFeature[] = [];
  for (const ring of polygon?.coordinates ?? []) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } });
  }
  const positions = trackPoints.map(({ position }) => position);
  if (positions.length === 1) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: positions[0] } });
  } else if (positions.length > 1) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: positions } });
  }
  return { type: "FeatureCollection" as const, features };
}
