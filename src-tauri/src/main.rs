// Release builds are GUI applications; debug builds keep a console for logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    withtype_windows_lib::run();
}
