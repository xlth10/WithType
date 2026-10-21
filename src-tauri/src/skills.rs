// 自定义模板的校验与持久化。
//
// Skill 是纯声明式的文字处理配置，不是脚本：校验只保证「它是一段能安全拼进提示词的文字」，
// 不解析、不执行、也不允许它携带任何可执行内容。真正的边界（只能影响输出组织方式、
// 不能拿密钥/活动窗口/执行工具）由提示词组装与命令面来保证。
//
// 写入一律走「临时文件 + 原子替换」：直接 fs::write 在进程被杀或断电时会留下
// 半截 JSON，下次启动读到损坏文件就把用户所有自定义模板弄丢了。

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const SKILL_SCHEMA_VERSION: u32 = 2;
const MAX_EXAMPLES: usize = 3;
const MAX_EXAMPLE_TEXT: usize = 2000;
const MAX_EXAMPLES_TOTAL: usize = 8000;

/// 与前端 src/text/builtinSkills.js 的 SKILL_LIMITS 保持一致。
/// 前端为了即时反馈做一次，这里再兜一次——文件是可以被手工改的。
const MAX_NAME_CHARS: usize = 60;
const MAX_DESCRIPTION_CHARS: usize = 200;
const MAX_INSTRUCTION_CHARS: usize = 4000;
const MAX_CUSTOM_SKILLS: usize = 30;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillExample {
    pub input: String,
    pub output: String,
}

fn legacy_schema_version() -> u32 {
    1
}
fn default_revision() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub source: String,
    #[serde(default = "legacy_schema_version")]
    pub schema_version: u32,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub instruction: String,
    #[serde(default = "default_output_format")]
    pub output_format: String,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub examples: Vec<SkillExample>,
    #[serde(default)]
    pub missing_info_policy: String,
    #[serde(default = "default_revision")]
    pub revision: u32,
}

fn default_output_format() -> String {
    "plain".to_string()
}

fn default_enabled() -> bool {
    true
}

fn skills_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("skills.json"))
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

/// 校验一条自定义模板。返回归一化后的值或第一条错误。
///
/// 这里只做「能不能安全保存」的判断；按钮文案、错误展示归前端。
fn validate(skill: &Skill, existing: &[Skill], is_new: bool) -> Result<Skill, String> {
    if skill.schema_version > SKILL_SCHEMA_VERSION {
        return Err("模板来自更新版本，请升级应用后再打开".into());
    }
    let missing_info_policy = match skill.missing_info_policy.as_str() {
        "omit" | "mark" => skill.missing_info_policy.clone(),
        "" => if skill.schema_version < 2 {
            "mark"
        } else {
            "omit"
        }
        .to_string(),
        _ => return Err("缺项策略无效，请重新选择".into()),
    };
    if skill.examples.len() > MAX_EXAMPLES {
        return Err(format!("参考样例最多 {MAX_EXAMPLES} 组"));
    }
    let mut examples = Vec::new();
    let mut total = 0;
    for (index, e) in skill.examples.iter().enumerate() {
        let input = e.input.trim();
        let output = e.output.trim();
        if input.is_empty() && output.is_empty() {
            continue;
        }
        if input.is_empty() || output.is_empty() {
            return Err(format!("样例 {} 请同时填写原始口述和期望结果", index + 1));
        }
        if char_count(input) > MAX_EXAMPLE_TEXT || char_count(output) > MAX_EXAMPLE_TEXT {
            return Err(format!(
                "样例 {} 每项不能超过 {MAX_EXAMPLE_TEXT} 个字符",
                index + 1
            ));
        }
        total += char_count(input) + char_count(output);
        examples.push(SkillExample {
            input: input.into(),
            output: output.into(),
        });
    }
    if total > MAX_EXAMPLES_TOTAL {
        return Err(format!("参考样例合计不能超过 {MAX_EXAMPLES_TOTAL} 个字符"));
    }
    let name = skill.name.trim();
    let instruction = skill.instruction.trim();
    let description = skill.description.trim();

    if !skill.id.starts_with("custom.") {
        return Err("模板标识无效，请重新创建".into());
    }
    if name.is_empty() {
        return Err("请填写模板名称".into());
    }
    if char_count(name) > MAX_NAME_CHARS {
        return Err(format!("名称不能超过 {MAX_NAME_CHARS} 个字符"));
    }
    if char_count(description) > MAX_DESCRIPTION_CHARS {
        return Err(format!("说明不能超过 {MAX_DESCRIPTION_CHARS} 个字符"));
    }
    if instruction.is_empty() {
        return Err("请填写整理要求".into());
    }
    if char_count(instruction) > MAX_INSTRUCTION_CHARS {
        return Err(format!("整理要求不能超过 {MAX_INSTRUCTION_CHARS} 个字符"));
    }
    if existing
        .iter()
        .any(|item| item.id != skill.id && item.name.trim() == name)
    {
        return Err("已有同名模板，请换一个名称".into());
    }
    if is_new && existing.len() >= MAX_CUSTOM_SKILLS {
        return Err(format!("自定义模板最多 {MAX_CUSTOM_SKILLS} 个"));
    }

    let output_format = if skill.output_format == "markdown" {
        "markdown".to_string()
    } else {
        "plain".to_string()
    };

    Ok(Skill {
        id: skill.id.trim().to_string(),
        source: "custom".to_string(),
        // 版本由应用写死，不接受文件里自带的值：升版时旧文件必须被本应用重新标注。
        schema_version: SKILL_SCHEMA_VERSION,
        name: name.to_string(),
        description: description.to_string(),
        instruction: instruction.to_string(),
        output_format,
        enabled: skill.enabled,
        updated_at: skill.updated_at.clone(),
        examples,
        missing_info_policy,
        revision: skill.revision.clamp(1, 2147483647),
    })
}

/// 读取并过滤：单条不合格就丢那一条，不会因为一条坏数据让其余 Skill 一起消失。
fn load_filtered(path: &Path) -> (Vec<Skill>, usize) {
    let Ok(data) = fs::read(path) else {
        return (Vec::new(), 0);
    };
    let Ok(raw) = serde_json::from_slice::<Vec<serde_json::Value>>(&data) else {
        return (Vec::new(), 0);
    };
    let mut kept: Vec<Skill> = Vec::new();
    let mut rejected = 0;
    for item in raw {
        let Ok(item) = serde_json::from_value::<Skill>(item) else {
            rejected += 1;
            continue;
        };
        match validate(&item, &kept, true) {
            Ok(skill) => kept.push(skill),
            Err(_) => rejected += 1,
        }
    }
    (kept, rejected)
}

/// 原子替换：先写同目录下的临时文件并 flush，再 rename 覆盖目标。
/// 同目录下 rename 在 Windows 上也是原子替换语义（ReplaceFile 语义由 std 处理）。
pub(crate) fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("skills.json");
    let temp = path.with_file_name(format!(".{file_name}.tmp"));
    {
        use std::io::Write;
        let mut handle =
            fs::File::create(&temp).map_err(|error| format!("无法创建临时文件：{error}"))?;
        handle
            .write_all(data)
            .map_err(|error| format!("写入临时文件失败：{error}"))?;
        handle
            .sync_all()
            .map_err(|error| format!("同步临时文件失败：{error}"))?;
    }
    fs::rename(&temp, path).map_err(|error| {
        let _ = fs::remove_file(&temp);
        format!("替换 {file_name} 失败：{error}")
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSkillsResult {
    pub skills: Vec<Skill>,
    /// 被丢弃的坏数据条数，用于给用户一句提示。
    pub rejected: usize,
}

#[tauri::command]
pub fn load_custom_skills(app: AppHandle) -> Result<LoadSkillsResult, String> {
    let path = skills_path(&app)?;
    if !path.exists() {
        return Ok(LoadSkillsResult {
            skills: Vec::new(),
            rejected: 0,
        });
    }
    let (skills, rejected) = load_filtered(&path);
    Ok(LoadSkillsResult { skills, rejected })
}

#[tauri::command]
pub fn save_custom_skills(app: AppHandle, skills: Vec<Skill>) -> Result<Vec<Skill>, String> {
    let (previous, _) = load_filtered(&skills_path(&app)?);
    let mut accepted: Vec<Skill> = Vec::new();
    // 一次报全所有问题，而不是遇到第一条就返回：前端是逐条校验、逐条列错误的，
    // 这里若只回第一条，用户会经历「改一个、再报一个」的来回。
    let mut problems: Vec<String> = Vec::new();
    for item in &skills {
        let is_new = !accepted.iter().any(|kept| kept.id == item.id);
        match validate(item, &accepted, is_new) {
            Ok(mut skill) => {
                skill.revision = previous
                    .iter()
                    .find(|old| old.id == skill.id)
                    .map(|old| {
                        old.revision
                            .saturating_add(u32::from(!same_content(old, &skill)))
                            .min(2147483647)
                    })
                    .unwrap_or(1);
                // 同一 id 重复出现时按后出现的覆盖，保持界面顺序。
                match accepted.iter_mut().find(|kept| kept.id == skill.id) {
                    Some(slot) => *slot = skill,
                    None => accepted.push(skill),
                }
            }
            Err(error) => problems.push(error),
        }
    }
    if accepted.len() > MAX_CUSTOM_SKILLS {
        problems.push(format!("自定义模板最多 {MAX_CUSTOM_SKILLS} 个"));
    }
    if !problems.is_empty() {
        // 整批拒绝，磁盘上的旧文件保持不动——宁可让用户重来一次，
        // 也不能把半数 Skill 悄悄写掉。
        return Err(problems.join("；"));
    }
    let data = serde_json::to_vec_pretty(&accepted).map_err(|error| error.to_string())?;
    write_atomic(&skills_path(&app)?, &data)?;
    Ok(accepted)
}

fn same_content(a: &Skill, b: &Skill) -> bool {
    a.name == b.name
        && a.description == b.description
        && a.instruction == b.instruction
        && a.output_format == b.output_format
        && a.enabled == b.enabled
        && a.examples == b.examples
        && a.missing_info_policy == b.missing_info_policy
}

#[cfg(test)]
mod tests {
    use super::*;
    fn legacy() -> Skill {
        serde_json::from_value(serde_json::json!({"id":"custom.legacy","source":"custom","schemaVersion":1,"name":"旧模板","instruction":"按原要求整理","updatedAt":"2026-01-01T00:00:00Z"})).unwrap()
    }
    #[test]
    fn legacy_migration_keeps_instructions_and_missing_policy() {
        let old = legacy();
        let normalized = validate(&old, &[], true).unwrap();
        assert_eq!(normalized.schema_version, 2);
        assert_eq!(normalized.missing_info_policy, "mark");
        assert_eq!(normalized.instruction, old.instruction);
        assert_eq!(normalized.updated_at, old.updated_at);
        assert_eq!(normalized.revision, 1);
        assert!(normalized.examples.is_empty());
    }
    #[test]
    fn examples_and_policy_survive_disk_roundtrip() {
        let mut skill = legacy();
        skill.schema_version = 2;
        skill.missing_info_policy = "omit".into();
        skill.examples = vec![SkillExample {
            input: "  口述  ".into(),
            output: "  成稿  ".into(),
        }];
        let normalized = validate(&skill, &[], true).unwrap();
        let dir = std::env::temp_dir().join(format!("withtype-skills-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("skills.json");
        write_atomic(
            &path,
            &serde_json::to_vec(&vec![normalized.clone()]).unwrap(),
        )
        .unwrap();
        let (loaded, rejected) = load_filtered(&path);
        assert_eq!(rejected, 0);
        assert!(same_content(&normalized, &loaded[0]));
        assert_eq!(loaded[0].examples[0].input, "口述");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn invalid_examples_and_future_versions_fail_validation() {
        let mut s = legacy();
        s.examples = vec![SkillExample {
            input: "输入".into(),
            output: "".into(),
        }];
        assert!(validate(&s, &[], true).is_err());
        s.examples = vec![SkillExample {
            input: "字".repeat(2001),
            output: "结果".into(),
        }];
        assert!(validate(&s, &[], true).is_err());
        s.examples = vec![
            SkillExample {
                input: "字".repeat(2000),
                output: "字".repeat(2000)
            };
            3
        ];
        assert!(validate(&s, &[], true).is_err());
        s.examples.clear();
        s.schema_version = 99;
        assert!(validate(&s, &[], true).is_err());
    }
    #[test]
    fn unicode_counts_match_frontend_and_content_changes_are_detected() {
        let mut s = legacy();
        s.name = "😀".repeat(60);
        let mut normalized = validate(&s, &[], true).unwrap();
        normalized.name.push('😀');
        assert!(validate(&normalized, &[], true).is_err());
        normalized = validate(&s, &[], true).unwrap();
        let mut changed = normalized.clone();
        changed.examples.push(SkillExample {
            input: "输入".into(),
            output: "结果".into(),
        });
        assert!(!same_content(&normalized, &changed));
    }
}
