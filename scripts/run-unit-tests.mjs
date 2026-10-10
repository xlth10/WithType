import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// Enumerate explicitly: shell globs and directory discovery differ between
// Windows npm shells and Node versions, especially for .test.mjs files.
const directory = new URL("../tests/", import.meta.url);
const files = (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => fileURLToPath(new URL(entry.name, directory)))
  .sort();
if (!files.length) throw new Error("No unit test files found");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
