fn main() {
    tauri_build::build();

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
