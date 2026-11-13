export type Position = number[];
export type TrackPointLike = { position: Position; accuracyM: number | null; capturedAt: string };

// PostGIS writes GeoJSON with nine decimals; anything closer than this counts as the same coordinate.
const SAME_POSITION_TOLERANCE_DEG = 1e-8;
export const MAX_RING_POSITIONS = 501;

const samePosition = (left: number[], right: number[]) =>
    Math.abs(left[0]! - right[0]!) <= SAME_POSITION_TOLERANCE_DEG
    && Math.abs(left[1]! - right[1]!) <= SAME_POSITION_TOLERANCE_DEG;

/**
 * The mobile app derives the polygon from its GPS track points, so a moved polygon vertex must move the
 * matching track point as well; otherwise the next mobile edit would rebuild the old outline.
 * Track points that do not line up one-to-one with the polygon vertices stay untouched.
 */
export function alignTrackPoints<T extends TrackPointLike>(
    oldRing: number[][],
    newRing: number[][],
    trackPoints: T[],
): T[] {
    if (newRing.length !== oldRing.length || trackPoints.length !== oldRing.length - 1) return trackPoints;
    const lineUp = trackPoints.every((point, index) => samePosition(point.position, oldRing[index]!));
    if (!lineUp) return trackPoints;
    return trackPoints.map((point, index) => ({
        ...point,
        position: [newRing[index]![0]!, newRing[index]![1]!],
    }));
}
