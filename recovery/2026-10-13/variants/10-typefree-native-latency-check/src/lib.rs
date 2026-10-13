use std::sync::{Arc, atomic::AtomicBool};
#[derive(serde::Serialize)]
pub struct TranscribeResponse { pub text: String, pub duration_ms: u128 }
pub mod history {
    pub fn protect_data(data: &[u8]) -> Result<Vec<u8>, String> { Ok(data.to_vec()) }
    pub fn unprotect_data(data: &[u8]) -> Result<Vec<u8>, String> { Ok(data.to_vec()) }
}
pub async fn transcribe_bytes_with_cancel(_: Vec<u8>, _: String, _: &str, _: String, _: String, _: Option<Arc<AtomicBool>>) -> Result<TranscribeResponse,String> { Err("typecheck stub".into()) }
#[path = "/Users/outsider/codex_projects/emergence-lab/projects/15-typefree-windows/src-tauri/src/audio.rs"]
pub mod audio;
