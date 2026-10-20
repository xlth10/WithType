use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
static LOCK: Mutex<()> = Mutex::new(());
const LIMIT: u64 = 1024 * 1024;
fn path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    Ok(directory.join("vocabulary.json"))
}
#[tauri::command]
pub fn load_vocabulary(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    let path = path(&app)?;
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > LIMIT {
        return Err("词库文件过大".into());
    }
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("词库读取失败，原文件已保留：{e}"))
}
#[tauri::command]
pub fn save_vocabulary(app: tauri::AppHandle, vocabulary: serde_json::Value) -> Result<(), String> {
    let _guard = LOCK.lock().map_err(|e| e.to_string())?;
    if vocabulary.get("version").and_then(|v| v.as_u64()) != Some(1) {
        return Err("未知词库格式".into());
    }
    for (field, limit) in [("entries", 500), ("candidates", 200), ("dismissed", 5000)] {
        if !vocabulary
            .get(field)
            .and_then(|v| v.as_array())
            .is_some_and(|v| v.len() <= limit)
        {
            return Err("词库格式或数量无效".into());
        }
    }
    let data = serde_json::to_vec_pretty(&vocabulary).map_err(|e| e.to_string())?;
    if data.len() as u64 > LIMIT {
        return Err("词库文件过大".into());
    }
    crate::skills::write_atomic(&path(&app)?, &data)
}

#[tauri::command]
pub fn export_vocabulary_csv(app: tauri::AppHandle, csv: String) -> Result<String, String> {
    if csv.len() as u64 > LIMIT {
        return Err("导出词库不能超过 1 MB".into());
    }
    let directory = app.path().download_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    for suffix in 0..100 {
        let name = if suffix == 0 {
            format!("withtype-vocabulary-{stamp}.csv")
        } else {
            format!("withtype-vocabulary-{stamp}-{suffix}.csv")
        };
        let path = directory.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                if let Err(error) = file.write_all(csv.as_bytes()).and_then(|_| file.sync_all()) {
                    let _ = fs::remove_file(&path);
                    return Err(format!("导出词库失败：{error}"));
                }
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("导出词库失败：{error}")),
        }
    }
    Err("导出文件名重复，请稍后重试".into())
}
