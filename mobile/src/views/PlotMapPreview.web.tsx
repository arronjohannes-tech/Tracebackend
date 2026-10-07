import type { GeoJsonPolygon, GpsTrackPoint, Position } from "../domain";

export default function PlotMapPreview({
  positions,
  trackPoints,
  polygon,
  unavailableLabel,
}: {
  positions: Position[];
  trackPoints: GpsTrackPoint[];
  polygon: GeoJsonPolygon | null;
  unavailableLabel: string;
}) {
  if (!positions.length && !trackPoints.length && !polygon) return null;
  return <p>{unavailableLabel}</p>;
}
