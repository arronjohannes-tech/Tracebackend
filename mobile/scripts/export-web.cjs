const { copyFileSync } = require("node:fs");
const { resolve } = require("node:path");

// Keep the trusted activation pathname on static hosts without requiring a SPA rewrite.
const output = resolve(__dirname, "..", "dist", "web");
copyFileSync(resolve(output, "index.html"), resolve(output, "mobile-activate.html"));
