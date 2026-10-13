#![allow(dead_code, unused_imports)]
#[derive(serde::Serialize)]
pub struct TranscribeResponse { pub text: String, pub duration_ms: u128 }
pub async fn transcribe_bytes_with_cancel(_: Vec<u8>, _: String, _: &str, _: String, _: String, _: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>) -> Result<TranscribeResponse, String> { Err("compile only".into()) }
mod history {
    pub fn protect_data(_: &[u8]) -> Result<Vec<u8>, String> { Err("compile only".into()) }
    pub fn unprotect_data(_: &[u8]) -> Result<Vec<u8>, String> { Err("compile only".into()) }
}
mod background {
    pub fn require_task(_: &tauri::AppHandle, _: &str) -> Result<(), String> { Ok(()) }
    pub fn system_pause(_: &tauri::AppHandle, _: bool, _: bool) {}
    pub fn stop(_: &tauri::AppHandle) {}
    #[path = "/Users/outsider/codex_projects/emergence-lab/projects/15-typefree-windows/src-tauri/src/background/windows_events.rs"]
    pub mod windows_events;
}
#[path = "/Users/outsider/codex_projects/emergence-lab/projects/15-typefree-windows/src-tauri/src/startup.rs"]
mod startup;
#[path = "/Users/outsider/codex_projects/emergence-lab/projects/15-typefree-windows/src-tauri/src/audio.rs"]
mod audio;
