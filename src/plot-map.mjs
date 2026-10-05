// Pure helpers for the plot map and the correction groups of the productive Tracehub plots view.

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 700;
const PADDING = 90;
const METRES_PER_DEGREE = 111_320;

export const MAP_VIEW = { width: VIEW_WIDTH, height: VIEW_HEIGHT };

export function outerRing(plot) {
  const ring = plot?.polygon?.coordinates?.[0];
  return Array.isArray(ring) && ring.length >= 4 ? ring : null;
}

/** Overall colour of a plot: any finding wins, then an unchecked geofence, otherwise fine. */
export function plotTone(plot) {
  const v = plot?.validation;
  if (!v) return "pending";
  const checks = [v.geofence, v.area, v.selfIntersection, v.duplicate];
  if (checks.some((check) => check.state === "fail")) return "fail";
  if (v.geofence.state === "pending") return "pending";
  return "ok";
}

/** Equirectangular projection scaled so that all rings fit the map view; north is up. */
export function createProjection(plots) {
  const rings = plots.map(outerRing).filter(Boolean);
  if (!rings.length) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  const cosine = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanX = Math.max((maxLng - minLng) * cosine, 1e-7);
  const spanY = Math.max(maxLat - minLat, 1e-7);
  const scale = Math.min((VIEW_WIDTH - 2 * PADDING) / spanX, (VIEW_HEIGHT - 2 * PADDING) / spanY);
  const offsetX = (VIEW_WIDTH - spanX * scale) / 2;
  const offsetY = (VIEW_HEIGHT - spanY * scale) / 2;
  return {
    project: ([lng, lat]) => [
      offsetX + (lng - minLng) * cosine * scale,
      offsetY + (maxLat - lat) * scale,
    ],
    pixelsPerMetre: scale / METRES_PER_DEGREE,
  };
}

/** Largest 1/2/5 x 10^n metre length that is not longer than the requested pixel width. */
export function niceScale(pixelsPerMetre, targetPixels = 160) {
  const metres = targetPixels / pixelsPerMetre;
  if (!Number.isFinite(metres) || metres <= 0) return null;
  const magnitude = 10 ** Math.floor(Math.log10(metres));
  const metresRounded = [5, 2, 1].map((factor) => factor * magnitude).find((value) => value <= metres)
    ?? magnitude;
  return {
    metres: metresRounded,
    pixels: metresRounded * pixelsPerMetre,
    label: metresRounded >= 1000 ? `${metresRounded / 1000} km` : `${metresRounded} m`,
  };
}

export function ringPath(ring, project) {
  return `${ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ")} Z`;
}

function centroidOf(plot, ring, project) {
  if (plot.centroid) return project([plot.centroid.lng, plot.centroid.lat]);
  const points = ring.slice(0, -1).map(project);
  return [
    points.reduce((sum, [x]) => sum + x, 0) / points.length,
    points.reduce((sum, [, y]) => sum + y, 0) / points.length,
  ];
}

/**
 * Builds the SVG of the map. `options.interactive` makes polygons selectable (data-plot-tab),
 * `options.vertices` draws the captured GPS points, `options.numbers` labels polygons by list position.
 */
export function buildMapSvg(plots, options, escape) {
  const projection = createProjection(plots);
  if (!projection) return "";
  const { project, pixelsPerMetre } = projection;
  const shapes = plots.map((plot, index) => {
    const ring = outerRing(plot);
    if (!ring) return "";
    const tone = plotTone(plot);
    const corrected = plot.openCorrectionCount > 0 ? " corrected" : "";
    const [cx, cy] = centroidOf(plot, ring, project);
    const label = escape(`${plot.farmName} · ${plot.areaHa} ha`);
    const vertices = options.vertices
      ? ring.slice(0, -1).map((point) => {
        const [x, y] = project(point);
        return `<circle class="geo-vertex" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`;
      }).join("")
      : "";
    const badge = options.numbers
      ? `<circle class="geo-badge" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="19"/>`
        + `<text class="geo-badge-text" x="${cx.toFixed(1)}" y="${(cy + 6).toFixed(1)}">${options.numbers === "index" ? index + 1 : ""}</text>`
      : "";
    const attributes = options.interactive
      ? ` data-plot-tab="${escape(plot.id)}" tabindex="0" role="button" aria-label="${label}"`
      : "";
    return `<g class="geo-plot ${tone}${corrected}"${attributes}><title>${label}</title>`
      + `<path d="${ringPath(ring, project)}"/>${vertices}${badge}</g>`;
  }).join("");
  const scale = niceScale(pixelsPerMetre);
  const scaleBar = scale
    ? `<g class="geo-scale"><path d="M40 ${VIEW_HEIGHT - 52} v14 h${scale.pixels.toFixed(1)} v-14"/>`
      + `<text x="40" y="${VIEW_HEIGHT - 62}">${escape(scale.label)}</text></g>`
    : "";
  const north = `<g class="geo-north"><path d="M${VIEW_WIDTH - 56} 96 l12 -40 l12 40 l-12 -9 z"/>`
    + `<text x="${VIEW_WIDTH - 44}" y="122">N</text></g>`;
  return `<svg class="geo-map" viewBox="0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}" preserveAspectRatio="xMidYMid meet"`
    + ` focusable="false">${shapes}${scaleBar}${north}</svg>`;
}

/** Groups offered for a correction request: suppliers (by id) or producers (by name), with plot counts. */
export function groupOptions(plots, groupType) {
  const groups = new Map();
  for (const plot of plots) {
    const key = groupType === "supplier" ? plot.supplierId : plot.producer;
    if (!key) continue;
    const label = groupType === "supplier" ? (plot.supplierName || key) : plot.producer;
    const entry = groups.get(key) ?? { key, label, count: 0 };
    entry.count += 1;
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function plotsInGroup(plots, groupType, groupKey) {
  return plots.filter((plot) => (groupType === "supplier" ? plot.supplierId : plot.producer) === groupKey);
}
