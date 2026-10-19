//! Per-user Windows login startup. The Run value points at this installed EXE.

pub const STARTUP_ARGUMENT: &str = "--background";
pub fn should_launch_silently(args: &[String], settings: &serde_json::Value) -> bool {
    args.iter().any(|arg| arg == STARTUP_ARGUMENT)
        && speech_configured_for_platform(settings, cfg!(target_os = "macos"))
}

fn speech_configured_for_platform(settings: &serde_json::Value, apple_supported: bool) -> bool {
    if settings.get("asrProvider").and_then(|value| value.as_str()) == Some("apple") {
        return apple_supported;
    }
    ["asrEndpoint", "asrModel"].iter().all(|key| {
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
        // command() 可能失败（exe 路径取不到），必须在打开注册表键之前完成，
        // 否则提前返回会把已打开的键句柄泄漏掉。
        let cmd = enabled.then(|| command()).transpose()?;
        let key = open_run_key()?;
        let name = wide(VALUE);
        let result = if enabled {
            let data = wide(cmd.as_deref().unwrap_or_default());
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

#[cfg(target_os = "macos")]
mod platform {
    use std::{fs, path::PathBuf};
    fn path() -> Result<PathBuf, String> {
        let home = std::env::var_os("HOME").ok_or("无法定位用户目录")?;
        Ok(PathBuf::from(home).join("Library/LaunchAgents/app.withtype.desktop.plist"))
    }
    fn xml(value: &str) -> String {
        value
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    #[tauri::command]
    pub fn set_launch_at_login(enabled: bool) -> Result<(), String> {
        let path = path()?;
        if !enabled {
            return match fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(e.to_string()),
            };
        }
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        fs::create_dir_all(path.parent().ok_or("登录启动目录无效")?).map_err(|e| e.to_string())?;
        let contents = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>app.withtype.desktop</string><key>ProgramArguments</key><array><string>{}</string><string>--background</string></array><key>RunAtLoad</key><true/></dict></plist>"#,
            xml(&exe.to_string_lossy())
        );
        let temp = path.with_extension("new");
        fs::write(&temp, contents).map_err(|e| e.to_string())?;
        fs::rename(temp, path).map_err(|e| e.to_string())
    }
    #[tauri::command]
    pub fn get_launch_at_login() -> Result<bool, String> {
        Ok(path()?.is_file())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
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
    fn apple_silent_login_needs_macos_but_no_network_configuration() {
        let settings = serde_json::json!({"asrProvider":"apple", "appleSpeechLocale":"zh-CN"});
        assert!(speech_configured_for_platform(&settings, true));
        assert!(!speech_configured_for_platform(&settings, false));
        assert!(!should_launch_silently(&[], &settings));
        assert_eq!(
            should_launch_silently(&[STARTUP_ARGUMENT.into()], &settings),
            cfg!(target_os = "macos")
        );

        // Saved remote-service values must not make an unsupported Apple provider ready.
        let with_stale_remote_config = serde_json::json!({
            "asrProvider":"apple", "asrEndpoint":"https://example.test", "asrModel":"asr"
        });
        assert!(!speech_configured_for_platform(
            &with_stale_remote_config,
            false
        ));
    }
    #[test]
    fn remote_silent_login_keeps_legacy_configuration_requirements() {
        for provider in [None, Some("openai")] {
            let mut settings =
                serde_json::json!({"asrEndpoint":"https://example.test", "asrModel":"asr"});
            if let Some(provider) = provider {
                settings["asrProvider"] = provider.into();
            }
            assert!(speech_configured_for_platform(&settings, true));
            assert!(speech_configured_for_platform(&settings, false));
            settings["asrModel"] = "  ".into();
            assert!(!speech_configured_for_platform(&settings, true));
            assert!(!speech_configured_for_platform(&settings, false));
        }
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
