// Release builds are GUI applications; debug builds keep a console for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), dev))]
compile_error!(
    "Use Tauri build or cargo build --features tauri/custom-protocol for release executables."
);

fn main() {
    withtype_windows_lib::run();
}
