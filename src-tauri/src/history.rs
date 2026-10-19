//! Encrypted history on Windows. Existing WebView localStorage is migrated by
//! the frontend only after this store has been read successfully.

#[cfg(any(windows, target_os = "macos"))]
mod platform {
    use serde::{Deserialize, Serialize};
    use std::{
        fs,
        io::Write,
        path::PathBuf,
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

    fn read_file(path: &PathBuf) -> Result<Vec<serde_json::Value>, String> {
        let encrypted = fs::read(path).map_err(|e| format!("读取历史失败：{e}"))?;
        if encrypted.len() > MAX_FILE_BYTES || !encrypted.starts_with(MAGIC) {
            return Err("历史文件格式无效".into());
        }
        let plain = unprotect_data(&encrypted[MAGIC.len()..])?;
        let file: HistoryFile =
            serde_json::from_slice(&plain).map_err(|e| format!("历史文件解析失败：{e}"))?;
        if file.version != 1 {
            return Err("历史文件版本暂不支持".into());
        }
        Ok(file.entries)
    }

    #[tauri::command]
    pub fn load_history(app: AppHandle) -> Result<Option<Vec<serde_json::Value>>, String> {
        let path = history_path(&app)?;
        let backup = path.with_extension("bak");
        if path.exists() {
            return read_file(&path)
                .or_else(|primary_error| {
                    if backup.exists() {
                        read_file(&backup)
                    } else {
                        Err(primary_error)
                    }
                })
                .map(Some);
        }
        if backup.exists() {
            return read_file(&backup).map(Some);
        }
        Ok(None)
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

    #[tauri::command]
    pub fn save_history(
        app: AppHandle,
        entries: Vec<serde_json::Value>,
        retention_days: u32,
    ) -> Result<(), String> {
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
        let mut encrypted = MAGIC.to_vec();
        encrypted.extend_from_slice(&protect_data(&plain)?);
        let path = history_path(&app)?;
        let temp = path.with_extension("new");
        let backup = path.with_extension("bak");
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&encrypted).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        read_file(&temp)?;
        if path.exists() {
            fs::copy(&path, &backup).map_err(|e| format!("保留历史备份失败：{e}"))?;
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
    pub fn export_history(app: AppHandle) -> Result<String, String> {
        let entries = load_history(app.clone())?.unwrap_or_default();
        let directory = app.path().document_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs();
        let path = directory.join(format!("withtype-history-{stamp}.json"));
        fs::write(
            &path,
            serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
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
