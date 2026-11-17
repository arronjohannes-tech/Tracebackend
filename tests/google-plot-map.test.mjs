import test from "node:test";
import assert from "node:assert/strict";
import { initGooglePlotMap } from "../src/google-plot-map.mjs";

class Element {
  children = [];
  isConnected = true;
  attributes = {};
  style = {};
  clientWidth = 1000;
  clientHeight = 700;
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  remove() { this.removed = true; }
  setAttribute(key, value) { this.attributes[key] = value; }
}

const originalDocument = globalThis.document;
const originalWindow = globalThis.window;
test.beforeEach(() => {
  globalThis.document = { createElement: () => new Element(), head: new Element() };
  globalThis.window = {};
});
test.afterEach(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
});

const plots = [0, 1].map((index) => ({
  id: `plot-${index}`,
  polygon: { type: "Polygon", coordinates: [[[36 + index, 7], [36.001 + index, 7], [36 + index, 7.001], [36 + index, 7]]] },
}));
const options = { organizationId: "org-a", satellite: true };

function harness(overrides = {}) {
  const calls = { configs: 0, maps: [], polygons: [], selected: [], keys: [], overlays: [], images: [], pan: 0, projectionReady: true };
  const maps = {
    Map: class {
      types = [];
      fits = [];
      constructor(host, settings) { this.host = host; this.settings = settings; calls.maps.push(this); }
      setMapTypeId(type) { this.types.push(type); }
      fitBounds(bounds) { this.fits.push(bounds.points); }
    },
    Polygon: class {
      constructor(settings) { this.settings = settings; calls.polygons.push(this); }
      addListener(_event, listener) { this.click = listener; }
      setMap(map) { this.detached = map === null; }
    },
    LatLngBounds: class {
      points = [];
      extend(point) { this.points.push(point); }
    },
    LatLng: class {
      constructor(lat, lng) { this.lat = lat; this.lng = lng; }
    },
    OverlayView: class {
      constructor() { calls.overlays.push(this); }
      getPanes() { return { mapPane: { append: (image) => calls.images.push(image) } }; }
      getProjection() {
        if (!calls.projectionReady) return undefined;
        return {
          fromLatLngToDivPixel: ({ lng, lat }) => ({ x: (lng - 36) * 1000, y: (8 - lat) * 1000 }),
          fromLatLngToContainerPixel: ({ lng, lat }) => ({ x: (lng - 36) * 1000 - calls.pan, y: (8 - lat) * 1000 }),
        };
      }
      setMap(map) { if (map) { this.onAdd(); this.draw(); } else this.onRemove(); }
    },
    event: { clearInstanceListeners() {}, trigger() {} },
  };
  const view = initGooglePlotMap({
    api: async () => { calls.configs += 1; return { enabled: true, apiKey: "test-browser-key" }; },
    t: (key) => key,
    onSelect: (id) => calls.selected.push(id),
    loadMaps: async (key, onFailure) => { calls.keys.push(key); calls.authFailure = onFailure; return maps; },
    ...overrides,
  });
  return { view, calls, container: new Element() };
}

test("Google Maps uses the plot coordinates and reuses the map when switching satellite imagery", async () => {
  const { view, calls, container } = harness();
  await view.render(container, plots, options);
  assert.equal(calls.maps.length, 1);
  assert.equal(calls.maps[0].settings.mapTypeId, "satellite");
  assert.equal(calls.configs, 1);
  assert.equal(calls.polygons.length, 2);
  assert.deepEqual(calls.polygons[0].settings.paths[0][0], { lng: 36, lat: 7 });
  assert.equal(calls.maps[0].fits[0].length, 8);
  calls.polygons[1].click();
  assert.deepEqual(calls.selected, ["plot-1"]);
  await view.render(container, plots, { ...options, satellite: false });
  assert.equal(calls.configs, 1);
  assert.equal(calls.maps.length, 1);
  assert.equal(calls.polygons.length, 2);
  assert.deepEqual(calls.maps[0].types, ["satellite", "roadmap"]);
  assert.equal(calls.maps[0].fits.length, 1);
});

test("selection changes replace overlays; clearing removes all overlays and configuration", async () => {
  const { view, calls, container } = harness();
  await view.render(container, plots, options);
  const previous = [...calls.polygons];
  await view.render(new Element(), plots.slice(0, 1), options);
  assert.ok(previous.every((polygon) => polygon.detached));
  assert.equal(calls.maps.length, 1);
  assert.equal(calls.maps[0].fits.length, 2);
  view.clear();
  assert.ok(calls.polygons.every((polygon) => polygon.detached));
  await view.render(container, plots, { ...options, organizationId: "org-b" });
  assert.equal(calls.configs, 2);
  assert.equal(calls.maps.length, 2);
});

test("historical Google overlays stay geographically anchored, swipe without API calls and clean up", async () => {
  const { view, calls, container } = harness();
  const image = { key: "historical", bbox: [36, 7, 37, 8], href: "data:image/png;base64,AAAA" };
  await view.render(container, plots, { ...options, comparisonImages: [image], swipe: 25 });
  assert.equal(calls.overlays.length, 1);
  assert.deepEqual(calls.images[0].style, {
    left: "0px", top: "0px", width: "1000px", height: "700px", clipPath: "inset(0 75% 0 0)",
  });
  assert.equal(calls.images[0].className, "comparison-google-coverage");
  assert.deepEqual(calls.images[0].children[0].style, {
    left: "0px", top: "0px", width: "1000px", height: "1000px",
  });
  view.setSwipe(100);
  assert.equal(calls.images[0].style.clipPath, "inset(0 0% 0 0)");
  view.setSwipe(0);
  assert.equal(calls.images[0].style.clipPath, "inset(0 100% 0 0)");
  assert.equal(calls.configs, 1);
  calls.pan = 100;
  calls.overlays[0].draw();
  assert.equal(calls.images[0].style.left, "100px");
  assert.equal(calls.images[0].children[0].style.left, "-100px");
  await view.render(container, plots, { ...options, comparisonImages: [image], swipe: 50 });
  assert.equal(calls.overlays.length, 1);
  await view.render(container, plots, options);
  assert.ok(calls.images[0].removed);
  await view.render(container, plots, { ...options, comparisonImages: [image] });
  view.clear();
  assert.ok(calls.images.every((item) => item.removed));
});

test("swiping before Google's overlay projection is ready waits for the SDK draw callback", async () => {
  const { view, calls, container } = harness();
  calls.projectionReady = false;
  await view.render(container, plots, {
    ...options, comparisonImages: [{ key: "history", bbox: [36, 7, 37, 8], href: "data:image/png;base64,AAAA" }],
  });
  view.setSwipe(25);
  assert.deepEqual(calls.images[0].style, {});
  calls.projectionReady = true;
  calls.overlays[0].draw();
  assert.equal(calls.images[0].style.clipPath, "inset(0 75% 0 0)");
});
test("no SDK request is made when Google Maps is disabled and the error is actionable", async () => {
  const { view, calls, container } = harness({ api: async () => ({ enabled: false, apiKey: null }) });
  await view.render(container, plots, options);
  assert.equal(calls.keys.length, 0);
  assert.equal(container.children[0].textContent, "prod.map.unconfigured");
  assert.equal(container.children[0].attributes.role, "alert");
});

test("switching away during configuration loading prevents late SDK loading", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const { view, calls, container } = harness({ api: () => pending });
  const render = view.render(container, plots, options);
  view.hide();
  release({ enabled: true, apiKey: "test-browser-key" });
  await render;
  assert.equal(calls.keys.length, 0);
  assert.equal(calls.maps.length, 0);
});

test("SDK and authentication failures are shown, while expired sessions propagate to the app", async () => {
  const failed = harness({ loadMaps: async () => { throw new Error("Network error"); } });
  await failed.view.render(failed.container, plots, options);
  assert.equal(failed.container.children[0].textContent, "prod.map.failed");
  const active = harness();
  await active.view.render(active.container, plots, options);
  active.calls.authFailure();
  assert.equal(active.container.children[0].textContent, "prod.map.failed");
  const expired = harness({ api: async () => { throw Object.assign(new Error("Expired"), { status: 401 }); } });
  await assert.rejects(expired.view.render(expired.container, plots, options), { status: 401 });
  const denied = harness({ api: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); } });
  await denied.view.render(denied.container, plots, options);
  assert.equal(denied.container.children[0].textContent, "prod.access.denied");
});

test("SDK loads once on demand with origin referrers and reports key changes explicitly", async () => {
  const { loadGoogleMaps } = await import("../src/google-plot-map.mjs?loader-success");
  const first = loadGoogleMaps("browser-key", () => {});
  const second = loadGoogleMaps("browser-key", () => {});
  assert.equal(first, second);
  assert.equal(document.head.children.length, 1);
  const script = document.head.children[0];
  assert.equal(new URL(script.src).origin, "https://maps.googleapis.com");
  assert.equal(new URL(script.src).searchParams.get("auth_referrer_policy"), "origin");
  assert.equal(script.referrerPolicy, "strict-origin-when-cross-origin");
  window.google = { maps: { Map: class {} } };
  window.__tracehubMapsReady();
  assert.equal(await first, window.google.maps);
  await assert.rejects(loadGoogleMaps("different-key"), { code: "GOOGLE_MAPS_RELOAD" });
  window.gm_authFailure();
  await assert.rejects(loadGoogleMaps("browser-key"), { code: "GOOGLE_MAPS_LOAD_FAILED" });
});

test("SDK network failures reject instead of pretending that the map loaded", async () => {
  const { loadGoogleMaps } = await import("../src/google-plot-map.mjs?loader-failure");
  const loaded = loadGoogleMaps("browser-key");
  document.head.children[0].onerror();
  await assert.rejects(loaded, { code: "GOOGLE_MAPS_LOAD_FAILED" });
});
