//! Per-user Windows login startup. The Run value points at this installed EXE.

pub const STARTUP_ARGUMENT: &str = "--background";
pub fn should_launch_silently(args: &[String], settings: &serde_json::Value) -> bool {
    args.iter().any(|arg| arg == STARTUP_ARGUMENT)
        && ["asrEndpoint", "asrModel"].iter().all(|key| {
            settings
                .get(key)
                .and_then(|value| value.as_str())
                .is_some_and(|value| !value.trim().is_empty())
        })
}
// Mirrors the enabled forms used by Electron's Windows implementation; unknown forms are disabled.
fn startup_approved(data: &[u8]) -> bool {
    data.len() >= 4 && matches!(u32::from_le_bytes(data[..4].try_into().unwrap()), 0 | 2)
}

#[cfg(windows)]
mod platform {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            RegCloseKey, RegCreateKeyW, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW,
            RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_BINARY, REG_SZ,
        },
    };

    const KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    // Keep the existing Run/StartupApproved identity, including user-disabled state.
    const VALUE: &str = "TypefreeWindowsUnofficial";
    const APPROVAL: &str =
        "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }

    fn open_run_key() -> Result<HKEY, String> {
        let mut key = ptr::null_mut();
        let code = unsafe { RegCreateKeyW(HKEY_CURRENT_USER, wide(KEY).as_ptr(), &mut key) };
        if code != ERROR_SUCCESS {
            return Err(format!("无法打开 Windows 登录启动设置：{code}"));
        }
        Ok(key)
    }

    fn command() -> Result<String, String> {
        let exe = std::env::current_exe().map_err(|e| format!("无法定位程序路径：{e}"))?;
        Ok(format!(
            "\"{}\" {}",
            exe.to_string_lossy(),
            super::STARTUP_ARGUMENT
        ))
    }

    pub fn apply(enabled: bool) -> Result<(), String> {
        let cmd = if enabled { Some(command()?) } else { None };
        let key = open_run_key()?;
        let name = wide(VALUE);
        let result = if enabled {
            let data = wide(cmd.as_ref().unwrap());
            unsafe {
                RegSetValueExW(
                    key,
                    name.as_ptr(),
                    0,
                    REG_SZ,
                    data.as_ptr().cast(),
                    (data.len() * 2) as u32,
                )
            }
        } else {
            unsafe { RegDeleteValueW(key, name.as_ptr()) }
        };
        unsafe {
            RegCloseKey(key);
        }
        if result == ERROR_SUCCESS || (!enabled && result == ERROR_FILE_NOT_FOUND) {
            if enabled {
                // Only explicit user enable clears this app's OS-level disabled marker.
                let mut approval = ptr::null_mut();
                let code = unsafe {
                    RegCreateKeyW(HKEY_CURRENT_USER, wide(APPROVAL).as_ptr(), &mut approval)
                };
                if code != ERROR_SUCCESS {
                    return Err(format!("无法更新系统启动项状态：{code}"));
                }
                let code = unsafe { RegDeleteValueW(approval, name.as_ptr()) };
                unsafe {
                    RegCloseKey(approval);
                }
                if code != ERROR_SUCCESS && code != ERROR_FILE_NOT_FOUND {
                    return Err(format!("系统启动项仍被禁用：{code}"));
                }
            }
            Ok(())
        } else {
            Err(format!("设置登录启动失败：{result}"))
        }
    }

    fn stored_command() -> Result<Option<String>, String> {
        let mut key = ptr::null_mut();
        let code =
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, wide(KEY).as_ptr(), 0, KEY_READ, &mut key) };
        if code == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if code != ERROR_SUCCESS {
            return Err(format!("读取登录启动设置失败：{code}"));
        }
        let name = wide(VALUE);
        let mut kind = 0;
        let mut size = 0;
        let code = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                ptr::null(),
                &mut kind,
                ptr::null_mut(),
                &mut size,
            )
        };
        if code == ERROR_FILE_NOT_FOUND {
            unsafe {
                RegCloseKey(key);
            }
            return Ok(None);
        }
        if code != ERROR_SUCCESS || kind != REG_SZ || size > 32_768 || size % 2 != 0 {
            unsafe {
                RegCloseKey(key);
            }
            return Err(format!("读取登录启动设置失败：{code}"));
        }
        let mut data = vec![0u8; size as usize];
        let code = unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                ptr::null(),
                &mut kind,
                data.as_mut_ptr(),
                &mut size,
            )
        };
        unsafe {
            RegCloseKey(key);
        }
        if code != ERROR_SUCCESS {
            return Err(format!("读取登录启动设置失败：{code}"));
        }
        let value: Vec<u16> = data
            .chunks_exact(2)
            .map(|part| u16::from_le_bytes([part[0], part[1]]))
            .take_while(|unit| *unit != 0)
            .collect();
        Ok(Some(String::from_utf16_lossy(&value)))
    }

    fn allowed_by_system() -> Result<bool, String> {
        let mut key = ptr::null_mut();
        let code = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                wide(APPROVAL).as_ptr(),
                0,
                KEY_READ,
                &mut key,
            )
        };
        if code == ERROR_FILE_NOT_FOUND {
            return Ok(true);
        }
        if code != ERROR_SUCCESS {
            return Err(format!("读取系统启动项状态失败：{code}"));
        }
        let mut kind = 0;
        let mut data = [0u8; 32];
        let mut size = data.len() as u32;
        let code = unsafe {
            RegQueryValueExW(
                key,
                wide(VALUE).as_ptr(),
                ptr::null(),
                &mut kind,
                data.as_mut_ptr(),
                &mut size,
            )
        };
        unsafe {
            RegCloseKey(key);
        }
        if code == ERROR_FILE_NOT_FOUND {
            return Ok(true);
        }
        if code != ERROR_SUCCESS || kind != REG_BINARY {
            return Err(format!("读取系统启动项状态失败：{code}"));
        }
        Ok(super::startup_approved(&data[..size as usize]))
    }

    pub fn current() -> Result<bool, String> {
        let stored = stored_command()?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let legacy = format!("\"{}\"", exe.to_string_lossy());
        let expected = command()?;
        Ok(
            stored.is_some_and(|value| value == expected || value == legacy)
                && allowed_by_system()?,
        )
    }

    pub fn migrate_existing() -> Result<(), String> {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        if stored_command()? == Some(format!("\"{}\"", exe.to_string_lossy())) {
            // Add the silent-start flag without changing the user's StartupApproved choice.
            let data = wide(&command()?);
            let key = open_run_key()?;
            let code = unsafe {
                RegSetValueExW(
                    key,
                    wide(VALUE).as_ptr(),
                    0,
                    REG_SZ,
                    data.as_ptr().cast(),
                    (data.len() * 2) as u32,
                )
            };
            unsafe {
                RegCloseKey(key);
            }
            if code != ERROR_SUCCESS {
                return Err(format!("更新登录启动入口失败：{code}"));
            }
        }
        Ok(())
    }

    #[tauri::command]
    pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
        apply(enabled)
    }
    #[tauri::command]
    pub fn get_launch_at_login() -> Result<bool, String> {
        current()
    }
}

#[cfg(not(windows))]
mod platform {
    #[tauri::command]
    pub fn set_launch_at_login(_enabled: bool) -> Result<(), String> {
        Err("登录启动仅支持 Windows".into())
    }
    #[tauri::command]
    pub fn get_launch_at_login() -> Result<bool, String> {
        Ok(false)
    }
}

pub use platform::*;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silent_login_needs_explicit_argument_and_configuration() {
        let configured =
            serde_json::json!({"asrEndpoint":"https://example.test", "asrModel":"asr"});
        assert!(!should_launch_silently(&[], &configured));
        assert!(should_launch_silently(
            &["--background".into()],
            &configured
        ));
        assert!(!should_launch_silently(
            &["--background".into()],
            &serde_json::json!({})
        ));
    }
    #[test]
    fn disabled_or_malformed_system_state_is_not_reported_as_enabled() {
        assert!(startup_approved(&[2, 0, 0, 0]));
        assert!(startup_approved(&[0, 0, 0, 0]));
        assert!(!startup_approved(&[3, 0, 0, 0]));
        assert!(!startup_approved(&[7, 0, 0, 0]));
        assert!(!startup_approved(&[2]));
    }
}
