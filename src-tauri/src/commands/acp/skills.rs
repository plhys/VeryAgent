use super::*;
use std::path::PathBuf;


pub(crate) fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

pub(crate) fn skill_name_from_id(id: &str) -> String {
    id.to_string()
}

/// Best-effort extraction of a one-line skill description from a markdown
/// file's YAML frontmatter. Prefers `short-description` (commonly nested under
/// a `metadata:` block) and falls back to a top-level `description`. Only the
/// first 4 KiB is read; frontmatter always fits, and skill bodies can be large.
pub(crate) fn read_skill_description(content_path: &Path) -> Option<String> {
    use std::io::Read;
    let mut file = fs::File::open(content_path).ok()?;
    let mut buf = [0u8; 4096];
    let n = file.read(&mut buf).ok()?;
    let head = std::str::from_utf8(&buf[..n]).ok()?;

    let mut lines = head.lines();
    if lines.next()?.trim() != "---" {
        return None;
    }

    let mut short: Option<String> = None;
    let mut long: Option<String> = None;
    for line in lines {
        let trimmed_end = line.trim_end();
        if trimmed_end == "---" || trimmed_end == "..." {
            break;
        }
        let is_top_level = !line.starts_with(|c: char| c.is_whitespace());
        let stripped = line.trim();

        // `short-description` is allowed at any indent so it resolves when
        // nested under `metadata:` (Codex's `.system` skills follow this).
        if short.is_none() {
            if let Some(rest) = stripped.strip_prefix("short-description:") {
                if let Some(val) = parse_frontmatter_scalar(rest) {
                    short = Some(val);
                    break;
                }
            }
        }
        // `description` is only honored at the top level to avoid colliding
        // with unrelated nested `description:` keys.
        if is_top_level && long.is_none() {
            if let Some(rest) = line.strip_prefix("description:") {
                if let Some(val) = parse_frontmatter_scalar(rest) {
                    long = Some(val);
                }
            }
        }
    }
    short.or(long)
}

/// Read a single-line YAML scalar (with optional matching quotes). Returns
/// `None` for empty values or block-scalar markers (`|` / `>`) we can't span.
pub(crate) fn parse_frontmatter_scalar(rest: &str) -> Option<String> {
    let val = rest.trim();
    if val.starts_with('|') || val.starts_with('>') {
        return None;
    }
    let unquoted = val
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .or_else(|| val.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')))
        .unwrap_or(val)
        .trim();
    if unquoted.is_empty() {
        None
    } else {
        Some(unquoted.to_string())
    }
}

pub(crate) fn build_skill_item(
    id: String,
    scope: AgentSkillScope,
    layout: AgentSkillLayout,
    path: PathBuf,
) -> AgentSkillItem {
    let description = read_skill_description(&skill_content_path(layout, &path));
    AgentSkillItem {
        name: skill_name_from_id(&id),
        id,
        scope,
        layout,
        path: path.to_string_lossy().to_string(),
        description,
        read_only: false,
    }
}

/// Codex ships a handful of built-in skills under `~/.codex/skills/.system/`
/// (imagegen, skill-creator, etc.). We scan that directory so users see
/// these in the `$` autocomplete and the Skills settings list — but any
/// write to those files would clobber the CLI's own assets.
pub(crate) fn is_read_only_skill_path(agent_type: AgentType, skill_path: &Path) -> bool {
    if agent_type != AgentType::Codex {
        return false;
    }
    let ro_root = codex_home_dir().join("skills").join(".system");
    skill_path.starts_with(&ro_root)
}

pub(crate) fn skill_content_path(layout: AgentSkillLayout, skill_path: &Path) -> PathBuf {
    match layout {
        AgentSkillLayout::SkillDirectory => skill_path.join("SKILL.md"),
        AgentSkillLayout::MarkdownFile => skill_path.to_path_buf(),
    }
}

pub(crate) fn locate_existing_skill(
    dir: &Path,
    kind: SkillStorageKind,
    skill_id: &str,
    scope: AgentSkillScope,
) -> Option<AgentSkillItem> {
    if matches!(
        kind,
        SkillStorageKind::SkillDirectoryOnly | SkillStorageKind::SkillDirectoryOrMarkdownFile
    ) {
        let skill_dir = dir.join(skill_id);
        if skill_dir.is_dir() && skill_dir.join("SKILL.md").is_file() {
            return Some(build_skill_item(
                skill_id.to_string(),
                scope,
                AgentSkillLayout::SkillDirectory,
                skill_dir,
            ));
        }
    }

    if matches!(kind, SkillStorageKind::SkillDirectoryOrMarkdownFile) {
        let file_path = dir.join(format!("{skill_id}.md"));
        if file_path.is_file() {
            return Some(build_skill_item(
                skill_id.to_string(),
                scope,
                AgentSkillLayout::MarkdownFile,
                file_path,
            ));
        }
    }

    None
}

pub(crate) fn locate_existing_skill_across_dirs(
    dirs: &[PathBuf],
    kind: SkillStorageKind,
    skill_id: &str,
    scope: AgentSkillScope,
) -> Option<AgentSkillItem> {
    for dir in dirs {
        if let Some(found) = locate_existing_skill(dir, kind, skill_id, scope) {
            return Some(found);
        }
    }
    None
}
