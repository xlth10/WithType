# Learnings

## [LRN-20261012-001] best_practice

**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
后台页面恢复必须协调原生退出、任务撤销和录音删除；进程存在不等于输入入口可用。

### Details
Tauri 在最后一个窗口销毁时默认退出，批量重建 WebView 必须先保留托盘宿主。旧页面的取消清理可能晚于原生中断保存，必须在实际删除时复核中断标记，并与中断操作共用锁；只在取消入口检查一次不足以关闭竞态。自动音频清理还要复核当前任务身份。

### Suggested Action
恢复前撤销任务代次；测试迟到动作、注册中取消、组合睡眠/锁屏和明确退出。将阻塞确认弹窗视为有界监督暂停，避免误判 JavaScript 失联。

### Metadata
- Source: implementation_review
- Related Files: src-tauri/src/background.rs, src-tauri/src/audio.rs, tests/background-controller.test.mjs
- Tags: lifecycle, cancellation, audio-retention, tauri
- Pattern-Key: background.coordinate_recovery_and_cleanup

---

## [LRN-20261010-001] correction

**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
审查前先验证用户当前维护的前端来源，不能把会话 cwd 自动视为最新版本。

### Details
用户指出孵化目录前端不是最新版本。核实既有 5173 Vite 进程 cwd 为 /Users/outsider/SEVB/Type，提交 c84d53d；撤回孵化目录 5175 的证据并重新采集。最新版本已改变模型导航、字体、技能场景和浮窗，不可沿用旧截图结论。

### Suggested Action
对有孵化与独立仓库并存的项目，审查开始前核实预览进程 cwd、Git 提交、工作树状态与实际 UI 特征。

### Metadata
- Source: user_feedback
- Tags: frontend-audit, source-verification, project-migration
- Pattern-Key: frontend.verify_active_source

---


## [LRN-20261013-REC] correction

**Logged**: 2026-10-13
**Priority**: critical
**Status**: resolved
**Area**: infra

### Summary
同名项目的不同目录可能包含互补开发线，不能只确认用户指定正式目录就把其他目录当作无价值副本。

### Details
旧独立仓库有快捷短语、技能卡片和界面改进；正式目录有后台监管、投递和长文优化。移动完整目录并校验正式文件，只能证明移动没有损坏该目录，不能证明其他版本的独有成果已恢复或合入。

### Suggested Action
清理前核对 Git 历史、未提交文件和独有功能；保存原始字节与校验清单；合并后运行双方回归测试，再提交正式仓库。不能以恢复前后相同文件数代替版本完整性检查。

### Metadata
- Source: user_feedback
- Related Files: recovery/2026-10-13/manifest.json, docs/source-recovery-2026-10-13.md
- Pattern-Key: recovery.compare_divergent_project_versions
