import assert from "node:assert/strict";
import test from "node:test";
import { organicMapGeoJson } from "./organicMap";
import type { GeoJsonPolygon, GpsTrackPoint } from "./domain";

const point = (longitude: number, latitude: number): GpsTrackPoint => ({
  position: [longitude, latitude], accuracyM: null, capturedAt: "2026-01-01T00:00:00.000Z",
});

test("exports polygon boundaries including holes and GPS tracks as GeoJSON lines", () => {
  const polygon: GeoJsonPolygon = {
    type: "Polygon",
    coordinates: [
      [[1, 2], [3, 2], [3, 4], [1, 2]],
      [[2, 2.5], [2.5, 2.5], [2.5, 3], [2, 2.5]],
    ],
  };
  const result = organicMapGeoJson(polygon, [point(1, 2), point(3, 4)]);
  assert.deepEqual(result.features.map((feature) => feature.geometry), [
    { type: "LineString", coordinates: polygon.coordinates[0] },
    { type: "LineString", coordinates: polygon.coordinates[1] },
    { type: "LineString", coordinates: [[1, 2], [3, 4]] },
  ]);
});

test("exports a single GPS fix as a point and no features without data", () => {
  assert.deepEqual(organicMapGeoJson(null, [point(38, 9)]).features[0].geometry,
    { type: "Point", coordinates: [38, 9] });
  assert.deepEqual(organicMapGeoJson(null, []).features, []);
});
