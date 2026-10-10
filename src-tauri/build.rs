fn main() {
    tauri_build::build();

    // Windows 下 tauri 只把 Common-Controls v6 清单链接进 bin（cargo:rustc-link-arg-bins），
    // lib 的单元测试二进制拿不到它，加载期就会落到系统目录里 v5 的 comctl32.dll 上——
    // 那份 DLL 没有 TaskDialogIndirect 导出，进程直接以 0xc0000139
    // （STATUS_ENTRYPOINT_NOT_FOUND）退出，一个测试都跑不起来。
    // 这里把同一份编译好的资源再链一遍，`cargo test --lib` 才能启动。
    //
    // 已知代价：cargo 没有能作用于 lib 单元测试目标的 link-arg 指令，也没法在
    // build script 里干净地区分两种构建。三条都实测过：
    //   * cargo:rustc-link-arg-tests 只覆盖显式的 [[test]] target，够不到
    //     src/lib.rs 里自动生成的单元测试 harness（且包内没有 [[test]] 时会直接报错）；
    //   * build script 拿到的 CARGO_* / PROFILE / DEBUG 环境变量，在
    //     `cargo test --lib` 与 `cargo build` 下只有 CARGO_MAKEFLAGS 里的
    //     jobserver 随机 id 不同（PROFILE 都是 debug，CARGO_CFG_TEST 恒为未设置），
    //     没有可靠的判别依据；
    //   * GNU ld 2.47 没有 `archive.a,archive.a!` 这种「同名则排除」的写法，
    //     传进去只会被当成一个不存在的文件名。
    // 于是 bin 会拿到两次同样资源，链接时 ld 报若干
    // `.rsrc merge failure: multiple non-default manifests` 之类警告。
    // 实测合并结果仍是正确的 v6 清单，exe 能正常启动；这只是链接期噪音。
    // 反过来把这段删掉，`cargo test --lib` 的测试二进制会直接以
    // 0xc0000139（STATUS_ENTRYPOINT_NOT_FOUND）退出，一个测试都跑不起来。
    // 若将来 cargo 支持了只作用于单元测试目标的指令，应当换过去。
    if std::env::var_os("CARGO_CFG_WINDOWS").is_some() {
        if let Ok(out_dir) = std::env::var("OUT_DIR") {
            let resource = format!("{out_dir}/libresource.a");
            if std::path::Path::new(&resource).exists() {
                println!("cargo:rustc-link-arg={resource}");
            }
        }
    }
}
