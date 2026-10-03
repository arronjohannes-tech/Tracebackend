// Maps between the flat admin form fields and the nested Copernicus Process settings.
const OPTICAL = ["sentinel-2-l2a", "sentinel-2-l1c"];

export const isSar = (dataset) => !OPTICAL.includes(dataset);

export function settingsToValues(settings) {
  const sar = isSar(settings.dataset);
  const interpolation = sar ? settings.s1 : settings.s2;
  const filter = settings.s1Filter;
  const speckle = settings.s1.speckleFilter;
  return {
    baseUrl: settings.baseUrl,
    tokenUrl: settings.tokenUrl,
    timeoutMs: settings.timeoutMs,
    dataset: settings.dataset,
    preset: settings.preset,
    evalscript: settings.evalscript,
    lookbackDays: settings.lookbackDays,
    maxCloudCoverage: settings.maxCloudCoverage,
    mosaickingOrder: settings.mosaickingOrder,
    maxPlotsPerRun: settings.maxPlotsPerRun,
    width: settings.output.width,
    format: settings.output.format,
    jpegQuality: settings.output.jpegQuality,
    harmonizeValues: settings.s2.harmonizeValues,
    upsampling: interpolation.upsampling,
    downsampling: interpolation.downsampling,
    acquisitionMode: filter.acquisitionMode ?? "",
    polarization: filter.polarization ?? "",
    orbitDirection: filter.orbitDirection ?? "",
    resolution: filter.resolution ?? "",
    backCoeff: settings.s1.backCoeff,
    orthorectify: settings.s1.orthorectify,
    demInstance: settings.s1.demInstance,
    radiometricTerrainOversampling: settings.s1.radiometricTerrainOversampling,
    speckleType: speckle.type,
    windowSizeX: speckle.windowSizeX ?? 3,
    windowSizeY: speckle.windowSizeY ?? 3,
  };
}

export function valuesToSettings(values) {
  const number = (value) => Number(value);
  const speckleFilter = values.speckleType === "LEE"
    ? { type: "LEE", windowSizeX: number(values.windowSizeX), windowSizeY: number(values.windowSizeY) }
    : { type: "NONE" };
  return {
    baseUrl: String(values.baseUrl).trim(),
    tokenUrl: String(values.tokenUrl).trim(),
    timeoutMs: number(values.timeoutMs),
    dataset: values.dataset,
    preset: values.preset,
    evalscript: values.preset === "custom" ? String(values.evalscript) : "",
    lookbackDays: number(values.lookbackDays),
    maxCloudCoverage: number(values.maxCloudCoverage),
    mosaickingOrder: values.mosaickingOrder,
    maxPlotsPerRun: number(values.maxPlotsPerRun),
    output: {
      width: number(values.width),
      format: values.format,
      jpegQuality: number(values.jpegQuality),
    },
    s2: {
      harmonizeValues: Boolean(values.harmonizeValues),
      upsampling: values.upsampling,
      downsampling: values.downsampling,
    },
    s1: {
      speckleFilter,
      backCoeff: values.backCoeff,
      orthorectify: Boolean(values.orthorectify),
      demInstance: values.demInstance,
      radiometricTerrainOversampling: number(values.radiometricTerrainOversampling),
      upsampling: values.upsampling,
      downsampling: values.downsampling,
    },
    s1Filter: {
      acquisitionMode: values.acquisitionMode || null,
      polarization: values.polarization || null,
      orbitDirection: values.orbitDirection || null,
      resolution: values.resolution || null,
    },
  };
}

export function visibilityFor(values) {
  const sar = isSar(values.dataset);
  return {
    s1Options: sar,
    optical: !sar,
    evalscript: values.preset === "custom",
  };
}

// Picks the preset that matches the dataset when the current one cannot be used with it.
export function presetFor(dataset, preset) {
  if (preset === "custom") return preset;
  if (isSar(dataset)) return "sar_vv";
  return preset === "sar_vv" ? "true_color" : preset;
}

export function statusText(config) {
  if (config.active) return "Aktiv: Satellitenanalysen nutzen die Copernicus Process API.";
  if (!config.settingsValid) return "Die gespeicherten Einstellungen sind ungültig. Bitte neu speichern.";
  if (config.enabled && !config.configured) return "Zugangsdaten fehlen: Client-ID und Client-Secret hinterlegen.";
  if (config.enabled && !config.satelliteEnabled) {
    return "Integration eingeschaltet, aber „Satellitenanalyse aktiv“ im Tab „API / EU“ ist aus. Es wird weiterhin der Mock verwendet.";
  }
  return "Inaktiv: Satellitenanalysen verwenden den bisherigen Mock.";
}

export function testResultText(result) {
  if (result.ok) {
    return `Verbindung erfolgreich (${result.contentType}, ${result.bytes} Byte, ${result.durationMs} ms).`;
  }
  const stage = { token: "Authentifizierung", process: "Process-Anfrage", config: "Konfiguration" }[result.stage] ?? "Test";
  return `${stage} fehlgeschlagen: ${result.message}`;
}
