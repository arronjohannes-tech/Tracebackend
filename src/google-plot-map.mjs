import { outerRing, plotTone } from "./plot-map.mjs?v=4";

let sdkPromise;
let sdkKey;
let sdkAuthenticationFailed = false;
let reportAuthenticationFailure;

function mapsError(code) {
  return Object.assign(new Error(code), { code });
}

export function loadGoogleMaps(apiKey, onAuthenticationFailure) {
  reportAuthenticationFailure = onAuthenticationFailure;
  if (sdkAuthenticationFailed) return Promise.reject(mapsError("GOOGLE_MAPS_LOAD_FAILED"));
  if (sdkKey && sdkKey !== apiKey) return Promise.reject(mapsError("GOOGLE_MAPS_RELOAD"));
  if (sdkPromise) return sdkPromise;
  sdkKey = apiKey;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      reject(mapsError("GOOGLE_MAPS_LOAD_FAILED"));
    };
    const timer = setTimeout(fail, 20000);
    window.__tracehubMapsReady = () => {
      clearTimeout(timer);
      resolve(window.google.maps);
    };
    window.gm_authFailure = () => {
      sdkAuthenticationFailed = true;
      fail();
      reportAuthenticationFailure?.();
    };
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.search = new URLSearchParams({
      key: apiKey, v: "quarterly", loading: "async", callback: "__tracehubMapsReady",
      auth_referrer_policy: "origin",
    }).toString();
    script.src = url.href;
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    script.onerror = fail;
    document.head.append(script);
  });
  return sdkPromise;
}

export function initGooglePlotMap({ api, t, onSelect, loadMaps = loadGoogleMaps }) {
  let generation = 0;
  let configuration;
  let organization;
  let maps;
  let map;
  let host;
  let polygons = [];
  let geometryKey;
  let activeContainer;
  let imageOverlays = [];
  let imageKey;
  let swipePosition = 50;

  function releaseImages() {
    for (const overlay of imageOverlays) overlay.setMap(null);
    imageOverlays = [];
    imageKey = null;
  }

  function updateImages(images) {
    const nextKey = JSON.stringify(images.map(({ bbox, key }) => [bbox, key]));
    if (imageKey === nextKey) return;
    releaseImages();
    if (images.length) {
      const overlay = new maps.OverlayView();
      const coverage = document.createElement("div");
      coverage.className = "comparison-google-coverage";
      const elements = images.map(({ bbox, href }) => {
        const image = document.createElement("img");
        image.className = "comparison-google-image";
        image.alt = "";
        image.src = href;
        coverage.append(image);
        return { bbox, image };
      });
      overlay.onAdd = () => overlay.getPanes().mapPane.append(coverage);
      overlay.draw = () => {
        const projection = overlay.getProjection();
        if (!projection) return;
        const reference = new maps.LatLng(images[0].bbox[3], images[0].bbox[0]);
        const referenceDiv = projection.fromLatLngToDivPixel(reference);
        const referenceViewport = projection.fromLatLngToContainerPixel(reference);
        Object.assign(coverage.style, {
          left: `${referenceDiv.x - referenceViewport.x}px`, top: `${referenceDiv.y - referenceViewport.y}px`,
          width: `${host.clientWidth}px`, height: `${host.clientHeight}px`,
          clipPath: `inset(0 ${100 - swipePosition}% 0 0)`,
        });
        for (const { bbox, image } of elements) {
          const nw = projection.fromLatLngToContainerPixel(new maps.LatLng(bbox[3], bbox[0]));
          const se = projection.fromLatLngToContainerPixel(new maps.LatLng(bbox[1], bbox[2]));
          Object.assign(image.style, {
            left: `${nw.x}px`, top: `${nw.y}px`, width: `${se.x - nw.x}px`, height: `${se.y - nw.y}px`,
          });
        }
      };
      overlay.onRemove = () => coverage.remove();
      overlay.setMap(map);
      imageOverlays = [overlay];
    }
    imageKey = nextKey;
  }

  function releasePolygons() {
    for (const polygon of polygons) {
      maps.event.clearInstanceListeners(polygon);
      polygon.setMap(null);
    }
    polygons = [];
  }

  function failure(container, error) {
    const key = error.status === 403 ? "prod.access.denied"
      : error.code === "GOOGLE_MAPS_NOT_CONFIGURED" ? "prod.map.unconfigured"
      : error.code === "GOOGLE_MAPS_RELOAD" ? "prod.map.reload" : "prod.map.failed";
    container.replaceChildren();
    const status = document.createElement("p");
    status.className = "map-empty";
    status.setAttribute("role", "alert");
    status.textContent = t(key);
    container.append(status);
  }

  return {
    hide() {
      generation += 1;
      activeContainer = null;
      host?.remove();
    },
    setSwipe(value) {
      swipePosition = value;
      for (const overlay of imageOverlays) overlay.draw();
    },
    clear() {
      generation += 1;
      activeContainer = null;
      configuration = null;
      organization = null;
      geometryKey = null;
      if (maps) releasePolygons();
      releaseImages();
      host?.remove();
      host = map = null;
    },
    async render(container, plots, { organizationId, satellite, comparisonImages = [], swipe = 50 }) {
      const current = ++generation;
      activeContainer = container;
      const valid = plots.filter(outerRing);
      if (!valid.length) return;
      if (host && map) container.replaceChildren(host);
      else container.textContent = t("prod.map.loading");
      try {
        if (!configuration || organization !== organizationId) {
          organization = organizationId;
          configuration = api("/api/v1/plots/google-maps-config").catch((error) => {
            if (organization === organizationId) configuration = null;
            throw error;
          });
        }
        const config = await configuration;
        if (current !== generation || !container.isConnected) return;
        if (!config.enabled || !config.apiKey) throw mapsError("GOOGLE_MAPS_NOT_CONFIGURED");
        maps = await loadMaps(config.apiKey, () => {
          if (activeContainer) failure(activeContainer, mapsError("GOOGLE_MAPS_LOAD_FAILED"));
        });
        if (current !== generation || !container.isConnected) return;
        if (!map) {
          host = document.createElement("div");
          host.className = "google-plot-map";
          container.replaceChildren(host);
          map = new maps.Map(host, {
            center: { lat: 0, lng: 0 }, zoom: 2, maxZoom: 20,
            mapTypeId: satellite ? "satellite" : "roadmap",
            mapTypeControl: false, streetViewControl: false, fullscreenControl: true,
            gestureHandling: "cooperative",
          });
        }
        maps.event.trigger(map, "resize");
        map.setMapTypeId(satellite ? "satellite" : "roadmap");
        swipePosition = swipe;
        updateImages(comparisonImages);
        const nextKey = JSON.stringify(valid.map((plot) => [plot.id, plot.polygon, plotTone(plot)]));
        if (geometryKey !== nextKey) {
          releasePolygons();
          const bounds = new maps.LatLngBounds();
          polygons = valid.map((plot) => {
            const paths = plot.polygon.coordinates.map((ring) => ring.map(([lng, lat]) => ({ lng, lat })));
            paths[0].forEach((point) => bounds.extend(point));
            const color = { ok: "#356b56", fail: "#ce8e3a", pending: "#77847d" }[plotTone(plot)];
            const polygon = new maps.Polygon({
              map, paths, strokeColor: color, strokeWeight: 3, fillColor: color,
              fillOpacity: 0.3, clickable: true,
            });
            polygon.addListener("click", () => onSelect(plot.id));
            return polygon;
          });
          map.fitBounds(bounds, 40);
          geometryKey = nextKey;
        }
      } catch (error) {
        if (current === generation && container.isConnected) {
          failure(container, error);
          if (error.status === 401) throw error;
        }
      }
    },
  };
}
