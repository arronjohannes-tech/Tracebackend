const { withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = ({ config }) => {
  const astertrace = process.env.EXPO_PUBLIC_ASTERTRACE_ANDROID_TEST === "1";
  const app = {
    ...config,
    ...(astertrace ? {
      name: "Astertrace",
      android: { ...config.android, package: "com.ajohannes.astertrace" },
    } : {}),
  };
  const withMapFonts = withDangerousMod(app, ["android", async (result) => {
    const destination = path.join(result.modRequest.platformProjectRoot, "app", "src", "main", "assets", "mapfonts");
    const source = path.join(result.modRequest.projectRoot, "assets", "mapfonts");
    await fs.mkdir(destination, { recursive: true });
    for (const name of ["NotoSans-Regular.ttf", "NotoSansEthiopic-Regular.ttf", "OFL-NotoSans.txt", "OFL-NotoSansEthiopic.txt"]) {
      await fs.copyFile(path.join(source, name), path.join(destination, name));
    }
    return result;
  }]);
  return withAndroidManifest(withMapFonts, (result) => {
    const manifest = result.modResults.manifest;
    manifest.queries = manifest.queries ?? [];
    if (!manifest.queries.length) manifest.queries.push({});
    const queries = manifest.queries[0];
    queries.intent = queries.intent ?? [];
    queries.intent.push({
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      category: [{ $: { "android:name": "android.intent.category.BROWSABLE" } }],
      data: [{ $: { "android:scheme": "om" } }],
    });
    return result;
  });
};
