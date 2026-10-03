import { z } from "zod";

export const DEFAULT_BASE_URL = "https://sh.dataspace.copernicus.eu";
export const DEFAULT_TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";

// Only Copernicus Data Space and Sentinel Hub hosts may be called with the stored credentials.
export const ALLOWED_HOST_SUFFIXES = [".dataspace.copernicus.eu", ".sentinel-hub.com"] as const;

export const datasets = ["sentinel-2-l2a", "sentinel-2-l1c", "sentinel-1-grd"] as const;
export const presets = ["true_color", "ndvi", "sar_vv", "custom"] as const;
export const formats = ["image/png", "image/jpeg", "image/tiff"] as const;
export const interpolations = ["NEAREST", "BILINEAR", "BICUBIC"] as const;

export type Dataset = (typeof datasets)[number];
export type Preset = (typeof presets)[number];
export type OutputFormat = (typeof formats)[number];

export function isAllowedHost(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === "https:"
    && !url.username
    && !url.password
    && !url.port
    && ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

const allowedUrl = (label: string) =>
  z.string().trim().max(300).url().refine(isAllowedHost, {
    message: `${label} must be an https URL on dataspace.copernicus.eu or sentinel-hub.com.`,
  });

const s2Processing = z.object({
  harmonizeValues: z.boolean().default(true),
  upsampling: z.enum(interpolations).default("NEAREST"),
  downsampling: z.enum(interpolations).default("NEAREST"),
}).default({});

const speckleFilter = z.discriminatedUnion("type", [
  z.object({ type: z.literal("NONE") }),
  z.object({
    type: z.literal("LEE"),
    windowSizeX: z.number().int().min(1).max(7),
    windowSizeY: z.number().int().min(1).max(7),
  }),
]);

const s1Processing = z.object({
  speckleFilter: speckleFilter.default({ type: "NONE" }),
  backCoeff: z.enum(["BETA0", "SIGMA0_ELLIPSOID", "GAMMA0_ELLIPSOID", "GAMMA0_TERRAIN"]).default("GAMMA0_ELLIPSOID"),
  orthorectify: z.boolean().default(false),
  demInstance: z.enum(["MAPZEN", "COPERNICUS", "COPERNICUS_30", "COPERNICUS_90"]).default("MAPZEN"),
  radiometricTerrainOversampling: z.number().min(1).max(4).default(2),
  upsampling: z.enum(interpolations).default("NEAREST"),
  downsampling: z.enum(interpolations).default("NEAREST"),
}).default({});

const s1Filter = z.object({
  acquisitionMode: z.enum(["SM", "IW", "EW", "WV", "EN", "AN", "IM"]).nullable().default("IW"),
  polarization: z.enum(["SH", "SV", "DH", "DV", "HH", "HV", "VV", "VH"]).nullable().default("DV"),
  orbitDirection: z.enum(["ASCENDING", "DESCENDING"]).nullable().default(null),
  resolution: z.enum(["HIGH", "MEDIUM", "FULL"]).nullable().default("HIGH"),
}).default({});

export const processSettingsSchema = z.object({
  baseUrl: allowedUrl("Process API URL").default(DEFAULT_BASE_URL),
  tokenUrl: allowedUrl("Token URL").default(DEFAULT_TOKEN_URL),
  timeoutMs: z.number().int().min(5_000).max(120_000).default(30_000),
  dataset: z.enum(datasets).default("sentinel-2-l2a"),
  preset: z.enum(presets).default("true_color"),
  evalscript: z.string().max(20_000).default(""),
  lookbackDays: z.number().int().min(1).max(365).default(30),
  maxCloudCoverage: z.number().min(0).max(100).default(30),
  mosaickingOrder: z.enum(["mostRecent", "leastRecent", "leastCC"]).default("mostRecent"),
  maxPlotsPerRun: z.number().int().min(1).max(20).default(5),
  output: z.object({
    width: z.number().int().min(1).max(2500).default(512),
    format: z.enum(formats).default("image/png"),
    jpegQuality: z.number().int().min(0).max(100).default(90),
  }).default({}),
  s2: s2Processing,
  s1: s1Processing,
  s1Filter,
}).superRefine((value, context) => {
  const isS1 = value.dataset === "sentinel-1-grd";
  if (value.preset === "sar_vv" && !isS1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["preset"], message: "The SAR preset requires the sentinel-1-grd dataset." });
  }
  if ((value.preset === "true_color" || value.preset === "ndvi") && isS1) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["preset"], message: "The optical presets require a Sentinel-2 dataset." });
  }
  if (value.preset === "sar_vv" && value.s1Filter.polarization !== null && !value.s1Filter.polarization.includes("V")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["s1Filter", "polarization"], message: "The VV preset needs a polarization containing V (SV, DV, VV, VH)." });
  }
  if (value.preset === "custom") {
    if (!value.evalscript.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evalscript"], message: "A custom preset requires an evalscript." });
    } else if (!/\/\/\s*VERSION\s*=\s*3/.test(value.evalscript)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evalscript"], message: "The evalscript must contain //VERSION=3." });
    }
  }
  if (isS1 && value.mosaickingOrder === "leastCC") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["mosaickingOrder"], message: "leastCC is only available for Sentinel-2." });
  }
});

export type ProcessSettings = z.infer<typeof processSettingsSchema>;

export const defaultProcessSettings = (): ProcessSettings => processSettingsSchema.parse({});

export const processConfigUpdateSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().max(512).nullable().optional(),
  clientSecret: z.string().max(2048).nullable().optional(),
  settings: processSettingsSchema,
});

export type ProcessConfigUpdate = z.infer<typeof processConfigUpdateSchema>;
