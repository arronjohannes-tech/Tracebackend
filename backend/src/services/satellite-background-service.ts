import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { AppError, badRequest } from "../errors.js";
import { withContext } from "../db.js";
import { ProcessApiError, type Bbox } from "../copernicus/process-client.js";
import { createObjectStore, type ObjectStore } from "../infrastructure/object-store.js";
import type { AuthContext } from "../types.js";
import { createCopernicusService, type BackgroundImage, type CopernicusService } from "./copernicus-service.js";

// One Process API request covers at most roughly 11 km; larger selections fall back to the plain map.
export const MAX_BACKGROUND_SPAN_DEG = 0.1;
export const MIN_BACKGROUND_SPAN_DEG = 0.0001;
const CACHE_WEEK_MS = 7 * 86_400_000;

export const backgroundQuerySchema = z.object({
    bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/, "bbox must be west,south,east,north."),
    size: z.coerce.number().refine((value) => [256, 512, 1024, 2048].includes(value),
        "size must be 256, 512, 1024 or 2048.").default(1024),
});

// Snapping to 5 decimals (about one metre) lets identical map views share one cached image.
const snap = (value: number) => Math.round(value * 1e5) / 1e5;

export function parseBackgroundBbox(raw: string): Bbox {
    const [west, south, east, north] = raw.split(",").map((part) => snap(Number(part))) as Bbox;
    if (![west, south, east, north].every(Number.isFinite)
        || west < -180 || east > 180 || south < -85 || north > 85 || west >= east || south >= north) {
        throw badRequest("INVALID_BBOX", "The bounding box is not valid.");
    }
    const width = east - west;
    const height = north - south;
    if (Math.max(width, height) > MAX_BACKGROUND_SPAN_DEG) {
        throw badRequest("BBOX_TOO_LARGE", "The requested area is too large for a satellite background.");
    }
    if (Math.max(width, height) < MIN_BACKGROUND_SPAN_DEG) {
        throw badRequest("BBOX_TOO_SMALL", "The requested area is too small for a satellite background.");
    }
    return [west, south, east, north];
}

export function createSatelliteBackgroundService(
    pool: Pool,
    config: AppConfig,
    copernicus: CopernicusService = createCopernicusService(pool, config),
    openStore: () => ObjectStore = () => createObjectStore(config),
    now: () => Date = () => new Date(),
) {
    const inFlight = new Map<string, Promise<BackgroundImage>>();
    // The cache is an optimisation only: a missing or failing object store must never block the image.
    const store = (): ObjectStore | null => {
        try {
            return openStore();
        } catch {
            return null;
        }
    };

    async function fetchImage(auth: AuthContext, organizationId: string, bbox: Bbox, size: number, key: string) {
        const cache = store();
        if (cache) {
            try {
                return JSON.parse((await cache.get(key)).toString("utf8")) as BackgroundImage;
            } catch {
                // not cached yet
            }
        }
        const runtime = await withContext(pool, auth, (client) => copernicus.loadRuntime(client, organizationId));
        if (!runtime) {
            throw new AppError(409, "SATELLITE_NOT_CONFIGURED",
                "Satellite imagery is not configured for this organization.");
        }
        let image: BackgroundImage;
        try {
            image = await copernicus.backgroundImage(runtime, bbox, now(), size);
        } catch (error) {
            if (error instanceof ProcessApiError) {
                throw new AppError(502, "SATELLITE_UNAVAILABLE", error.message);
            }
            throw error;
        }
        if (cache) {
            try {
                await cache.put(key, Buffer.from(JSON.stringify(image), "utf8"));
            } catch {
                // ignore: the next request fetches the image again
            }
        }
        return image;
    }

    return {
        async get(auth: AuthContext, organizationId: string, bbox: Bbox, size = 1024): Promise<BackgroundImage> {
            const week = Math.floor(now().getTime() / CACHE_WEEK_MS);
            const key = `satellite-background/${organizationId}/${week}/${size}/${bbox.map((value) => value.toFixed(5)).join("_")}.json`;
            const pending = inFlight.get(key);
            if (pending) return pending;
            const request = fetchImage(auth, organizationId, bbox, size, key);
            inFlight.set(key, request);
            try {
                return await request;
            } finally {
                inFlight.delete(key);
            }
        },
    };
}
