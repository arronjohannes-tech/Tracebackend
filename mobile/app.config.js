const appJson = require("./app.json");

module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const android = {
    ...appJson.expo.android,
    ...config.android,
    config: { ...appJson.expo.android.config, ...config.android?.config },
  };
  return {
    ...config,
    android: apiKey
      ? {
          ...android,
          config: {
            ...android.config,
            googleMaps: { ...android.config.googleMaps, apiKey },
          },
        }
      : android,
  };
};
