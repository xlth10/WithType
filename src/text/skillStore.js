// 自定义 Skill 的读写封装。
//
// 桌面版落盘到应用配置目录的 skills.json（走 Rust 的 load_custom_skills / save_custom_skills），
// 浏览器预览没有文件系统，退回 localStorage 只是为了能调试界面，不作为正式存储。
//
// 读入一律经过 validateStoredSkills：skills.json 是明文文件，用户可能手工改过、
// 也可能是旧版本写的，坏数据不能把整份列表拖垮。

import { BUILTIN_SKILLS } from "./builtinSkills.js";
import { validateStoredSkills } from "./skillValidation.js";

const PREVIEW_KEY = "typefree-windows.customSkills";

/** 浏览器预览用的本地兜底；桌面版永远不会走到这里。 */
function previewStorage() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // 隐私模式下访问 localStorage 可能直接抛异常。
    return null;
  }
}

function readPreview() {
  const storage = previewStorage();
  if (!storage) return [];
  try {
    return JSON.parse(storage.getItem(PREVIEW_KEY) || "[]");
  } catch {
    return [];
  }
}

function writePreview(skills) {
  const storage = previewStorage();
  if (!storage) return;
  try {
    storage.setItem(PREVIEW_KEY, JSON.stringify(skills));
  } catch {
    // 预览环境的存储失败不影响主流程，界面内存里仍持有这份数据。
  }
}

/**
 * @param {(command: string, payload?: object, fallback?: Function) => Promise<any>} invoke
 *   桌面命令通道；非 Tauri 环境由调用方提供 fallback。
 */
export function createSkillStore(invoke) {
  return {
    /** 读取自定义 Skill。返回 { skills, rejected }，rejected 是被丢弃的坏数据条数。 */
    async load() {
      const response = await invoke("load_custom_skills", {}, () => ({ skills: readPreview(), rejected: 0 }));
      const { skills, rejected } = validateStoredSkills(response && response.skills);
      return { skills, rejected: Math.max(Number(response && response.rejected) || 0, rejected) };
    },

    /** 保存自定义 Skill。Rust 侧会再校验一次，并以它返回的归一化结果为准。 */
    async save(skills) {
      const payload = { skills: Array.isArray(skills) ? skills : [] };
      const response = await invoke("save_custom_skills", payload, () => {
        const { skills: normalized } = validateStoredSkills(payload.skills);
        writePreview(normalized);
        return normalized;
      });
      const { skills: normalized } = validateStoredSkills(response);
      return normalized;
    },

    /** 内置 Skill 与自定义 Skill 合并后的完整列表，供选择器使用。 */
    all(customSkills) {
      return [...BUILTIN_SKILLS, ...(Array.isArray(customSkills) ? customSkills : [])];
    },
  };
}
