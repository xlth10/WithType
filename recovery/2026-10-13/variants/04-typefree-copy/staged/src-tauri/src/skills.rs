// 自定义写法 的校验与持久化。
//
// Skill 是纯声明式的文字处理配置，不是脚本：校验只保证「它是一段能安全拼进提示词的文字」，
// 不解析、不执行、也不允许它携带任何可执行内容。真正的边界（只能影响输出组织方式、
// 不能拿密钥/活动窗口/执行工具）由提示词组装与命令面来保证。
//
// 写入一律走「临时文件 + 原子替换」：直接 fs::write 在进程被杀或断电时会留下
// 半截 JSON，下次启动读到损坏文件就把用户所有自定义写法 弄丢了。

use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

pub const SKILL_SCHEMA_VERSION: u32 = 1;

/// 与前端 src/text/builtinSkills.js 的 SKILL_LIMITS 保持一致。
/// 前端为了即时反馈做一次，这里再兜一次——文件是可以被手工改的。
const MAX_NAME_CHARS: usize = 60;
const MAX_DESCRIPTION_CHARS: usize = 200;
const MAX_INSTRUCTION_CHARS: usize = 4000;
const MAX_CUSTOM_SKILLS: usize = 30;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub source: String,
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

/// 校验一条自定义写法。返回归一化后的值或第一条错误。
///
/// 这里只做「能不能安全保存」的判断；按钮文案、错误展示归前端。
fn validate(skill: &Skill, existing: &[Skill], is_new: bool) -> Result<Skill, String> {
    let name = skill.name.trim();
    let instruction = skill.instruction.trim();
    let description = skill.description.trim();

    if !skill.id.starts_with("custom.") {
        return Err("自定义写法 的 id 必须以 custom. 开头".into());
    }
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    if char_count(name) > MAX_NAME_CHARS {
        return Err(format!("名称不能超过 {MAX_NAME_CHARS} 个字符"));
    }
    if char_count(description) > MAX_DESCRIPTION_CHARS {
        return Err(format!("说明不能超过 {MAX_DESCRIPTION_CHARS} 个字符"));
    }
    if instruction.is_empty() {
        return Err("整理要求不能为空".into());
    }
    if char_count(instruction) > MAX_INSTRUCTION_CHARS {
        return Err(format!("整理要求不能超过 {MAX_INSTRUCTION_CHARS} 个字符"));
    }
    if existing
        .iter()
        .any(|item| item.id != skill.id && item.name.trim() == name)
    {
        return Err("已有同名的自定义写法".into());
    }
    if is_new && existing.len() >= MAX_CUSTOM_SKILLS {
        return Err(format!("自定义写法 最多 {MAX_CUSTOM_SKILLS} 个"));
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
    })
}

/// 读取并过滤：单条不合格就丢那一条，不会因为一条坏数据让其余 Skill 一起消失。
fn load_filtered(path: &Path) -> (Vec<Skill>, usize) {
    let Ok(data) = fs::read(path) else {
        return (Vec::new(), 0);
    };
    let Ok(raw) = serde_json::from_slice::<Vec<Skill>>(&data) else {
        return (Vec::new(), 0);
    };
    let mut kept: Vec<Skill> = Vec::new();
    let mut rejected = 0;
    for item in raw {
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
    let mut accepted: Vec<Skill> = Vec::new();
    // 一次报全所有问题，而不是遇到第一条就返回：前端是逐条校验、逐条列错误的，
    // 这里若只回第一条，用户会经历「改一个、再报一个」的来回。
    let mut problems: Vec<String> = Vec::new();
    for item in &skills {
        let is_new = !accepted.iter().any(|kept| kept.id == item.id);
        match validate(item, &accepted, is_new) {
            Ok(skill) => {
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
        problems.push(format!("自定义写法 最多 {MAX_CUSTOM_SKILLS} 个"));
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
