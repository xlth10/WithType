//! Encrypted history. Existing WebView localStorage is migrated by
//! the frontend only after this store has been read successfully.

#[cfg(any(windows, target_os = "macos", test))]
mod worker {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    pub(super) const TIMEOUT: Duration = Duration::from_secs(3);
    const TIMED_OUT: &str = "受保护历史读取或保存超时，原历史已保留，请稍后重试";

    #[derive(Default)]
    pub(super) struct Executor {
        busy: Arc<AtomicBool>,
    }
    struct Permit(Arc<AtomicBool>);
    impl Drop for Permit {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    pub(super) struct Budget {
        cancelled: Arc<AtomicBool>,
        deadline: Instant,
    }
    impl Budget {
        pub(super) fn check(&self) -> Result<(), String> {
            if self.cancelled.load(Ordering::SeqCst) || Instant::now() >= self.deadline {
                return Err(TIMED_OUT.into());
            }
            Ok(())
        }
    }
    impl Executor {
        pub(super) async fn run<T, F>(&self, timeout: Duration, operation: F) -> Result<T, String>
        where
            T: Send + 'static,
            F: FnOnce(&Budget) -> Result<T, String> + Send + 'static,
        {
            if self
                .busy
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_err()
            {
                return Err("受保护历史操作仍在等待系统响应，请稍后重试".into());
            }
            let permit = Permit(self.busy.clone());
            let cancelled = Arc::new(AtomicBool::new(false));
            let budget = Budget {
                cancelled: cancelled.clone(),
                deadline: Instant::now() + timeout,
            };
            let task = tauri::async_runtime::spawn_blocking(move || {
                // Keep the permit until a potentially stuck system call exits.
                let _permit = permit;
                budget.check()?;
                let result = operation(&budget);
                budget.check()?;
                result
            });
            match tokio::time::timeout(timeout, task).await {
                Ok(result) => {
                    result.map_err(|_| "受保护历史操作未完成，原历史已保留".to_string())?
                }
                Err(_) => {
                    cancelled.store(true, Ordering::SeqCst);
                    Err(TIMED_OUT.into())
                }
            }
        }
    }
}

#[cfg(any(windows, target_os = "macos"))]
mod platform {
    use super::worker::{Budget, Executor, TIMEOUT};
    use serde::{Deserialize, Serialize};
    use std::{
        fs,
        io::Write,
        path::PathBuf,
        sync::OnceLock,
        time::{SystemTime, UNIX_EPOCH},
    };
    use tauri::{AppHandle, Manager};
    #[cfg(windows)]
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::Cryptography::{
            CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
        },
    };

    #[cfg(target_os = "macos")]
    pub(crate) use crate::macos_crypto::{protect_data, unprotect_data};

    const MAGIC: &[u8; 4] = b"TFH1";
    const MAX_FILE_BYTES: usize = 5 * 1024 * 1024;

    fn executor() -> &'static Executor {
        static EXECUTOR: OnceLock<Executor> = OnceLock::new();
        EXECUTOR.get_or_init(Executor::default)
    }

    #[derive(Serialize, Deserialize)]
    struct HistoryFile {
        version: u32,
        entries: Vec<serde_json::Value>,
    }

    #[cfg(windows)]
    pub(crate) fn protect_data(plain: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(plain.len()).map_err(|_| "数据过长")?,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let result = unsafe {
            CryptProtectData(
                &input,
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 {
            return Err(format!(
                "Windows 数据保护失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            LocalFree(output.pbData.cast());
        }
        Ok(bytes)
    }

    #[cfg(windows)]
    pub(crate) fn unprotect_data(cipher: &[u8]) -> Result<Vec<u8>, String> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: u32::try_from(cipher.len()).map_err(|_| "数据过长")?,
            pbData: cipher.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        let result = unsafe {
            CryptUnprotectData(
                &input,
                std::ptr::null_mut(),
                std::ptr::null(),
                std::ptr::null(),
                std::ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output,
            )
        };
        if result == 0 {
            return Err(format!(
                "Windows 数据解密失败：{}",
                std::io::Error::last_os_error()
            ));
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
        unsafe {
            LocalFree(output.pbData.cast());
        }
        Ok(bytes)
    }

    fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
        let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        Ok(directory.join("history.enc"))
    }

    fn read_file(path: &PathBuf, budget: &Budget) -> Result<Vec<serde_json::Value>, String> {
        budget.check()?;
        let encrypted = fs::read(path).map_err(|e| format!("读取历史失败：{e}"))?;
        if encrypted.len() > MAX_FILE_BYTES || !encrypted.starts_with(MAGIC) {
            return Err("历史文件格式无效".into());
        }
        let plain = unprotect_data(&encrypted[MAGIC.len()..])?;
        budget.check()?;
        let file: HistoryFile =
            serde_json::from_slice(&plain).map_err(|e| format!("历史文件解析失败：{e}"))?;
        if file.version != 1 {
            return Err("历史文件版本暂不支持".into());
        }
        Ok(file.entries)
    }

    fn load_history_sync(
        app: &AppHandle,
        budget: &Budget,
    ) -> Result<Option<Vec<serde_json::Value>>, String> {
        budget.check()?;
        let path = history_path(&app)?;
        let backup = path.with_extension("bak");
        if path.exists() {
            return read_file(&path, budget)
                .or_else(|primary_error| {
                    budget.check()?;
                    if backup.exists() {
                        read_file(&backup, budget)
                    } else {
                        Err(primary_error)
                    }
                })
                .map(Some);
        }
        if backup.exists() {
            return read_file(&backup, budget).map(Some);
        }
        Ok(None)
    }

    #[tauri::command]
    pub async fn load_history(app: AppHandle) -> Result<Option<Vec<serde_json::Value>>, String> {
        executor()
            .run(TIMEOUT, move |budget| load_history_sync(&app, budget))
            .await
    }

    fn time_ms(entry: &serde_json::Value) -> Option<u64> {
        entry.get("savedAt").and_then(|v| v.as_u64()).or_else(|| {
            entry
                .get("id")
                .and_then(|v| v.as_str())?
                .split('-')
                .next()?
                .parse()
                .ok()
        })
    }

    fn save_history_sync(
        app: AppHandle,
        entries: Vec<serde_json::Value>,
        retention_days: u32,
        budget: &Budget,
    ) -> Result<(), String> {
        budget.check()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        let cutoff = now.saturating_sub(retention_days.min(365) as u64 * 86_400_000);
        let entries: Vec<_> = entries
            .into_iter()
            .filter(|entry| {
                retention_days == 0 || time_ms(entry).map_or(true, |when| when >= cutoff)
            })
            .take(50)
            .collect();
        let plain = serde_json::to_vec(&HistoryFile {
            version: 1,
            entries,
        })
        .map_err(|e| e.to_string())?;
        if plain.len() > MAX_FILE_BYTES / 2 {
            return Err("历史记录超过本地容量限制".into());
        }
        let path = history_path(&app)?;
        let backup = path.with_extension("bak");
        // A missing/inaccessible old key must never generate a new key and
        // replace an existing encrypted store. A new installation keeps its
        // existing first-save behavior only when neither store exists.
        if path.exists() {
            read_file(&path, budget)?;
        } else if backup.exists() {
            read_file(&backup, budget)?;
        }
        budget.check()?;
        let mut encrypted = MAGIC.to_vec();
        encrypted.extend_from_slice(&protect_data(&plain)?);
        // SecurityServer may return long after the IPC timed out. Never allow
        // that abandoned request to commit an old snapshot afterwards.
        budget.check()?;
        write_history_file(&path, &encrypted, budget, |temp| {
            read_file(temp, budget).map(|_| ())
        })
    }

    fn write_history_file(
        path: &PathBuf,
        encrypted: &[u8],
        budget: &Budget,
        verify: impl FnOnce(&PathBuf) -> Result<(), String>,
    ) -> Result<(), String> {
        budget.check()?;
        let temp = path.with_extension("new");
        struct TempFile(PathBuf);
        impl Drop for TempFile {
            fn drop(&mut self) {
                let _ = fs::remove_file(&self.0);
            }
        }
        let _temp_cleanup = TempFile(temp.clone());
        let backup = path.with_extension("bak");
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&encrypted).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        budget.check()?;
        verify(&temp)?;
        budget.check()?;
        if path.exists() {
            fs::copy(&path, &backup).map_err(|e| format!("保留历史备份失败：{e}"))?;
            budget.check()?;
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        if let Err(error) = fs::rename(&temp, &path) {
            if backup.exists() {
                let _ = fs::copy(&backup, &path);
            }
            return Err(format!("保存历史失败：{error}"));
        }
        Ok(())
    }

    #[tauri::command]
    pub async fn save_history(
        app: AppHandle,
        entries: Vec<serde_json::Value>,
        retention_days: u32,
    ) -> Result<(), String> {
        executor()
            .run(TIMEOUT, move |budget| {
                save_history_sync(app, entries, retention_days, budget)
            })
            .await
    }

    fn export_history_sync(app: AppHandle, budget: &Budget) -> Result<String, String> {
        let entries = load_history_sync(&app, budget)?.unwrap_or_default();
        budget.check()?;
        let directory = app.path().document_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let path = directory.join(format!("withtype-history-{stamp}.json"));
        budget.check()?;
        fs::write(
            &path,
            serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    }

    #[tauri::command]
    pub async fn export_history(app: AppHandle) -> Result<String, String> {
        executor()
            .run(TIMEOUT, move |budget| export_history_sync(app, budget))
            .await
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::{
            sync::mpsc,
            time::{Duration, Instant},
        };

        #[tokio::test]
        async fn blocked_protected_store_times_out_without_late_writes_or_worker_accumulation() {
            let directory = std::env::temp_dir().join(format!(
                "withtype-history-timeout-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&directory).unwrap();
            let path = directory.join("history.enc");
            let original = b"TFH1-original-ciphertext";
            fs::write(&path, original).unwrap();
            let worker = Executor::default();
            let (release_tx, release_rx) = mpsc::channel();
            let (finished_tx, finished_rx) = mpsc::channel();
            let saved_path = path.clone();
            let started = Instant::now();
            let result = worker
                .run(Duration::from_millis(30), move |budget| {
                    // Simulates SecurityServer returning after the IPC timeout.
                    let _ = release_rx.recv_timeout(Duration::from_secs(2));
                    let result =
                        write_history_file(&saved_path, b"TFH1-stale-snapshot", budget, |_| Ok(()));
                    let _ = finished_tx.send(());
                    result
                })
                .await;
            assert!(result.unwrap_err().contains("超时"));
            assert!(started.elapsed() < Duration::from_secs(1));
            assert!(worker
                .run(Duration::from_secs(1), |_| Ok(()))
                .await
                .unwrap_err()
                .contains("仍在等待"));
            release_tx.send(()).unwrap();
            finished_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            assert_eq!(fs::read(&path).unwrap(), original);
            assert!(!path.with_extension("new").exists());
            assert!(!path.with_extension("bak").exists());
            fs::remove_dir_all(directory).unwrap();
        }

        #[tokio::test]
        async fn expiry_during_encrypted_temp_verification_preserves_the_primary_and_backup() {
            let directory = std::env::temp_dir().join(format!(
                "withtype-history-verify-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&directory).unwrap();
            let path = directory.join("history.enc");
            fs::write(&path, b"TFH1-primary").unwrap();
            fs::write(path.with_extension("bak"), b"TFH1-backup").unwrap();
            let (release_tx, release_rx) = mpsc::channel();
            let (finished_tx, finished_rx) = mpsc::channel();
            let saved_path = path.clone();
            let result = Executor::default()
                .run(Duration::from_millis(30), move |budget| {
                    let result = write_history_file(&saved_path, b"TFH1-new", budget, |_| {
                        let _ = release_rx.recv_timeout(Duration::from_secs(2));
                        Ok(())
                    });
                    let _ = finished_tx.send(());
                    result
                })
                .await;
            assert!(result.unwrap_err().contains("超时"));
            release_tx.send(()).unwrap();
            finished_rx.recv_timeout(Duration::from_secs(1)).unwrap();
            assert_eq!(fs::read(&path).unwrap(), b"TFH1-primary");
            assert_eq!(
                fs::read(path.with_extension("bak")).unwrap(),
                b"TFH1-backup"
            );
            assert!(!path.with_extension("new").exists());
            fs::remove_dir_all(directory).unwrap();
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use tauri::AppHandle;
    #[tauri::command]
    pub fn load_history(_app: AppHandle) -> Result<Option<Vec<serde_json::Value>>, String> {
        Err("受保护历史仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn save_history(
        _app: AppHandle,
        _entries: Vec<serde_json::Value>,
        _retention_days: u32,
    ) -> Result<(), String> {
        Err("受保护历史仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn export_history(_app: AppHandle) -> Result<String, String> {
        Err("受保护历史仅支持 Windows".into())
    }
}

pub use platform::*;
#[cfg(any(windows, target_os = "macos"))]
pub(crate) use platform::{protect_data, unprotect_data};
