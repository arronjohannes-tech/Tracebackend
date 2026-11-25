const { withAndroidManifest } = require("expo/config-plugins");

module.exports = ({ config }) => {
  const astertrace = process.env.EXPO_PUBLIC_ASTERTRACE_ANDROID_TEST === "1";
  const app = {
    ...config,
    ...(astertrace ? {
      name: "Astertrace",
      android: { ...config.android, package: "com.ajohannes.astertrace" },
    } : {}),
  };
  return withAndroidManifest(app, (result) => {
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
