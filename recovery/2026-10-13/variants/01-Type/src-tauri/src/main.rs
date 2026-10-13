// 与 Tauri 官方模板一致：release 构建不分配控制台窗口，
// 调试构建保留控制台以便查看日志。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    typefree_windows_lib::run();
}
