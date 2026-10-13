from pathlib import Path
import json
r=Path('/private/tmp/typefree-desktop-stage')
p=r/'src/App.jsx';s=p.read_text().replace('<strong>Typefree Windows</strong>','<strong>typefree</strong>')
s=s.replace('{isTauri() && <Field label="麦克风"','{<Field label="麦克风"').replace('<select value={settings.audioDeviceId || ""} onChange=', '<select value={settings.audioDeviceId || ""} disabled={!isTauri()} onChange=')
p.write_text(s)
p=r/'index.html';s=p.read_text().replace('<title>Typefree Windows · 非官方</title>','<title>typefree</title>');s=s.replace('<link rel="icon"','<link rel="preload" href="/fonts/noto-sans-sc-variable.woff2" as="font" type="font/woff2" crossorigin />\n    <link rel="icon"');p.write_text(s)
p=r/'src/styles.css';s=p.read_text();s='''/* Bundled font: identical glyphs and weight metrics in browser and WebView2. */
@font-face {
  font-family: "Typefree UI";
  src: url("/fonts/noto-sans-sc-variable.woff2") format("woff2");
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
}
'''+s
s=s.replace('font-family: "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", ui-sans-serif, sans-serif;', '--font-ui: "Typefree UI", "Segoe UI", "Microsoft YaHei UI", sans-serif;\n  font-family: var(--font-ui);')
s=s.replace('ui-monospace, SFMono-Regular, Consolas, monospace','var(--font-ui)').replace('"Cascadia Code", Consolas, monospace','var(--font-ui)')
s+='''
/* Native system scrollbars must not change the ink/paper surfaces. */
* { scrollbar-width: thin; scrollbar-color: #c5cabd transparent; }
*::-webkit-scrollbar { width: 7px; height: 7px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: #c5cabd; border-radius: 8px; }
.shortcut-record span, .shortcut-key, .hero-actions kbd { font-variant-numeric: tabular-nums; }
''';p.write_text(s)
p=r/'src-tauri/tauri.conf.json';j=json.loads(p.read_text())
for w in j['app']['windows']:
 w['title']={'main':'typefree','overlay':'typefree · 录音','answer':'typefree · 随便问'}[w['label']];w['theme']='Light';w['zoomHotkeysEnabled']=False;w['backgroundColor']='#f8f9f4' if w['label']=='main' else '#00000000'
j['bundle']['shortDescription']='typefree 非官方语音输入版';j['bundle']['resources']['../public/fonts/OFL-NotoSansSC.txt']='LICENSES/OFL-NotoSansSC.txt';j['bundle']['resources']['../public/fonts/COPYRIGHT-NotoSansSC.txt']='LICENSES/COPYRIGHT-NotoSansSC.txt';p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=r/'src-tauri/capabilities/default.json';s=p.read_text().replace('Typefree Windows desktop permissions','typefree desktop permissions');p.write_text(s)
p=r/'src-tauri/src/lib.rs';s=p.read_text().replace('退出 Typefree Windows','退出 typefree').replace('.tooltip("Typefree Windows · 非官方")','.tooltip("typefree")').replace('failed to run Typefree Windows','failed to run typefree')
s=s.replace('let geometry = floating::geometry(\n        floating::WorkArea {','let area = floating::WorkArea {').replace('            scale: monitor.scale_factor(),\n        },\n        surface,\n    );','            scale: monitor.scale_factor(),\n        };\n    let mut geometry = floating::geometry(area, surface);')
old='''        (
            geometry
                .width
                .saturating_sub(outer.width.saturating_sub(inner.width))
                .max(1),
            geometry
                .height
                .saturating_sub(outer.height.saturating_sub(inner.height))
                .max(1),
        )'''
new='''        let frame_width = outer.width.saturating_sub(inner.width);
        let frame_height = outer.height.saturating_sub(inner.height);
        geometry = floating::main_geometry(area, frame_width, frame_height);
        (
            geometry.width.saturating_sub(frame_width).max(1),
            geometry.height.saturating_sub(frame_height).max(1),
        )'''
assert old in s;s=s.replace(old,new)
s=s.replace('// The main window has native borders/title bar. Its total rectangle, not\n    // just the WebView, must fit inside the work area on a scaled laptop screen.','// Preserve the 1060×720 logical WebView content area when it fits. Native\n    // borders are additional space; only shrink content when the total window\n    // would exceed the target work area (e.g. a high-DPI laptop).')
s=s.replace('if let Some(main) = app.get_webview_window("main") {\n                if let Some(monitor)', 'if let Some(main) = app.get_webview_window("main") {\n                main.set_zoom(1.0)?;\n                if let Some(monitor)')
p.write_text(s)
p=r/'src-tauri/src/floating.rs';s=p.read_text();s=s.replace('pub fn geometry(area: WorkArea, surface: Surface) -> Geometry {','''pub fn geometry(area: WorkArea, surface: Surface) -> Geometry {
    geometry_with_frame(area, surface, 0, 0)
}

/// Main design dimensions refer to the CSS content viewport. Frame dimensions
/// are measured physical pixels, and are added before clamping/centering.
pub fn main_geometry(area: WorkArea, frame_width: u32, frame_height: u32) -> Geometry {
    geometry_with_frame(area, Surface::Main, frame_width, frame_height)
}

fn geometry_with_frame(area: WorkArea, surface: Surface, frame_width: u32, frame_height: u32) -> Geometry {''')
s=s.replace('let width = pixels(design_width)\n        .min','let width = pixels(design_width)\n        .saturating_add(frame_width)\n        .min').replace('let height = pixels(design_height)\n        .min','let height = pixels(design_height)\n        .saturating_add(frame_height)\n        .min')
s+='''
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_preserves_the_design_content_viewport_at_each_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = WorkArea { x: -4096, y: -180, width: 4096, height: 3000, scale };
            let frame_width = (16.0 * scale) as u32;
            let frame_height = (39.0 * scale) as u32;
            let rect = main_geometry(area, frame_width, frame_height);
            assert_eq!(rect.width - frame_width, (MAIN_WIDTH * scale).round() as u32);
            assert_eq!(rect.height - frame_height, (MAIN_HEIGHT * scale).round() as u32);
            assert!(rect.x < 0);
            assert!(rect.x >= area.x && rect.y >= area.y);
            assert!(rect.x as i64 + rect.width as i64 <= area.x as i64 + area.width as i64);
            assert!(rect.y as i64 + rect.height as i64 <= area.y as i64 + area.height as i64);
        }
    }

    #[test]
    fn small_scaled_work_area_clamps_the_entire_main_window() {
        let area = WorkArea { x: -1280, y: 36, width: 1280, height: 684, scale: 2.0 };
        let rect = main_geometry(area, 32, 78);
        assert_eq!((rect.width, rect.height), (1184, 588));
        assert!(rect.width - 32 < (MAIN_WIDTH * area.scale) as u32);
        assert!(rect.x >= area.x && rect.y >= area.y);
        assert!(rect.x as i64 + rect.width as i64 <= area.x as i64 + area.width as i64);
        assert!(rect.y as i64 + rect.height as i64 <= area.y as i64 + area.height as i64);
    }

    #[test]
    fn borderless_surfaces_keep_their_css_sizes_and_work_area_placement() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = WorkArea { x: -2560, y: 60, width: 2560, height: 1380, scale };
            let hud = geometry(area, Surface::Hud);
            let card = geometry(area, Surface::Card);
            assert_eq!(hud.width, (HUD_WIDTH * scale).round() as u32);
            assert_eq!(hud.height, (HUD_HEIGHT * scale).round() as u32);
            assert_eq!(card.width, (CARD_WIDTH * scale).round() as u32);
            assert_eq!(card.height, (CARD_HEIGHT * scale).round() as u32);
            assert_eq!(hud.x, area.x + ((area.width - hud.width) / 2) as i32);
            assert!(hud.y as i64 + hud.height as i64 < area.y as i64 + area.height as i64);
        }
    }
}
''';p.write_text(s)
for name in ['package.json','package-lock.json']:
 p=r/name;j=json.loads(p.read_text());j['name']='typefree'
 if 'packages' in j:j['packages']['']['name']='typefree'
 p.write_text(json.dumps(j,ensure_ascii=False,indent=2)+'\n')
p=r/'README.md';s=p.read_text().replace('# Typefree Windows（非官方开发版）','# typefree（非官方开发版）').replace('typefree-windows-x64-portable.zip','typefree-x64-portable.zip');s+='\n## 网页与桌面显示一致性\n\n网页预览和桌面主窗、HUD、问答卡片均使用 `src/main.jsx` → `App.jsx`、同一 CSS 与资源；生产桌面端加载 `dist/client`。随包提供 Noto Sans SC 可变字体（含许可），统一字形与字重，并统一滚动条样式。三窗浅色主题、缩放 1.0；主窗正常工作区的内容区为 1060×720 逻辑像素，标题栏和边框额外计算，小工作区再缩小以保证整窗可见。\n\n应用显示名称统一为 `typefree`；保留原应用标识与凭据项，现有配置/历史可继续读取。浏览器没有原生麦克风列表、快捷键和凭据功能时只禁用对应控件，桌面显示真实设备与状态。实现与验证边界见 [桌面前端一致性记录](docs/design/desktop-parity-2026-10-10.md)。\n';p.write_text(s)
p=r/'scripts/package-windows.ps1';s=p.read_text().replace('typefree-windows-x64','typefree-x64').replace('Typefree Windows (unofficial) - x64 portable package','typefree (unofficial) - Windows x64 portable package');s=s.replace(".Replace('LICENSES/Typefree-GPL-3.0.txt', 'Typefree-GPL-3.0.txt')", ".Replace('LICENSES/Typefree-GPL-3.0.txt', 'Typefree-GPL-3.0.txt').Replace('public/fonts/OFL-NotoSansSC.txt', 'OFL-NotoSansSC.txt').Replace('public/fonts/COPYRIGHT-NotoSansSC.txt', 'COPYRIGHT-NotoSansSC.txt')")
s=s.replace("$readmePath = Join-Path $stagingPath 'README.txt'", "Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../public/fonts/OFL-NotoSansSC.txt') -Destination (Join-Path $stagingPath 'OFL-NotoSansSC.txt') -Force\nCopy-Item -LiteralPath (Join-Path $PSScriptRoot '../public/fonts/COPYRIGHT-NotoSansSC.txt') -Destination (Join-Path $stagingPath 'COPYRIGHT-NotoSansSC.txt') -Force\n\n$readmePath = Join-Path $stagingPath 'README.txt'")
p.write_text(s)
p=r/'.github/workflows/build-windows.yml';s=p.read_text().replace('Typefree-Windows-portable-x64','typefree-portable-x64').replace('Typefree-Windows-installers','typefree-installers').replace('typefree-windows-x64-portable.zip','typefree-x64-portable.zip');p.write_text(s)
p=r/'THIRD_PARTY_NOTICES.md';s=p.read_text();s+='\n- 界面字体使用 [Noto Sans SC](https://github.com/notofonts/noto-cjk)，固定 `Sans2.004` 中的 `NotoSansSC-VF.ttf`，转换为 WOFF2 容器，保留全部字形与原元数据；遵循 [SIL Open Font License 1.1](public/fonts/OFL-NotoSansSC.txt)。版权声明见 [COPYRIGHT-NotoSansSC.txt](public/fonts/COPYRIGHT-NotoSansSC.txt)，来源与 SHA-256 见 `public/fonts/manifest.json`。字体原作者归属保留，不作为本项目原创素材。\n';p.write_text(s)
p=r/'research.md';s=p.read_text();s+='\n## 2026-10-10 桌面前端一致性与命名\n\n用户要求网页前端在 Windows 桌面完整复刻，显示名统一为 `typefree` 并提交推送。源码审查确认两端共用入口/CSS；系统字体及主窗边框扣除会改变文本度量与内容区尺寸。使用官方 Noto CJK Sans2.004 字体（SIL OFL，原字形保留），网页与 WebView2 共用离线 WOFF2；主窗按内容区设计尺寸加边框再钳制工作区，所有窗固定浅色/1.0 缩放。新增一致性契约与 DPI 几何检查。\n\n用户界面、原生标题栏/托盘和产品名统一 `typefree`；原应用标识、存储和凭据保留以避免数据迁移。当前宿主机为 macOS，构建/契约/逻辑检查不能替代 Windows 实机透明、DPI 和字体渲染验收。\n';p.write_text(s)
