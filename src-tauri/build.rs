fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_apple_speech();
    }

    // Windows 下 tauri 只把 Common-Controls v6 清单链接进 bin（cargo:rustc-link-arg-bins），
    // lib 的单元测试二进制拿不到它，加载期就会落到系统目录里 v5 的 comctl32.dll 上——
    // 那份 DLL 没有 TaskDialogIndirect 导出，进程直接以 0xc0000139
    // （STATUS_ENTRYPOINT_NOT_FOUND）退出，一个测试都跑不起来。
    // 这里把同一份编译好的资源再链一遍，`cargo test --lib` 才能启动。
    //
    // 已知代价：cargo 没有 rustc-link-arg-tests（除非包里有 [[test]] target），
    // 而 build script 拿到的 CARGO_* 环境变量在 test 与 bin 构建里完全一致，
    // 无法只对测试目标生效。于是 bin 会拿到两次同样资源，链接时 ld 报
    // `.rsrc merge failure: multiple non-default manifests` 等若干警告。
    // 实测合并结果仍是正确的 v6 清单，exe 能正常启动；这只是链接期噪音。
    // 若将来 cargo 支持了只作用于测试目标的指令，应当换过去。
    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            let resource = format!("{out_dir}/libresource.a");
            if std::path::Path::new(&resource).exists() {
                println!("cargo:rustc-link-arg={resource}");
            }
        }
    }
}

/// Keep the Speech bridge in-process: TCC attributes its authorization prompt
/// to WithType, and packaged apps do not depend on a separately signed helper.
fn build_apple_speech() {
    use std::path::PathBuf;
    use std::process::Command;

    println!("cargo:rerun-if-changed=native/apple_speech.m");
    println!("cargo:rerun-if-env-changed=SDKROOT");
    println!("cargo:rerun-if-env-changed=MACOSX_DEPLOYMENT_TARGET");
    let out = PathBuf::from(std::env::var_os("OUT_DIR").expect("OUT_DIR is required"));
    let object = out.join("apple_speech.o");
    let archive = out.join("libwithtype_apple_speech.a");
    let sdk = std::env::var("SDKROOT")
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            let output = Command::new("xcrun")
                .args(["--sdk", "macosx", "--show-sdk-path"])
                .output()
                .expect("Apple speech recognition requires Xcode command line tools (xcrun)");
            assert!(
                output.status.success(),
                "xcrun could not locate the macOS SDK"
            );
            String::from_utf8(output.stdout)
                .expect("SDK path must be UTF-8")
                .trim()
                .into()
        });
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("Unsupported macOS architecture for Apple speech recognition: {other:?}"),
    };
    let deployment = std::env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "14.0".into());
    let status = Command::new("xcrun")
        .args([
            "--sdk",
            "macosx",
            "clang",
            "-c",
            "native/apple_speech.m",
            "-fobjc-arc",
            "-Wall",
            "-Wextra",
            "-arch",
            arch,
            "-isysroot",
            &sdk,
        ])
        .arg(format!("-mmacosx-version-min={deployment}"))
        .arg("-o")
        .arg(&object)
        .status()
        .expect("Could not launch clang for Apple speech recognition");
    assert!(
        status.success(),
        "Apple Speech Objective-C bridge compilation failed"
    );
    let status = Command::new("xcrun")
        .args(["ar", "crs"])
        .arg(&archive)
        .arg(&object)
        .status()
        .expect("Could not archive Apple Speech bridge");
    assert!(status.success(), "Apple Speech bridge archive failed");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=withtype_apple_speech");
    println!("cargo:rustc-link-lib=framework=Speech");
    println!("cargo:rustc-link-lib=framework=Foundation");
}
