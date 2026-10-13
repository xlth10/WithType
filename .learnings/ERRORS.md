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
