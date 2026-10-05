import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMapSvg, createProjection, groupOptions, niceScale, plotTone, plotsInGroup, ringPath,
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
