//! Per-user Windows login startup. The Run value points at this installed EXE.

#[cfg(windows)]
mod platform {
    use std::ptr;
    use windows_sys::Win32::{
        Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS},
        System::Registry::{
            RegCloseKey, RegCreateKeyW, RegDeleteValueW, RegQueryValueExW, RegSetValueExW, HKEY,
            HKEY_CURRENT_USER, REG_SZ,
        },
    };

    const KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
    const VALUE: &str = "TypefreeWindowsUnofficial";

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
        Ok(format!("\"{}\"", exe.to_string_lossy()))
    }

    pub fn apply(enabled: bool) -> Result<(), String> {
        let key = open_run_key()?;
        let name = wide(VALUE);
        let result = if enabled {
            let cmd = command()?;
            let data = wide(&cmd);
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
            Ok(())
        } else {
            Err(format!("设置登录启动失败：{result}"))
        }
    }

    pub fn current() -> Result<bool, String> {
        let key = open_run_key()?;
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
            return Ok(false);
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
        Ok(String::from_utf16_lossy(&value) == command()?)
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

#[cfg(windows)]
pub(crate) use platform::apply;
pub use platform::*;
