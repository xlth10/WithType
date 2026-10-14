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

test("release executable uses the Windows GUI subsystem", async () => {
  const main = await read("src-tauri/src/main.rs");
  assert.match(main, /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/);
});

test("visible product identity matches the frontend and native windows while saved identity remains compatible", async () => {
  assert.equal(config.productName, BRAND.name);
  assert.equal(config.mainBinaryName, "withtype");
  assert.equal(config.identifier, "app.typefree.windows.unofficial");
  assert.equal(config.app.windows.find((window) => window.label === "main").title, BRAND.name);
  assert.ok(config.app.windows.every((window) => window.title.startsWith(BRAND.name)));
  assert.ok((await read("index.html")).includes(`<title>${BRAND.name}</title>`));
  const app = await read("src/App.jsx");
  assert.match(app, /<strong>\{BRAND.name\}<\/strong>/);
  assert.doesNotMatch(app, /非官方/);
  assert.ok((await read("src-tauri/src/lib.rs")).includes(`.tooltip("${BRAND.name}")`));
  assert.match(await read("src-tauri/src/lib.rs"), /const SERVICE_NAME: &str = "app\.typefree\.windows\.unofficial"/);
});

test("model settings keep only actionable guidance", async () => {
  const app = await read("src/App.jsx");
  const textSettings = await read("src/components/TextSettings.jsx");
  for (const redundantCopy of [
    "让声音与文字接上服务",
    "在一页配置语音识别和文字处理",
    "01 · 从声音到文字",
    "语音输入、随便问和技能都先在这里转写录音",
    "上传 16 kHz 单声道 PCM16 WAV",
  ]) assert.ok(!app.includes(redundantCopy), `redundant copy remains: ${redundantCopy}`);
  for (const redundantCopy of [
    "02 · 从文字到成稿",
    "智能整理、随便问、翻译和技能使用这里的服务",
    "使用 /chat/completions",
  ]) assert.ok(!textSettings.includes(redundantCopy), `redundant copy remains: ${redundantCopy}`);
});

test("recoverable recordings render after the active page content", async () => {
  const app = await read("src/App.jsx");
  const css = await read("src/styles.css");
  const overview = app.slice(app.indexOf("function Overview("), app.indexOf("export function App()"));
  const lastResult = overview.indexOf('className="last-result panel"');
  const recoverableRecordings = overview.indexOf("{recoverableAudio.filter");
  assert.ok(lastResult >= 0, "latest result section was not found");
  assert.ok(recoverableRecordings > lastResult, "recoverable recordings must be the final overview section");
  assert.match(css, /\.overview > \.failure-panel \{ margin-top: 12px; margin-bottom: 0; \}/);
});

test("voice HUD keeps status accessible while background phases remain visible", async () => {
  const app = await read("src/App.jsx");
  assert.doesNotMatch(app, /口述中/);
  assert.doesNotMatch(app, /className="hud-status"/);
  assert.match(app, /className="sr-only" role="status"/);
  assert.match(app, /phase === "background-unavailable"/);
  assert.match(app, /className="hud-badge"/);
});

test("Escape is registered only for an active voice task and reuses cancellation", async () => {
  const rust = await read("src-tauri/src/lib.rs");
  assert.match(rust, /fn set_interaction_active\(/);
  assert.match(rust, /global_shortcut\(\)\.register\("Escape"\)/);
  assert.match(rust, /matches_shortcut\(shortcut, "Escape"\)/);
  assert.match(rust, /background::trigger\(app, "cancel-recording"\)/);
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
  assert.match(portable, /withtype-windows-x64-portable\.zip/);
  assert.match(portable, /\$members = @\([^\n]*\$fontLicenseDestination, \$fontCopyrightDestination, \$fontManifestDestination, \$appearanceDestination\)/);
  assert.match(await read(".github/workflows/build-windows.yml"), /dist\/windows\/withtype-windows-x64-portable\.zip/);
});
