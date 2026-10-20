# Windows vocabulary compile check · 2026-10-20

- Full product `cargo check --locked --lib --target x86_64-pc-windows-msvc` failed in dependency `ring` C compilation: this Mac has no Windows SDK `assert.h`. It did not reach the application crate.
- Isolated harness check: PASS, exit 0, 43.19 s. Real Windows target and real Tauri/windows dependencies. Includes the current product correction monitor, UIA, delivery, vocabulary, policy and placement modules by absolute path, including the Windows cfg implementations.
- Tauri `generate_handler!` checks stop_learning_monitor, get_vocabulary_learning_capability, load_vocabulary, save_vocabulary and export_vocabulary_csv registration.
- Peripheral debug_log and atomic storage helper are compile-only stubs; they are not runtime evidence or validations of the complete app's persistence implementation.
- This did not build/link or run a Windows EXE, exercise WebView2/UIA/shortcuts/clipboard, or call the proprietary ASR service.
- Windows observation loop now shares the tested stable-4-second state machine with Mac; focus loss and 60-second expiry discard draft edits, and reads are followed by renewed generation/enabled/focus checks.

Logs:
- /private/tmp/withtype-vocabulary-windows-full-check-20261020.log
- /private/tmp/withtype-vocabulary-windows-isolated-check-20261020.log

Command:
```
CARGO_TARGET_DIR=/private/tmp/withtype-windows-check-20261019 cargo check --offline --lib --target x86_64-pc-windows-msvc --manifest-path /private/tmp/withtype-vocabulary-windows-isolated-20261020/Cargo.toml
```

Evidence copies are retained in this directory as `.txt` files. The source files are included by absolute path in `isolated-harness.rs`; adapt the root path to reproduce on another checkout. The harness validates compilation only.
