# 最终验证

- npm test：147 项通过，无失败或跳过。
- npm run build：通过；Vite 保留原有 >500kB JS 体积提示。
- SVG 已加载于侧栏和回答卡片；favicon、Tauri bundle、托盘/窗口内嵌 ICO 和 NSIS 指向 ink-v3。
- 原 2026-10-10 四个前端修正文件 SHA-256 与交付记录一致，没有覆盖。
- 1024px master 与九个尺寸 PNG 的签名、RGBA、尺寸和透明角通过；ICO 八帧齐全。
- git -c core.whitespace=cr-at-eol diff --check：通过，保留原 CRLF/LF。
- 完整 cargo test --offline --lib 因本机 rsproxy 索引缺少 arboard 未执行成功；不把本轮称为完整 Rust 编译通过。
- 直接对当前 floating.rs 执行 rustc --test：3 项通过，覆盖 100/125/150/200% DPI、负坐标、工作区钳制、HUD/卡片定位。

前端与资产验收不等于 Windows EXE 实机验收。未部署、未打包 Windows EXE、未更改录音或系统焦点边界。
