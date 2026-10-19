# Errors

## [ERR-20261012-001] pipeline_async_test_assumption

**Priority**: medium
**Status**: resolved
**Area**: test

### Summary
增加异步任务注册后，两个旧测试在实际请求尚未开始时调用了尚未设置的 resolve 函数。

### Error
`resolveAsr is not a function` / `resolvers[0] is not a function`。

### Context
测试原先依赖同步进入 ASR/文字请求的实现时序；新的原生就绪注册引入 await，原假设不再成立。

### Suggested Fix
在模拟传输真正开始时完成一个 started Promise，测试等待它后再取消或注入迟到响应，继续验证真实的在途取消/预览竞态。回归已通过。

### Metadata
- Related Files: tests/pipeline.test.mjs, src/dictation/pipeline.js
- Tags: async-test, readiness, race

---


## [ERR-20261013-WTI] shared_project_index_validation

**Logged**: 2026-10-13T11:05:27.597801+08:00
**Priority**: low
**Status**: pending
**Area**: config

### Summary
Shared portfolio validation cannot locate the existing project 10 metadata path. WithType project validation passes.

### Error
`FileNotFoundError: projects/10-sunwoda-public-opinion-monitor/project.json`

### Context
The read-only command `python3 scripts/validate_projects.py` was run against the shared portfolio after WithType consolidation. Its existing public index references a project 10 directory that is absent. No shared portfolio files or project 10 files were changed by this task.

### Suggested Fix
The portfolio controller should reconcile project 10's public repoPath with its actual directory. Do not migrate the legacy numeric-only directory as part of an unrelated project task.

### Metadata
- Reproducible: yes
- Related Files: /Users/outsider/codex_projects/emergence-lab/projects.json, /Users/outsider/codex_projects/emergence-lab/scripts/validate_projects.py

---

## [ERR-20261015-REA] REA frontend and native analysis timeouts

**Logged**: 2026-10-15T21:05:26+08:00
**Priority**: medium
**Status**: resolved
**Area**: infra

### Summary
REA 6.0.0 whole-directory JavaScript analysis reached the 300-second MCP timeout, and Hopper startup timed out at 120 seconds during a public Chatterfly package investigation.

### Error
`timed out awaiting tools/call after 300s`; `provider_timeout` with `stage=startup`, `provider_state=not_started`. Process capture also returned `cleanup_incomplete` despite the download script exiting successfully, so that result was treated as partial and the downloaded bytes were independently checked.

### Resolution
Used REA controlled browser network capture and artifact inventory, followed by native `nm` and bounded per-symbol LLVM disassembly. Verify output rather than assuming process capture success. Mach-O mode ignores generic symbol and address filters: use `llvm-objdump --macho --arch=arm64 --disassemble --dis-symname '<symbol>'` with separate arguments. Decode Objective-C UTF-16 CFStrings independently; objdump text can contain invalid UTF-8. No REA setup or application installation was needed.

### Metadata
- Reproducible: unknown
- Tags: rea, hopper, macho, llvm-objdump

---
