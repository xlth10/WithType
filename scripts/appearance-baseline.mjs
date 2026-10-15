// Records the actual shipped colour/font inputs and verifies offline build assets.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = name => readFile(path.join(root, name));
const json = async name => JSON.parse(await read(name));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = message => { throw new Error(message); };
const normalizeHex = value => {
  const color = value.trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(color) ? `#${[...color.slice(1)].map(c => c + c).join("")}` : color;
};

const font = await json("public/fonts/manifest.json");
const fontBytes = await read(`public/fonts/${font.file}`);
if (fontBytes.subarray(0, 4).toString() !== "wOF2"
  || hash(fontBytes) !== font.woff2Sha256 || fontBytes.length !== font.bytes) fail("Bundled font differs from its verified manifest.");
for (const file of ["OFL-NotoSansSC.txt", "COPYRIGHT-NotoSansSC.txt"]) {
  if ((await read(`public/fonts/${file}`)).length < 100) fail(`Missing font attribution: ${file}`);
}

const inputs = ["src/styles.css", "src/ui/paper-theme.css", "src/main.jsx", "src/ui/AppEntrance.jsx", "src/ui/inkWelcome.js", "src/ui/inkArrival.js", "src/ui/inkWelcomeMotion.js", "src/ui/inkWelcomePlayer.js", "src/ui/ink-welcome.css", "src/ui/welcome.js", "index.html", "src/voice/motion.js", "src-tauri/tauri.conf.json"];
const sourceSha256 = Object.fromEntries(await Promise.all(inputs.map(async file => [file, hash(await read(file))])));
const css = `${await read("src/styles.css")}\n${await read("src/ui/paper-theme.css")}`;
const palette = Object.fromEntries([...css.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)].map(([, key, color]) => [key, color.toLowerCase()]));
const property = (selector, name) => {
  let value;
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(",").some(s => s.trim() === selector)) continue;
    const found = body.match(new RegExp(`(?:^|;)\\s*${name}:\\s*([^;]+)`));
    if (found) value = found[1].trim();
  }
  if (!value) fail(`Missing colour declaration: ${selector} ${name}`);
  return palette[value.match(/^var\((--[\w-]+)\)$/)?.[1]] || value;
};
const motion = (await read("src/voice/motion.js")).toString();
const motionColor = name => motion.match(new RegExp(`const ${name} = "(#[0-9a-f]{6})"`))?.[1] || fail(`Missing HUD colour: ${name}`);
const config = await json("src-tauri/tauri.conf.json");
const baseline = {
  schemaVersion: 1,
  reference: "WithType paper theme, approved direction 2026-10-14",
  colorSpace: "CSS sRGB",
  palette,
  componentColors: { hero: property(".hero-card", "background"), answerHeader: property(".answer-card header", "background"), answerQuestion: property(".answer-question", "background"), followup: property(".answer-followup", "background"), preview: property(".preview-box", "background"), hudInk: motionColor("INK"), hudSoftInk: motionColor("SOFT_INK"), hudMotionPaper: motionColor("PAPER") },
  font,
  cssColorScheme: "only light",
  windows: config.app.windows.map(({ label, theme, backgroundColor, transparent = false, width, height }) => ({ label, theme, backgroundColor, transparent, width, height })),
  sourceSha256,
};

if (process.argv.includes("--write")) {
  await writeFile(path.join(root, "public/appearance-baseline.json"), `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write("Recorded appearance-baseline.json; bundled font checksum verified.\n");
} else if (process.argv.includes("--built")) {
  const recorded = await json("dist/client/appearance-baseline.json");
  if (JSON.stringify(recorded) !== JSON.stringify(baseline)) fail("Appearance baseline is stale; rebuild the frontend.");
  if (hash(await read(`dist/client/fonts/${font.file}`)) !== font.woff2Sha256) fail("Production font is missing or differs from the source font.");
  for (const file of ["OFL-NotoSansSC.txt", "COPYRIGHT-NotoSansSC.txt"]) {
    if (hash(await read(`dist/client/fonts/${file}`)) !== hash(await read(`public/fonts/${file}`))) fail(`Production font attribution differs: ${file}`);
  }
  const assets = await readdir(path.join(root, "dist/client/assets"));
  const cssAssets = assets.filter(file => file.endsWith(".css"));
  if (!cssAssets.length) fail("Production CSS is missing.");
  const builtCss = (await Promise.all(cssAssets.map(file => read(`dist/client/assets/${file}`)))).join("\n");
  for (const [token, color] of Object.entries(palette)) {
    const rendered = [...builtCss.matchAll(new RegExp(`${token}:\\s*([^;}]+)`, "g"))].at(-1)?.[1];
    if (!rendered || normalizeHex(rendered) !== normalizeHex(color)) fail(`Production palette differs: ${token}`);
  }
  if (!builtCss.includes(font.file) || !builtCss.includes("color-scheme:only light")) fail("Production font or fixed light scheme is missing.");
  const builtIndex = (await read("dist/client/index.html")).toString();
  if (!builtIndex.includes(font.file) || !builtIndex.includes('content="only light"')) fail("Production font preload or early colour scheme is missing.");
  const artifactSha256 = Object.fromEntries(await Promise.all(assets.filter(file => /\.(css|js)$/.test(file)).map(async file => [file, hash(await read(`dist/client/assets/${file}`))])));
  process.stdout.write(`${JSON.stringify({ ok: true, fontSha256: font.woff2Sha256, paletteTokens: Object.keys(palette).length, artifactSha256 }, null, 2)}\n`);
} else fail("Use --write before build, or --built to verify its output.");
