import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const source = new URL("../../admin/", import.meta.url);
const destination = new URL("../admin/", import.meta.url);

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
