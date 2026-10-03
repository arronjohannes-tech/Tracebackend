import { createHash } from "node:crypto";
import type { GeoJsonPolygon } from "../types.js";
import { isAllowedHost, type OutputFormat, type ProcessSettings } from "./process-settings.js";

export const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
const MAX_RESPONSE_BYTES = 30 * 1024 * 1024;
const TOKEN_SAFETY_MARGIN_MS = 30_000;

export class ProcessApiError extends Error {
  constructor(
    readonly stage: "token" | "process",
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProcessApiError";
  }
}

export type ProcessCredentials = { clientId: string; clientSecret: string };
export type ProcessResult = { bytes: Buffer; contentType: string };
export type Bbox = [number, number, number, number];

export function polygonBbox(polygon: GeoJsonPolygon): Bbox {
  const ring = polygon.coordinates[0] ?? [];
  const lons = ring.map((position) => position[0]!);
  const lats = ring.map((position) => position[1]!);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

// The Process API needs width and height; derive the shorter side from the bbox aspect ratio.
export function outputSize(bbox: Bbox, longestSide: number): { width: number; height: number } {
  const midLatitude = ((bbox[1] + bbox[3]) / 2) * (Math.PI / 180);
  const dx = Math.max((bbox[2] - bbox[0]) * Math.cos(midLatitude), 1e-9);
  const dy = Math.max(bbox[3] - bbox[1], 1e-9);
  const clamp = (value: number) => Math.min(2500, Math.max(1, Math.round(value)));
  return dx >= dy
    ? { width: clamp(longestSide), height: clamp(longestSide * (dy / dx)) }
    : { width: clamp(longestSide * (dx / dy)), height: clamp(longestSide) };
}

export function buildEvalscript(settings: ProcessSettings): string {
  if (settings.preset === "custom") return settings.evalscript;
  const jpeg = settings.output.format === "image/jpeg";
  if (settings.preset === "sar_vv") {
    return `//VERSION=3
function setup() {
  return { input: ["VV", "dataMask"], output: { bands: ${jpeg ? 1 : 2} } };
}
function evaluatePixel(sample) {
  // Backscatter in dB mapped from -25..0 dB to 0..1
  const db = 10 * Math.log10(Math.max(sample.VV, 1e-6));
  const value = Math.min(1, Math.max(0, (db + 25) / 25));
  return [value${jpeg ? "" : ", sample.dataMask"}];
}
`;
  }
  if (settings.preset === "ndvi") {
    return `//VERSION=3
function setup() {
  return { input: ["B04", "B08", "dataMask"], output: { bands: ${jpeg ? 3 : 4} } };
}
function evaluatePixel(sample) {
  const sum = sample.B08 + sample.B04;
  const ndvi = sum === 0 ? 0 : (sample.B08 - sample.B04) / sum;
  let rgb;
  if (ndvi < 0) rgb = [0.75, 0.75, 0.75];
  else if (ndvi < 0.2) rgb = [0.85, 0.75, 0.5];
  else if (ndvi < 0.4) rgb = [0.7, 0.8, 0.4];
  else if (ndvi < 0.6) rgb = [0.35, 0.7, 0.25];
  else rgb = [0.05, 0.45, 0.1];
  return [rgb[0], rgb[1], rgb[2]${jpeg ? "" : ", sample.dataMask"}];
}
`;
  }
  return `//VERSION=3
function setup() {
  return { input: ["B04", "B03", "B02", "dataMask"], output: { bands: ${jpeg ? 3 : 4} } };
}
function evaluatePixel(sample) {
  const gain = 2.5;
  return [gain * sample.B04, gain * sample.B03, gain * sample.B02${jpeg ? "" : ", sample.dataMask"}];
}
`;
}

function dataEntry(settings: ProcessSettings, timeRange: { from: string; to: string }) {
  if (settings.dataset === "sentinel-1-grd") {
    const filter = settings.s1Filter;
    const processing = settings.s1;
    return {
      type: settings.dataset,
      dataFilter: {
        timeRange,
        mosaickingOrder: settings.mosaickingOrder === "leastRecent" ? "leastRecent" : "mostRecent",
        ...(filter.acquisitionMode ? { acquisitionMode: filter.acquisitionMode } : {}),
        ...(filter.polarization ? { polarization: filter.polarization } : {}),
        ...(filter.orbitDirection ? { orbitDirection: filter.orbitDirection } : {}),
        ...(filter.resolution ? { resolution: filter.resolution } : {}),
      },
      processing: {
        speckleFilter: processing.speckleFilter,
        backCoeff: processing.backCoeff,
        orthorectify: processing.orthorectify,
        ...(processing.orthorectify
          ? {
            demInstance: processing.demInstance,
            radiometricTerrainOversampling: processing.radiometricTerrainOversampling,
          }
          : {}),
        upsampling: processing.upsampling,
        downsampling: processing.downsampling,
      },
    };
  }
  return {
    type: settings.dataset,
    dataFilter: {
      timeRange,
      mosaickingOrder: settings.mosaickingOrder,
      maxCloudCoverage: settings.maxCloudCoverage,
    },
    processing: {
      harmonizeValues: settings.s2.harmonizeValues,
      upsampling: settings.s2.upsampling,
      downsampling: settings.s2.downsampling,
    },
  };
}

export function buildProcessRequest(
  settings: ProcessSettings,
  polygon: GeoJsonPolygon,
  now: Date = new Date(),
  overrideLongestSide?: number,
) {
  const timeRange = {
    from: new Date(now.getTime() - settings.lookbackDays * 86_400_000).toISOString(),
    to: now.toISOString(),
  };
  const bbox = polygonBbox(polygon);
  const size = outputSize(bbox, overrideLongestSide ?? settings.output.width);
  const format = settings.output.format === "image/jpeg"
    ? { type: "image/jpeg", quality: settings.output.jpegQuality }
    : { type: settings.output.format };
  return {
    input: {
      bounds: {
        bbox,
        geometry: { type: "Polygon", coordinates: polygon.coordinates },
        properties: { crs: CRS84 },
      },
      data: [dataEntry(settings, timeRange)],
    },
    output: { ...size, responses: [{ identifier: "default", format }] },
    evalscript: buildEvalscript(settings),
  };
}

export const extensionFor = (format: OutputFormat): string =>
  format === "image/jpeg" ? "jpg" : format === "image/tiff" ? "tif" : "png";

async function describeFailure(response: Response): Promise<string> {
  const text = (await response.text().catch(() => "")).slice(0, 2000);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string }; error_description?: string; message?: string };
    const detail = parsed.error?.message ?? parsed.error_description ?? parsed.message;
    if (detail) return String(detail).slice(0, 300);
  } catch {
    // not JSON; fall through to the status text
  }
  return response.statusText || "no details";
}

type TokenEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

export function clearTokenCache(): void {
  tokenCache.clear();
}

export function createProcessClient(options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const fetchImplementation = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  async function send(
    stage: "token" | "process",
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    if (!isAllowedHost(url)) {
      throw new ProcessApiError(stage, "The configured URL is not an allowed Copernicus host.");
    }
    try {
      return await fetchImplementation(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new ProcessApiError(
        stage,
        timedOut ? `The ${stage} request timed out after ${timeoutMs} ms.` : `The ${stage} request could not be sent.`,
        undefined,
        { cause: error },
      );
    }
  }

  async function getToken(
    settings: Pick<ProcessSettings, "tokenUrl" | "timeoutMs">,
    credentials: ProcessCredentials,
    forceRefresh = false,
  ): Promise<string> {
    const key = createHash("sha256")
      .update(`${settings.tokenUrl}\n${credentials.clientId}\n${credentials.clientSecret}`)
      .digest("hex");
    const cached = tokenCache.get(key);
    if (!forceRefresh && cached && cached.expiresAt > now()) return cached.token;
    const response = await send("token", settings.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
      }).toString(),
    }, settings.timeoutMs);
    if (!response.ok) {
      throw new ProcessApiError(
        "token",
        `Authentication failed (HTTP ${response.status}): ${await describeFailure(response)}`,
        response.status,
      );
    }
    const body = await response.json().catch(() => null) as { access_token?: unknown; expires_in?: unknown } | null;
    if (typeof body?.access_token !== "string" || !body.access_token) {
      throw new ProcessApiError("token", "The token response did not contain an access token.");
    }
    const lifetimeMs = (typeof body.expires_in === "number" ? body.expires_in : 300) * 1000;
    tokenCache.set(key, {
      token: body.access_token,
      expiresAt: now() + Math.max(lifetimeMs - TOKEN_SAFETY_MARGIN_MS, 0),
    });
    return body.access_token;
  }

  async function callProcess(
    settings: ProcessSettings,
    token: string,
    body: unknown,
    accept: string,
  ): Promise<Response> {
    return send("process", `${settings.baseUrl.replace(/\/+$/, "")}/process/v1`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: accept,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }, settings.timeoutMs);
  }

  async function process(
    settings: ProcessSettings,
    credentials: ProcessCredentials,
    body: unknown,
    accept: string = settings.output.format,
  ): Promise<ProcessResult> {
    let response = await callProcess(settings, await getToken(settings, credentials), body, accept);
    if (response.status === 401) {
      response = await callProcess(settings, await getToken(settings, credentials, true), body, accept);
    }
    if (!response.ok) {
      throw new ProcessApiError(
        "process",
        `Process API returned HTTP ${response.status}: ${await describeFailure(response)}`,
        response.status,
      );
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_RESPONSE_BYTES) {
      throw new ProcessApiError("process", "The Process API response is too large.");
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_RESPONSE_BYTES) {
      throw new ProcessApiError("process", "The Process API returned an empty or oversized response.");
    }
    return { bytes, contentType: response.headers.get("content-type")?.split(";")[0]?.trim() || accept };
  }

  return { getToken, process };
}

export type ProcessClient = ReturnType<typeof createProcessClient>;
