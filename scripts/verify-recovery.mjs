// Verify recovered originals without needing the Trash or a machine-specific path.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "recovery/2026-10-13/manifest.json"), "utf8"));
const files = [...manifest.files, ...manifest.formalBeforeRecovery.files];
const seen = new Map();
for (const record of files) {
  const destination = path.resolve(root, record.recoveredPath);
  if (!destination.startsWith(root)) throw new Error(`Invalid recovery path: ${record.recoveredPath}`);
  const checksum = seen.get(destination) || createHash("sha256").update(await readFile(destination)).digest("hex");
  seen.set(destination, checksum);
  if (checksum !== record.sha256) throw new Error(`Recovered original changed: ${record.backup}/${record.path}`);
}
console.log(`Verified ${files.length} original file records across ${manifest.directories.length} backups and the formal pre-recovery snapshot (${seen.size} unique files).`);
