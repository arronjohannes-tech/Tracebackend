const appJson = require("./app.json");

module.exports = ({ config }) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  return {
    ...config,
    android: apiKey
      ? {
          ...appJson.expo.android,
          config: {
            ...appJson.expo.android.config,
            googleMaps: { apiKey },
          },
        }
      : appJson.expo.android,
  };
};
