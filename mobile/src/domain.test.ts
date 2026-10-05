import assert from "node:assert/strict";
import test from "node:test";
import {
  checkPositionAgainstGeofences,
  closePolygon,
  createUuid,
  distanceToPolygonM,
  evaluatePlotGeofence,
  parsePolygon,
  pointInPolygon,
  type OrganizationGeofence,
} from "./domain";

test("closePolygon produces a closed GeoJSON polygon", () => {
  const polygon = closePolygon([
    [7, 50],
    [8, 50],
    [8, 51],
  ]);

  assert.equal(polygon.type, "Polygon");
  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0][3]);
});

test("parsePolygon rejects malformed geometry", () => {
  assert.throws(() => parsePolygon('{"type":"Point","coordinates":[7,50]}'));
  assert.throws(() =>
    parsePolygon('{"type":"Polygon","coordinates":[[[7,50],[8,50]]]}'),
  );
});

test("polygon validation rejects coordinate ranges, open rings, zero area and self intersections", () => {
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[181,0],[1,0],[1,1],[181,0]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[2,0],[0,0]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[2,2],[0,2],[2,0],[0,0]]]}',
  ));
  assert.throws(() => parsePolygon(
    '{"type":"Polygon","coordinates":[[[0,0],[1,0],[0,0],[0,0]]]}',
  ));
});

test("pointInPolygon includes boundary and excludes holes", () => {
  const polygon = parsePolygon(JSON.stringify({
    type: "Polygon",
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
  }));
  assert.equal(pointInPolygon([2, 2], polygon), true);
  assert.equal(pointInPolygon([0, 5], polygon), true);
  assert.equal(pointInPolygon([5, 5], polygon), false);
  assert.equal(pointInPolygon([11, 5], polygon), false);
});

test("local geofence precheck is pending, inside, or outside", () => {
  const fence: OrganizationGeofence = {
    id: "fence-1",
    organizationId: "org-1",
    polygon: closePolygon([[0, 0], [10, 0], [10, 10], [0, 10]]),
  };
  assert.equal(evaluatePlotGeofence(closePolygon([[1, 1], [2, 1], [1, 2]]), []), "pending");
  assert.equal(
    evaluatePlotGeofence(closePolygon([[1, 1], [2, 1], [1, 2]]), [fence]),
    "inside",
  );
  assert.equal(
    evaluatePlotGeofence(closePolygon([[9, 9], [11, 9], [9, 11]]), [fence]),
    "outside",
  );
});

test("UUID identifiers have RFC 4122 version and variant bits", () => {
  assert.match(
    createUuid(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});

test("a GPS fix is checked against the organization geofences", () => {
  const fence: OrganizationGeofence = {
    id: "fence-1",
    organizationId: "org-1",
    name: "Jimma zone",
    polygon: closePolygon([[36, 7], [37, 7], [37, 8], [36, 8]]),
  };
  assert.deepEqual(checkPositionAgainstGeofences([36.5, 7.5], []), { status: "pending" });
  const inside = checkPositionAgainstGeofences([36.5, 7.5], [fence]);
  assert.equal(inside.status, "inside");
  assert.equal(inside.status === "inside" && inside.geofence.name, "Jimma zone");
  assert.equal(checkPositionAgainstGeofences([36, 7.5], [fence]).status, "inside");

  const outside = checkPositionAgainstGeofences([37.01, 7.5], [fence]);
  assert.equal(outside.status, "outside");
  // 0.01 degrees of longitude at 7.5 degrees latitude is about 1.1 km.
  const distance = outside.status === "outside" ? outside.distanceM : null;
  assert.ok(distance !== null && distance > 1000 && distance < 1200, String(distance));
});

test("the distance is measured to the nearest geofence and ignores holes as inside area", () => {
  const near: OrganizationGeofence = { id: "near", organizationId: "o", polygon: closePolygon([[0, 0], [1, 0], [1, 1], [0, 1]]) };
  const far: OrganizationGeofence = { id: "far", organizationId: "o", polygon: closePolygon([[10, 10], [11, 10], [11, 11], [10, 11]]) };
  const result = checkPositionAgainstGeofences([1.001, 0.5], [far, near]);
  assert.equal(result.status, "outside");
  assert.ok(result.status === "outside" && result.distanceM !== null && result.distanceM < 120);
  const ring = parsePolygon(JSON.stringify({
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.8, 0.8], [1.2, 0.8], [1.2, 1.2], [0.8, 1.2], [0.8, 0.8]]],
  }));
  assert.ok(distanceToPolygonM([1, 1], ring) > 0);
  assert.equal(distanceToPolygonM([0.5, 0], ring) < 1, true);
});
