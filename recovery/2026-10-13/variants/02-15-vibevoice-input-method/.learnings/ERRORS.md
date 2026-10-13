# Errors

Command failures and integration errors.

---

## [ERR-20260904-002] apply_patch same-path replacement

**Logged**: 2026-09-04T12:28:59Z
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
An attempted whole-file replacement used delete and add operations for the same path in one patch.

### Error
```text
apply_patch verification failed: invalid patch: multiple operations target VoiceHUDController.swift
```

### Context
- Replacing the AppKit HUD implementation with a fluid waveform renderer.
- The patch verifier rejects multiple operations targeting one path.

### Suggested Fix
Delete the old file and add the replacement in separate `apply_patch` calls.

### Metadata
- Reproducible: yes
- Related Files: Sources/VibeVoiceInput/VoiceHUDController.swift

### Resolution
- **Resolved**: 2026-09-04T12:28:59Z
- **Notes**: Split the replacement into two atomic patch operations.

---

## [ERR-20260904-001] functions.exec JavaScript composition

**Logged**: 2026-09-04T07:09:57Z
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
An invalid inline `const` declaration caused the read-only process verification script to fail before its tool call.

### Error
```text
SyntaxError: Unexpected token 'const'
```

### Context
- Attempted to filter `ps aux` output inside a nested expression passed to `text()`.
- The failure was in orchestration JavaScript, not in VibeVoiceInput.

### Suggested Fix
Assign the filtered lines in a separate statement, then pass the resulting string to `text()`.

### Metadata
- Reproducible: yes
- Related Files: none

### Resolution
- **Resolved**: 2026-09-04T07:09:57Z
- **Notes**: Replaced the invalid expression with simple sequential JavaScript statements.

---
