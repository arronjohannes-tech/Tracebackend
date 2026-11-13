// Pure helpers for the plot map, the satellite background, the manual position editor and the correction groups.

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 700;
const PADDING = 90;
const METRES_PER_DEGREE = 111_320;
// The backend refuses satellite backgrounds that span more than this many degrees.
export const MAX_BACKGROUND_SPAN_DEG = 0.1;
const MIN_BACKGROUND_PAD_M = 80;
const BACKGROUND_PAD_RATIO = 0.6;

export const MAP_VIEW = { width: VIEW_WIDTH, height: VIEW_HEIGHT };

export function plotsForPolygonView(plots, selectedIds) {
  const selected = plots.filter((plot) => selectedIds.has(plot.id));
  return selected.length ? selected : plots.slice(0, 1);
}

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

function ringExtent(rings) {
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
  return { minLng, maxLng, minLat, maxLat };
}

const fiveDecimals = (value) => Number(value.toFixed(5));

/**
 * Bounding box [west, south, east, north] of the plots plus generous context, rounded outwards to 5 decimals
 * (about one metre) so that the same view always asks the backend for the same satellite image.
 */
export function backgroundBbox(plots) {
  const rings = plots.map(outerRing).filter(Boolean);
  if (!rings.length) return null;
  const { minLng, maxLng, minLat, maxLat } = ringExtent(rings);
  const cosine = Math.max(Math.cos(((minLat + maxLat) / 2) * Math.PI / 180), 0.01);
  const largestSideM = Math.max((maxLng - minLng) * cosine, maxLat - minLat) * METRES_PER_DEGREE;
  const padM = Math.max(MIN_BACKGROUND_PAD_M, BACKGROUND_PAD_RATIO * largestSideM);
  const padLat = padM / METRES_PER_DEGREE;
  const padLng = padLat / cosine;
  return [
    fiveDecimals(minLng - padLng - 5e-6),
    fiveDecimals(minLat - padLat - 5e-6),
    fiveDecimals(maxLng + padLng + 5e-6),
    fiveDecimals(maxLat + padLat + 5e-6),
  ];
}

export const bboxKey = (bbox) => bbox.map((value) => value.toFixed(5)).join(",");

export function bboxTooLarge(bbox) {
  return Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1]) > MAX_BACKGROUND_SPAN_DEG;
}

/** True when every vertex of every plot lies inside the bounding box. */
export function bboxContains(bbox, plots) {
  const rings = plots.map(outerRing).filter(Boolean);
  if (!bbox || !rings.length) return false;
  return rings.every((ring) => ring.every(([lng, lat]) =>
    lng >= bbox[0] && lng <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]));
}

function buildProjection(minLng, maxLng, minLat, maxLat, { padding }) {
  const cosine = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const spanX = Math.max((maxLng - minLng) * cosine, 1e-7);
  const spanY = Math.max(maxLat - minLat, 1e-7);
  const scale = Math.min((VIEW_WIDTH - 2 * padding) / spanX, (VIEW_HEIGHT - 2 * padding) / spanY);
  const width = padding ? VIEW_WIDTH : spanX * scale;
  const height = padding ? VIEW_HEIGHT : spanY * scale;
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return {
    width,
    height,
    project: ([lng, lat]) => [
      offsetX + (lng - minLng) * cosine * scale,
      offsetY + (maxLat - lat) * scale,
    ],
    unproject: ([x, y]) => [
      minLng + (x - offsetX) / (cosine * scale),
      maxLat - (y - offsetY) / scale,
    ],
    pixelsPerMetre: scale / METRES_PER_DEGREE,
  };
}

/**
 * Equirectangular projection with north up. Without `bbox` it is scaled so that all rings fit the view;
 * with `bbox` the box itself fills the view exactly, which is what a satellite image of that box needs.
 */
export function createProjection(plots, bbox = null) {
  if (bbox) return buildProjection(bbox[0], bbox[2], bbox[1], bbox[3], { padding: 0 });
  const rings = plots.map(outerRing).filter(Boolean);
  if (!rings.length) return null;
  const { minLng, maxLng, minLat, maxLat } = ringExtent(rings);
  return buildProjection(minLng, maxLng, minLat, maxLat, { padding: PADDING });
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
 * Builds the SVG of the map. Options: `interactive` makes polygons selectable (data-plot-tab), `vertices` draws
 * the captured GPS points, `numbers` labels polygons by list position, `bbox` fixes the visible area,
 * `background` ({ href }) draws the satellite image across the bbox, `editing` turns the vertices into
 * draggable handles and `ghost` outlines the position the editing started from.
 */
export function buildMapSvg(plots, options, escape) {
  const projection = createProjection(plots, options.bbox ?? null);
  if (!projection) return "";
  const { project, pixelsPerMetre, width, height } = projection;
  const shapes = plots.map((plot, index) => {
    const ring = outerRing(plot);
    if (!ring) return "";
    const tone = plotTone(plot);
    const corrected = plot.openCorrectionCount > 0 ? " corrected" : "";
    const [cx, cy] = centroidOf(plot, ring, project);
    const label = escape(`${plot.farmName} · ${plot.areaHa} ha`);
    const vertices = options.vertices || options.editing
      ? ring.slice(0, -1).map((point, vertex) => {
        const [x, y] = project(point);
        return options.editing
          ? `<circle class="geo-handle" data-vertex="${vertex}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11"`
            + ` tabindex="0" role="button" aria-label="${escape(`${vertex + 1}`)}"/>`
          : `<circle class="geo-vertex" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6"/>`;
      }).join("")
      : "";
    const badge = options.numbers
      ? `<circle class="geo-badge" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="19"/>`
        + `<text class="geo-badge-text" x="${cx.toFixed(1)}" y="${(cy + 6).toFixed(1)}">${options.numbers === "index" ? index + 1 : ""}</text>`
      : "";
    const attributes = options.interactive
      ? ` data-plot-tab="${escape(plot.id)}" tabindex="0" role="button" aria-label="${label}"`
      : "";
    const body = options.editing ? ' data-drag-all="true"' : "";
    return `<g class="geo-plot ${tone}${corrected}${options.editing ? " editing" : ""}"${attributes}><title>${label}</title>`
      + `<path d="${ringPath(ring, project)}"${body}/>${vertices}${badge}</g>`;
  }).join("");
  const ghostRing = options.ghost;
  const ghost = ghostRing ? `<path class="geo-ghost" d="${ringPath(ghostRing, project)}"/>` : "";
  const image = options.background?.href
    ? `<image class="geo-image" href="${escape(options.background.href)}" x="0" y="0"`
      + ` width="${width.toFixed(1)}" height="${height.toFixed(1)}" preserveAspectRatio="none"/>`
    : "";
  const scale = niceScale(pixelsPerMetre);
  const scaleBar = scale
    ? `<g class="geo-scale"><path d="M40 ${(height - 52).toFixed(1)} v14 h${scale.pixels.toFixed(1)} v-14"/>`
      + `<text x="40" y="${(height - 62).toFixed(1)}">${escape(scale.label)}</text></g>`
    : "";
  const north = `<g class="geo-north"><path d="M${(width - 56).toFixed(1)} 96 l12 -40 l12 40 l-12 -9 z"/>`
    + `<text x="${(width - 44).toFixed(1)}" y="122">N</text></g>`;
  return `<svg class="geo-map${image ? " has-image" : ""}" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}"`
    + ` preserveAspectRatio="xMidYMid meet" focusable="false">${image}${ghost}${shapes}${scaleBar}${north}</svg>`;
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

/* ---------- manual position editing ---------- */

const orientation = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));

function segmentsCross(a, b, c, d) {
  return orientation(a, b, c) * orientation(a, b, d) < 0 && orientation(c, d, a) * orientation(c, d, b) < 0;
}

/** False when two non-adjacent edges of the closed ring cross each other. */
export function ringIsSimple(ring) {
  const edges = ring.length - 1;
  for (let i = 0; i < edges; i += 1) {
    for (let j = i + 1; j < edges; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === edges - 1);
      if (!adjacent && segmentsCross(ring[i], ring[i + 1], ring[j], ring[j + 1])) return false;
    }
  }
  return true;
}

export function clampToBbox([lng, lat], bbox) {
  return [Math.min(bbox[2], Math.max(bbox[0], lng)), Math.min(bbox[3], Math.max(bbox[1], lat))];
}

const roundCoordinate = (value) => Number(value.toFixed(9));

/** Moves one vertex of the closed ring; the closing position follows the first vertex. */
export function moveVertex(ring, index, position) {
  const next = ring.map((point) => [...point]);
  const target = [roundCoordinate(position[0]), roundCoordinate(position[1])];
  next[index] = target;
  if (index === 0) next[next.length - 1] = [...target];
  return next;
}

/** Shifts the whole ring by a delta in degrees, keeping every vertex inside the bbox. */
export function translateRing(ring, deltaLng, deltaLat, bbox) {
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  const dLng = Math.min(bbox[2] - Math.max(...lngs), Math.max(bbox[0] - Math.min(...lngs), deltaLng));
  const dLat = Math.min(bbox[3] - Math.max(...lats), Math.max(bbox[1] - Math.min(...lats), deltaLat));
  return ring.map(([lng, lat]) => [roundCoordinate(lng + dLng), roundCoordinate(lat + dLat)]);
}

/** Degrees of longitude and latitude that correspond to a metric offset at the given latitude. */
export function metresToDegrees(latitude, eastM, northM) {
  const cosine = Math.max(Math.cos(latitude * Math.PI / 180), 0.01);
  return [eastM / (METRES_PER_DEGREE * cosine), northM / METRES_PER_DEGREE];
}

export function distanceMetres(a, b) {
  const cosine = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((b[0] - a[0]) * cosine, b[1] - a[1]) * METRES_PER_DEGREE;
}

/** Largest distance any vertex moved between two rings with the same number of positions. */
export function maxDisplacementMetres(before, after) {
  if (before.length !== after.length) return 0;
  return Math.max(0, ...before.map((point, index) => distanceMetres(point, after[index])));
}

export const sameRing = (left, right) => left.length === right.length
  && left.every((point, index) => point[0] === right[index][0] && point[1] === right[index][1]);

/** A GeoJSON Feature for download; the properties identify the plot and the stored version. */
export function geoJsonFeature(plot, version) {
  return {
    type: "Feature",
    id: plot.id,
    properties: {
      plotId: plot.id,
      farmName: plot.farmName,
      producer: plot.producer,
      version: version.version,
      source: version.source,
      areaHa: version.areaHa,
      createdAt: version.createdAt,
      ...(version.createdBy ? { createdBy: version.createdBy } : {}),
      ...(version.note ? { note: version.note } : {}),
    },
    geometry: version.polygon,
  };
}