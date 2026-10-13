pub use macros::command;
#[derive(Clone)]
pub struct AppHandle;
pub trait Manager { fn path(&self) -> Resolver { Resolver } }
impl Manager for AppHandle {}
pub struct Resolver;
impl Resolver { pub fn app_config_dir(&self) -> Result<std::path::PathBuf, String> { Ok(std::path::PathBuf::new()) } }
pub trait Emitter { fn emit<S: serde::Serialize>(&self, _: &str, _: S) -> Result<(), String> { Ok(()) } }
impl Emitter for AppHandle {}
pub mod async_runtime {
    pub use tokio::task::spawn_blocking;
    pub fn block_on<F: std::future::Future>(future: F) -> F::Output { tokio::runtime::Runtime::new().unwrap().block_on(future) }
}
