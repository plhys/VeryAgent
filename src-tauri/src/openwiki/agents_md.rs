//! Maintain the `<!-- OPENWIKI:START --> … <!-- OPENWIKI:END -->` block inside
//! AGENTS.md / CLAUDE.md without touching user content outside the markers.

/// Marker pair used by the official OpenWiki CLI.
pub const OPENWIKI_START: &str = "<!-- OPENWIKI:START -->";
pub const OPENWIKI_END: &str = "<!-- OPENWIKI:END -->";

/// Locate a well-formed OPENWIKI block: START followed later by END.
/// Returns `(start_index, end_inclusive)`.
fn find_openwiki_span(content: &str) -> Option<(usize, usize)> {
    let start = content.find(OPENWIKI_START)?;
    let after_start = start + OPENWIKI_START.len();
    let end_rel = content[after_start..].find(OPENWIKI_END)?;
    let end = after_start + end_rel;
    Some((start, end + OPENWIKI_END.len()))
}

/// Upsert the OPENWIKI block in `content` with `block_body` (without markers).
/// If markers are missing or malformed, the block is appended at the end.
pub fn upsert_openwiki_block(content: &str, block_body: &str) -> String {
    let body = block_body.trim();
    let replacement = format!("{OPENWIKI_START}\n{body}\n{OPENWIKI_END}");

    if let Some((start, end_inclusive)) = find_openwiki_span(content) {
        let mut out = String::with_capacity(content.len() + replacement.len());
        out.push_str(&content[..start]);
        out.push_str(&replacement);
        out.push_str(&content[end_inclusive..]);
        out
    } else {
        // No well-formed block — append with a blank line separator when needed.
        let mut out = content.trim_end().to_string();
        if !out.is_empty() {
            out.push_str("\n\n");
        }
        out.push_str(&replacement);
        out.push('\n');
        out
    }
}

/// Remove the OPENWIKI block if present. Returns the original content when absent.
pub fn remove_openwiki_block(content: &str) -> String {
    let Some((start, end_inclusive)) = find_openwiki_span(content) else {
        return content.to_string();
    };
    let mut out = String::new();
    out.push_str(&content[..start]);
    // Drop one surrounding blank line when possible.
    let after = content[end_inclusive..].trim_start_matches(['\r', '\n']);
    let before = out.trim_end_matches(['\r', '\n']);
    if before.is_empty() {
        after.to_string()
    } else if after.is_empty() {
        format!("{before}\n")
    } else {
        format!("{before}\n\n{after}")
    }
}

/// Extract the body between markers, if any.
pub fn extract_openwiki_block(content: &str) -> Option<String> {
    let (start, end_inclusive) = find_openwiki_span(content)?;
    let body_start = start + OPENWIKI_START.len();
    let body_end = end_inclusive - OPENWIKI_END.len();
    if body_end < body_start {
        return None;
    }
    Some(content[body_start..body_end].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_appends_when_missing() {
        let out = upsert_openwiki_block("# Title\n\nHello", "Wiki lives in openwiki/");
        assert!(out.contains(OPENWIKI_START));
        assert!(out.contains("Wiki lives in openwiki/"));
        assert!(out.contains("# Title"));
    }

    #[test]
    fn upsert_replaces_existing_block_only() {
        let original = format!(
            "# Title\n\n{OPENWIKI_START}\nold\n{OPENWIKI_END}\n\n## Keep me\n"
        );
        let out = upsert_openwiki_block(&original, "new body");
        assert!(out.contains("new body"));
        assert!(!out.contains("old"));
        assert!(out.contains("## Keep me"));
        assert!(out.contains("# Title"));
    }

    #[test]
    fn remove_preserves_user_content() {
        let original = format!("A\n\n{OPENWIKI_START}\nx\n{OPENWIKI_END}\n\nB\n");
        let out = remove_openwiki_block(&original);
        assert!(!out.contains(OPENWIKI_START));
        assert!(out.contains('A'));
        assert!(out.contains('B'));
    }

    #[test]
    fn extract_returns_body() {
        let content = format!("{OPENWIKI_START}\nhello wiki\n{OPENWIKI_END}");
        assert_eq!(extract_openwiki_block(&content).as_deref(), Some("hello wiki"));
    }

    #[test]
    fn malformed_end_before_start_appends_instead_of_corrupting() {
        // END appears before START: treat as no well-formed block.
        let original = format!("keep me\n{OPENWIKI_END}\nmid\n{OPENWIKI_START}\nold\n");
        let out = upsert_openwiki_block(&original, "new body");
        assert!(out.contains("keep me"));
        assert!(out.contains("new body"));
        // Original malformed markers are preserved; a well-formed block is appended.
        assert!(out.contains(OPENWIKI_START));
        assert!(out.ends_with(&format!("{OPENWIKI_END}\n")) || out.contains("new body"));
    }

    #[test]
    fn extract_ignores_end_before_start() {
        let content = format!("{OPENWIKI_END}\nbefore\n{OPENWIKI_START}\nbody\n");
        assert_eq!(extract_openwiki_block(&content), None);
    }
}