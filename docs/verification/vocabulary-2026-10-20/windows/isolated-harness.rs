#![allow(dead_code)]
#[path = "/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype/src-tauri/src/card_position.rs"]
mod card_position;
#[path = "/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype/src-tauri/src/uia.rs"]
mod uia;
#[path = "/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype/src-tauri/src/delivery.rs"]
mod delivery;
#[path = "/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype/src-tauri/src/correction_monitor.rs"]
mod correction_monitor;
#[path = "/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype/src-tauri/src/vocabulary.rs"]
mod vocabulary;

#[path = "/Users/outsider/.codex/worktrees/withtype-pipeline-macos/15-withtype/src-tauri/src/history.rs"]
mod history;
fn debug_log(_: &str) {}
mod skills {
    pub fn write_atomic(_: &std::path::Path, _: &[u8]) -> Result<(), String> { unimplemented!("compile-only boundary") }
}
pub fn registered_commands() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![
        history::load_history,
        history::save_history,
        history::export_history,
        correction_monitor::stop_learning_monitor,
        correction_monitor::get_vocabulary_learning_capability,
        vocabulary::load_vocabulary,
        vocabulary::save_vocabulary,
        vocabulary::export_vocabulary_csv,
    ])
}
