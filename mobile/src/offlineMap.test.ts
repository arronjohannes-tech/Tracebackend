import assert from "node:assert/strict";
import test from "node:test";
import { isSqliteHeader, offlineMapStyle } from "./offlineMap";

test("offline map uses only a local MBTiles source, or no source before download", () => {
  const blank = offlineMapStyle(null);
  assert.deepEqual(blank.sources, {});
  const local = offlineMapStyle("file:///data/user/0/app/files/ethiopia.mbtiles");
  assert.equal(local.sources.ethiopia.type, "vector");
  assert.equal("url" in local.sources.ethiopia && local.sources.ethiopia.url,
    "mbtiles:///data/user/0/app/files/ethiopia.mbtiles");
  assert.throws(() => offlineMapStyle("https://example.com/map.mbtiles"), /local file/);
});

test("rejects a downloaded file without a SQLite header", () => {
  assert.equal(isSqliteHeader("U1FMaXRlIGZvcm1hdCAzAA=="), true);
  assert.equal(isSqliteHeader("PGh0bWw+"), false);
  assert.equal(isSqliteHeader(""), false);
});
