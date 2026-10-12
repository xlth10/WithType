import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { BRAND } from "../src/ui/brand.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(await read("src-tauri/tauri.conf.json"));

// These are source/resource contracts. Native Windows rendering is a separate
// acceptance step; this suite does not pretend to execute WebView2 on macOS.
test("desktop bundles the same Vite frontend used by browser preview", async () => {
  assert.equal(config.build.beforeBuildCommand, "npm run build");
  assert.equal(config.build.frontendDist, "../dist/client");
  assert.match(await read("vite.config.mjs"), /outDir:\s*["']dist\/client["']/);
  const main = await read("src/main.jsx");
  assert.match(main, /import\s+\{\s*App\s*\}\s+from\s+["']\.\/App\.jsx["']/);
  assert.match(main, /import\s+["']\.\/styles\.css["']/);
  assert.match(main, /document\.documentElement\.dataset\.surface\s*=\s*surface/);
});

test("three native windows keep design sizes, light theme and neutral zoom", async () => {
  const expected = { main: [1060, 720], overlay: [140, 64], answer: [460, 520] };
  for (const window of config.app.windows) {
    assert.deepEqual([window.width, window.height], expected[window.label]);
    assert.equal(window.theme, "Light");
    assert.equal(window.zoomHotkeysEnabled, false);
    if (window.label !== "main") {
      assert.equal(window.transparent, true);
      assert.equal(window.shadow, false);
      assert.equal(window.backgroundColor, "#00000000");
    }
  }
  const overlay = config.app.windows.find((window) => window.label === "overlay");
  const floating = await read("src-tauri/src/floating.rs");
  assert.equal(Number(floating.match(/pub const HUD_WIDTH: f64 = ([0-9.]+);/)[1]), overlay.width);
  assert.equal(Number(floating.match(/pub const HUD_HEIGHT: f64 = ([0-9.]+);/)[1]), overlay.height);
  const rust = await read("src-tauri/src/lib.rs");
  for (const name of ["main", "overlay", "answer"]) assert.ok(rust.includes(`${name}.set_zoom(1.0)?`));
  assert.match(rust, /floating::main_geometry\(area, frame_width, frame_height\)/);
});

test("visible product identity matches the frontend and native windows while saved identity remains compatible", async () => {
  assert.equal(config.productName, BRAND.name);
  assert.equal(config.mainBinaryName, "typefree");
  assert.equal(config.identifier, "app.typefree.windows.unofficial");
  assert.equal(config.app.windows.find((window) => window.label === "main").title, BRAND.name);
  assert.ok(config.app.windows.every((window) => window.title.startsWith(BRAND.name)));
  assert.ok((await read("index.html")).includes(`<title>${BRAND.name}</title>`));
  const app = await read("src/App.jsx");
  assert.match(app, /<strong>\{BRAND.name\}<\/strong>/);
  assert.ok((await read("src-tauri/src/lib.rs")).includes(`.tooltip("${BRAND.name}")`));
  assert.match(await read("src-tauri/src/lib.rs"), /const SERVICE_NAME: &str = "app\.typefree\.windows\.unofficial"/);
});

test("offline variable font ships intact with its license and preload", async () => {
  const manifest = JSON.parse(await read("public/fonts/manifest.json"));
  const bytes = await readFile(new URL(`../public/fonts/${manifest.file}`, import.meta.url));
  assert.equal(bytes.subarray(0, 4).toString("ascii"), "wOF2");
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.woff2Sha256);
  assert.deepEqual(manifest.weightRange, [100, 900]);
  assert.match(await read("public/fonts/OFL-NotoSansSC.txt"), /SIL OPEN FONT LICENSE/);
  assert.match(await read("src/styles.css"), /font-family:\s*"Typefree UI"/);
  assert.match(await read("index.html"), /href="\/fonts\/noto-sans-sc-variable\.woff2" as="font"/);
});

test("icons, font licenses and portable archive paths stay in sync", async () => {
  const frontendIcon = "assets/typefree-ink-v3.svg";
  assert.match(await read("src/components/AppIcon.jsx"), /\/assets\/typefree-ink-v3\.svg/);
  assert.match(await read(`public/${frontendIcon}`), /<svg /);
  for (const path of config.bundle.icon) assert.ok((await readFile(new URL(`../src-tauri/${path}`, import.meta.url))).length);
  assert.equal(config.bundle.windows.nsis.installerIcon, "icons/ink-v3/icon.ico");
  assert.equal(config.bundle.resources["../public/fonts/OFL-NotoSansSC.txt"], "LICENSES/OFL-NotoSansSC.txt");
  assert.match(await read("index.html"), /href="\/assets\/typefree-ink-v3\.svg"/);
  assert.match(await read("src-tauri/src/lib.rs"), /include_bytes!\("\.\.\/icons\/ink-v3\/icon\.ico"\)/);
  assert.ok(config.bundle.icon.every((path) => path.startsWith("icons/ink-v3/")));
  const portable = await read("scripts/package-windows.ps1");
  assert.match(portable, /typefree-x64-portable\.zip/);
  assert.match(portable, /\$members = @\([^\n]*\$fontLicenseDestination, \$fontCopyrightDestination\)/);
  assert.match(await read(".github/workflows/build-windows.yml"), /dist\/windows\/typefree-x64-portable\.zip/);
});
