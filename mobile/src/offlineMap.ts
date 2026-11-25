import type { MapProps } from "@maplibre/maplibre-react-native";

type MapStyle = Exclude<MapProps["mapStyle"], string>;

export function offlineMapStyle(uri: string | null): MapStyle {
  const sources: MapStyle["sources"] = {};
  const layers: MapStyle["layers"] = [
    { id: "background", type: "background", paint: { "background-color": "#f4f2ea" } },
  ];
  if (uri) {
    if (!uri.startsWith("file:///")) throw new Error("Offline map must be a local file.");
    sources.ethiopia = { type: "vector", url: `mbtiles://${uri.slice("file://".length)}` };
    layers.push(
      { id: "land", type: "fill", source: "ethiopia", "source-layer": "land", paint: { "fill-color": "#e6eadb" } },
      { id: "water", type: "fill", source: "ethiopia", "source-layer": "water_polygons", paint: { "fill-color": "#a9cfdb" } },
      { id: "buildings", type: "fill", source: "ethiopia", "source-layer": "buildings", paint: { "fill-color": "#d1c9b8" } },
      { id: "roads", type: "line", source: "ethiopia", "source-layer": "streets", paint: { "line-color": "#b2aa9b", "line-width": 1.5 } },
    );
  }
  return { version: 8, sources, layers };
}

export function isSqliteHeader(header: string): boolean {
  return header === "U1FMaXRlIGZvcm1hdCAzAA==";
}
