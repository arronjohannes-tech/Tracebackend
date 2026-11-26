import test from "node:test";
import assert from "node:assert/strict";
import {
  backgroundAreas, backgroundResolution, backgroundBbox, bboxContains, bboxKey, bboxTooLarge, buildMapSvg, clampToBbox, createProjection, groupOptions, niceScale, plotTone, plotsInGroup, plotsForPolygonView, ringPath, geoJsonFeature, maxDisplacementMetres, metresToDegrees, moveVertex, ringIsSimple, sameRing, translateRing,
} from "../src/plot-map.mjs";

const ok = { state: "ok" };
const validation = (overrides = {}) => ({
  geofence: ok, area: ok, selfIntersection: ok, duplicate: ok, eo: { state: "pending" }, ...overrides,
});
const square = (lng, lat, size = 0.001) => ({
  type: "Polygon",
  coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]],
});
const plot = (id, extra = {}) => ({
  id, farmName: `Farm ${id}`, producer: "Abebe", supplierId: null, supplierName: null, areaHa: "1.2",
  polygon: square(36.8, 7.6), centroid: { lat: 7.6005, lng: 36.8005 }, openCorrectionCount: 0,
  validation: validation(), ...extra,
});
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

test("polygon view defaults to the first plot and otherwise shows only selected plots in list order", () => {
  const plots = [plot("a"), plot("b"), plot("c")];
  assert.deepEqual(plotsForPolygonView(plots, new Set()).map((item) => item.id), ["a"]);
  assert.deepEqual(plotsForPolygonView(plots, new Set(["b"])).map((item) => item.id), ["b"]);
  const selected = plotsForPolygonView(plots, new Set(["c", "a", "removed"]));
  assert.deepEqual(selected.map((item) => item.id), ["a", "c"]);
  const svg = buildMapSvg(selected, { interactive: true }, escape);
  assert.ok(svg.includes('data-plot-tab="a"'));
  assert.ok(svg.includes('data-plot-tab="c"'));
  assert.ok(!svg.includes('data-plot-tab="b"'));
  assert.deepEqual(plotsForPolygonView(plots, new Set(["removed"])).map((item) => item.id), ["a"]);
  assert.deepEqual(plotsForPolygonView([], new Set(["a"])), []);
});

test("plot tone reflects findings before pending checks", () => {
  assert.equal(plotTone(plot("a")), "ok");
  assert.equal(plotTone(plot("a", { validation: validation({ duplicate: { state: "fail" } }) })), "fail");
  assert.equal(plotTone(plot("a", { validation: validation({ geofence: { state: "pending" } }) })), "pending");
  assert.equal(plotTone({ id: "x" }), "pending");
});

test("projection keeps north up and fits every vertex inside the view", () => {
  const plots = [plot("a"), plot("b", { polygon: square(36.81, 7.61) })];
  const { project } = createProjection(plots);
  const [, southY] = project([36.8, 7.6]);
  const [, northY] = project([36.81, 7.611]);
  assert.ok(northY < southY);
  for (const item of plots) {
    for (const point of item.polygon.coordinates[0]) {
      const [x, y] = project(point);
      assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 700, `${x},${y}`);
    }
  }
  assert.equal(createProjection([{ polygon: null }]), null);
});

test("scale bar uses round lengths and metres per pixel", () => {
  const { pixelsPerMetre } = createProjection([plot("a")]);
  const scale = niceScale(pixelsPerMetre);
  assert.ok(/^(1|2|5)0*( m| km)$/.test(scale.label), scale.label);
  assert.ok(scale.pixels <= 160 && scale.pixels > 40);
  assert.equal(niceScale(0.03).label, "5 km");
  assert.equal(niceScale(1.5).label, "100 m");
});

test("ring paths are closed and svg output escapes plot text", () => {
  const { project } = createProjection([plot("a")]);
  assert.ok(ringPath(plot("a").polygon.coordinates[0], project).endsWith("Z"));
  const svg = buildMapSvg([plot("a", { farmName: '<b>"x"</b>', openCorrectionCount: 2 })],
    { interactive: true, numbers: "index" }, escape);
  assert.ok(svg.includes("data-plot-tab=\"a\""));
  assert.ok(svg.includes("corrected"));
  assert.ok(!svg.includes("<b>"));
  assert.ok(svg.includes(">1</text>"));
  assert.equal(buildMapSvg([], {}, escape), "");
  const single = buildMapSvg([plot("a")], { vertices: true }, escape);
  assert.equal((single.match(/geo-vertex/g) ?? []).length, 4);
  assert.ok(!single.includes("data-plot-tab"));
});

test("groups are built per supplier id or producer name and counted", () => {
  const plots = [
    plot("a", { supplierId: "s1", supplierName: "Kaffa" }),
    plot("b", { supplierId: "s1", supplierName: "Kaffa", producer: "Chala" }),
    plot("c", { supplierId: null, producer: "Chala" }),
  ];
  assert.deepEqual(groupOptions(plots, "supplier"), [{ key: "s1", label: "Kaffa", count: 2 }]);
  assert.deepEqual(groupOptions(plots, "producer").map((group) => [group.key, group.count]),
    [["Abebe", 1], ["Chala", 2]]);
  assert.deepEqual(plotsInGroup(plots, "producer", "Chala").map((item) => item.id), ["b", "c"]);
  assert.deepEqual(plotsInGroup(plots, "supplier", "s1").map((item) => item.id), ["a", "b"]);
});

test("the background bbox surrounds the plots with context, is stable and contains them", () => {
  const plots = [plot("a")];
  const bbox = backgroundBbox(plots);
  assert.ok(bbox[0] < 36.8 && bbox[2] > 36.801 && bbox[1] < 7.6 && bbox[3] > 7.601);
  assert.equal(bboxKey(bbox), bboxKey(backgroundBbox(plots)));
  assert.ok(bboxContains(bbox, plots));
  assert.ok(!bboxContains(bbox, [plot("b", { polygon: square(37.5, 7.6) })]));
  assert.ok(!bboxTooLarge(bbox));
  assert.ok(bboxTooLarge(backgroundBbox([plot("a"), plot("b", { polygon: square(37.5, 7.6) })])));
  assert.equal(backgroundBbox([{ polygon: null }]), null);
  for (const value of bbox) assert.equal(value, Number(value.toFixed(5)));
});

test("a bbox projection fills the view exactly and unproject inverts project", () => {
  const bbox = backgroundBbox([plot("a")]);
  const projection = createProjection([], bbox);
  const [x0, y0] = projection.project([bbox[0], bbox[3]]);
  const [x1, y1] = projection.project([bbox[2], bbox[1]]);
  assert.ok(Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6);
  assert.ok(Math.abs(x1 - projection.width) < 1e-6 && Math.abs(y1 - projection.height) < 1e-6);
  assert.ok(projection.width <= 1000 && projection.height <= 700);
  const [lng, lat] = projection.unproject(projection.project([36.8005, 7.6004]));
  assert.ok(Math.abs(lng - 36.8005) < 1e-9 && Math.abs(lat - 7.6004) < 1e-9);
});

test("distant selections split into local backgrounds while neighbouring plots share an image", () => {
  const nearby = [plot("a"), plot("b", { polygon: square(36.802, 7.602) })];
  assert.deepEqual(backgroundAreas(nearby), [backgroundBbox(nearby)]);
  const plots = [...nearby, plot("c", { polygon: square(37.5, 8.6) })];
  const areas = backgroundAreas(plots);
  assert.equal(areas.length, 2);
  assert.ok(areas.every((bbox) => !bboxTooLarge(bbox)));
  assert.ok(plots.every((item) => areas.some((bbox) => bboxContains(bbox, [item]))));
  assert.deepEqual(backgroundAreas([...plots].reverse()), areas);
  assert.deepEqual(backgroundAreas([{ polygon: null }]), []);
  const oversized = plot("large", { polygon: square(36, 7, 1) });
  assert.ok(bboxTooLarge(backgroundAreas([oversized])[0]));
});

test("background resolution follows rendered size, device density and each image's share of the map", () => {
  const bbox = [36, 7, 36.01, 7.01];
  assert.equal(backgroundResolution(bbox, bbox, 300, 300), 1024);
  assert.equal(backgroundResolution(bbox, bbox, 300, 300, 2), 1024);
  assert.equal(backgroundResolution(bbox, bbox, 900, 900, 4), 2048);
  assert.equal(backgroundResolution(bbox, bbox, 4000, 4000), 2048);
  assert.equal(backgroundResolution(bbox, [36, 7, 37, 8], 1000, 700, 2), 1024);
});

test("multiple satellite images retain geographic placement below all polygons", () => {
  const plots = [plot("a"), plot("b", { polygon: square(37.5, 8.6) })];
  const bbox = backgroundBbox(plots);
  const backgrounds = backgroundAreas(plots).map((area, index) => ({ bbox: area, href: `image-${index}` }));
  const svg = buildMapSvg(plots, { bbox, backgrounds }, escape);
  assert.equal((svg.match(/<image /g) ?? []).length, 2);
  assert.ok(svg.lastIndexOf("<image") < svg.indexOf('class="geo-plot'));
  const projection = createProjection(plots, bbox);
  for (const entry of backgrounds) {
    const [x, y] = projection.project([entry.bbox[0], entry.bbox[3]]);
    const [right, bottom] = projection.project([entry.bbox[2], entry.bbox[1]]);
    assert.ok(svg.includes(`href="${entry.href}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(right - x).toFixed(1)}" height="${(bottom - y).toFixed(1)}"`));
  }
});

test("the satellite image is drawn across the bbox below the polygon and handles appear when editing", () => {
  const item = plot("a");
  const bbox = backgroundBbox([item]);
  const svg = buildMapSvg([item], {
    bbox, background: { href: "data:image/jpeg;base64,AAAA" }, editing: true, ghost: item.polygon.coordinates[0],
  }, escape);
  assert.ok(svg.includes("has-image"));
  assert.ok(svg.indexOf("<image") < svg.indexOf("geo-plot"));
  assert.ok(svg.includes("data:image/jpeg;base64,AAAA"));
  assert.equal((svg.match(/data-vertex=/g) ?? []).length, 4);
  assert.ok(svg.includes("data-drag-all"));
  assert.ok(svg.includes("geo-ghost"));
  assert.ok(!buildMapSvg([item], { bbox }, escape).includes("<image"));
});

test("vertices and whole rings move inside the bbox and the closing position follows the first one", () => {
  const ring = square(36.8, 7.6).coordinates[0];
  const bbox = [36.7995, 7.5995, 36.8015, 7.6015];
  const moved = moveVertex(ring, 0, [36.8002, 7.6002]);
  assert.deepEqual(moved[0], moved[4]);
  assert.deepEqual(moved[1], ring[1]);
  assert.deepEqual(ring[0], [36.8, 7.6]);
  assert.deepEqual(clampToBbox([37, 7], bbox), [36.8015, 7.5995]);
  const shifted = translateRing(ring, 0.0001, -0.0001, bbox);
  assert.equal(shifted[0][0], 36.8001);
  assert.equal(shifted[0][1], 7.5999);
  assert.deepEqual(shifted[0], shifted[4]);
  const clamped = translateRing(ring, 1, 1, bbox);
  assert.equal(Math.max(...clamped.map(([lng]) => lng)), 36.8015);
  assert.equal(Math.max(...clamped.map(([, lat]) => lat)), 7.6015);
  assert.ok(sameRing(ring, ring.map((point) => [...point])));
  assert.ok(!sameRing(ring, moved));
});

test("self-intersecting rings are detected, simple ones and shared corners are not", () => {
  assert.equal(ringIsSimple(square(36.8, 7.6).coordinates[0]), true);
  const bowTie = [[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]];
  assert.equal(ringIsSimple(bowTie), false);
  assert.equal(ringIsSimple([[0, 0], [2, 0], [1, 1], [0, 0]]), true);
  assert.equal(ringIsSimple([[0, 0], [4, 0], [4, 4], [2, 1], [0, 4], [0, 0]]), true);
});

test("metric helpers convert offsets and measure the largest vertex displacement", () => {
  const [dLng, dLat] = metresToDegrees(0, 111.32, 111.32);
  assert.ok(Math.abs(dLng - 0.001) < 1e-9 && Math.abs(dLat - 0.001) < 1e-9);
  const before = square(36.8, 7.6).coordinates[0];
  const after = moveVertex(before, 2, [before[2][0], before[2][1] + 0.0001]);
  const metres = maxDisplacementMetres(before, after);
  assert.ok(metres > 11 && metres < 11.3, String(metres));
  assert.equal(maxDisplacementMetres(before, before.slice(1)), 0);
});

test("a stored version becomes a GeoJSON feature", () => {
  const feature = geoJsonFeature(plot("a"), {
    version: 3, source: "tracehub", areaHa: "1.0", createdAt: "2026-11-01T00:00:00Z", createdBy: "Reviewer",
    note: "", polygon: square(36.8, 7.6),
  });
  assert.equal(feature.type, "Feature");
  assert.equal(feature.geometry.type, "Polygon");
  assert.equal(feature.properties.version, 3);
  assert.equal(feature.properties.createdBy, "Reviewer");
  assert.ok(!("note" in feature.properties));
});
test("Mercator backgrounds and polygons share the same projection at high latitude", async () => {
  const { createMercatorProjection } = await import("../src/plot-map.mjs");
  const projection = createMercatorProjection([36, 60, 36.02, 60.02]);
  assert.deepEqual(projection.project([36, 60.02]), [0, 0]);
  const bottomRight = projection.project([36.02, 60]);
  assert.equal(bottomRight[0], projection.width);
  assert.equal(bottomRight[1], projection.height);
  const [middleX, middleY] = projection.project([36.01, 60.01]);
  assert.ok(Math.abs(middleX - projection.width / 2) < 1e-8);
  assert.ok(Math.abs(middleY - projection.height / 2) > 0.01);
});