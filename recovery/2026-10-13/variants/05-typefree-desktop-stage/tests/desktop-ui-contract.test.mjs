import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

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
  const expected = { main: [1060, 720], overlay: [196, 74], answer: [460, 520] };
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
  const rust = await read("src-tauri/src/lib.rs");
  for (const name of ["main", "overlay", "answer"]) assert.ok(rust.includes(`${name}.set_zoom(1.0)?`));
  assert.match(rust, /floating::main_geometry\(area, frame_width, frame_height\)/);
});

test("display name is typefree while persisted identity remains compatible", async () => {
  assert.equal(config.productName, "typefree");
  assert.equal(config.mainBinaryName, "typefree");
  assert.equal(config.identifier, "app.typefree.windows.unofficial");
  assert.equal(config.app.windows.find((window) => window.label === "main").title, "typefree");
  assert.match(await read("index.html"), /<title>typefree<\/title>/);
  const app = await read("src/App.jsx");
  assert.match(app, /<strong>typefree<\/strong>/);
  assert.doesNotMatch(app, /<strong>Typefree Windows<\/strong>/);
  assert.match(await read("src-tauri/src/lib.rs"), /\.tooltip\("typefree"\)/);
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
  const frontendIcon = "assets/typefree-ink-v2.svg";
  assert.match(await read("src/components/AppIcon.jsx"), /\/assets\/typefree-ink-v2\.svg/);
  assert.match(await read(`public/${frontendIcon}`), /<svg /);
  for (const path of config.bundle.icon) assert.ok((await readFile(new URL(`../src-tauri/${path}`, import.meta.url))).length);
  assert.equal(config.bundle.windows.nsis.installerIcon, "icons/ink-v2/icon.ico");
  assert.equal(config.bundle.resources["../public/fonts/OFL-NotoSansSC.txt"], "LICENSES/OFL-NotoSansSC.txt");
  const portable = await read("scripts/package-windows.ps1");
  assert.match(portable, /typefree-x64-portable\.zip/);
  assert.match(portable, /\$members = @\([^\n]*\$fontLicenseDestination, \$fontCopyrightDestination\)/);
  assert.match(await read(".github/workflows/build-windows.yml"), /dist\/windows\/typefree-x64-portable\.zip/);
});
