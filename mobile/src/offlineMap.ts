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
      { id: "boundaries", type: "line", source: "ethiopia", "source-layer": "boundaries", paint: { "line-color": "#b49aaf", "line-width": 1 } },
      { id: "buildings", type: "fill", source: "ethiopia", "source-layer": "buildings", paint: { "fill-color": "#d1c9b8" } },
      { id: "roads", type: "line", source: "ethiopia", "source-layer": "streets", paint: {
        "line-color": ["match", ["get", "kind"], "motorway", "#db8b79", ["trunk", "primary", "secondary"], "#e9c182", "#b8b2a7"],
        "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 14, 2.5],
      } },
      { id: "road-labels", type: "symbol", source: "ethiopia", "source-layer": "street_labels", minzoom: 12, layout: {
        "symbol-placement": "line", "text-field": ["get", "name"], "text-font": ["Astertrace Noto"], "text-size": 11,
      }, paint: { "text-color": "#62594c", "text-halo-color": "#ffffff", "text-halo-width": 1 } },
      { id: "places", type: "symbol", source: "ethiopia", "source-layer": "place_labels", layout: {
        "text-field": ["get", "name"], "text-font": ["Astertrace Noto"], "text-size": 14,
      }, paint: { "text-color": "#263b32", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } },
    );
  }
  return {
    version: 8, sources, layers,
    "font-faces": {
      "Astertrace Noto": [
        { url: "asset://mapfonts/NotoSansEthiopic-Regular.ttf", "unicode-range": ["U+1200-139F", "U+2D80-2DDF", "U+AB00-AB2F"] },
        { url: "asset://mapfonts/NotoSans-Regular.ttf", "unicode-range": ["U+0000-024F", "U+1E00-1EFF", "U+2000-206F"] },
      ],
    },
  };
}

export function isSqliteHeader(header: string): boolean {
  return header === "U1FMaXRlIGZvcm1hdCAzAA==";
}
