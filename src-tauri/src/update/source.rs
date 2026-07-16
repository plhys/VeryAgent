//! Dual update-source selection (GitHub vs Gitea).
//!
//! Networks differ: some environments reach public GitHub, others only the
//! internal Gitea. The preference is stored in `app_metadata` and applied to
//! both desktop (`tauri-plugin-updater` endpoints) and server (manifest +
//! tarball download URLs).

use serde::{Deserialize, Serialize};

/// GitHub release channel (public).
pub const GITHUB_REPO_URL: &str = "https://github.com/plhys/VeryAgent";
pub const GITHUB_MANIFEST_URL: &str =
    "https://github.com/plhys/VeryAgent/releases/latest/download/latest.json";
pub const GITHUB_DOWNLOAD_BASE: &str =
    "https://github.com/plhys/VeryAgent/releases/latest/download";
pub const GITHUB_RELEASES_URL: &str = "https://github.com/plhys/VeryAgent/releases/latest";

/// Internal Gitea release channel (HTTP — requires insecure transport for the
/// desktop updater plugin).
pub const GITEA_REPO_URL: &str = "http://10.10.100.233:3030/boss/veryagent";
pub const GITEA_MANIFEST_URL: &str =
    "http://10.10.100.233:3030/boss/veryagent/releases/latest/download/latest.json";
pub const GITEA_DOWNLOAD_BASE: &str =
    "http://10.10.100.233:3030/boss/veryagent/releases/latest/download";
pub const GITEA_RELEASES_URL: &str =
    "http://10.10.100.233:3030/boss/veryagent/releases/latest";

/// Which remote hosts the update manifest / release assets.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AppUpdateSource {
    /// Public GitHub releases (`plhys/VeryAgent`).
    #[default]
    Github,
    /// Internal Gitea releases (`boss/veryagent`).
    Gitea,
}

impl AppUpdateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Github => "github",
            Self::Gitea => "gitea",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Github => "GitHub",
            Self::Gitea => "Gitea",
        }
    }

    pub fn repo_url(self) -> &'static str {
        match self {
            Self::Github => GITHUB_REPO_URL,
            Self::Gitea => GITEA_REPO_URL,
        }
    }

    pub fn manifest_url(self) -> &'static str {
        match self {
            Self::Github => GITHUB_MANIFEST_URL,
            Self::Gitea => GITEA_MANIFEST_URL,
        }
    }

    pub fn download_base(self) -> &'static str {
        match self {
            Self::Github => GITHUB_DOWNLOAD_BASE,
            Self::Gitea => GITEA_DOWNLOAD_BASE,
        }
    }

    pub fn releases_url(self) -> &'static str {
        match self {
            Self::Github => GITHUB_RELEASES_URL,
            Self::Gitea => GITEA_RELEASES_URL,
        }
    }

    /// Gitea is plain HTTP on the LAN; the desktop updater must allow insecure
    /// transport when this source is selected.
    pub fn requires_insecure_transport(self) -> bool {
        matches!(self, Self::Gitea)
    }
}

/// Persisted preference + resolved channel metadata for the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateSourceSettings {
    pub source: AppUpdateSource,
    /// Display label for the active source ("GitHub" / "Gitea").
    pub source_label: String,
    pub repo_url: String,
    pub releases_url: String,
    pub manifest_url: String,
}

impl AppUpdateSourceSettings {
    pub fn from_source(source: AppUpdateSource) -> Self {
        Self {
            source,
            source_label: source.label().to_string(),
            repo_url: source.repo_url().to_string(),
            releases_url: source.releases_url().to_string(),
            manifest_url: source.manifest_url().to_string(),
        }
    }
}

impl Default for AppUpdateSourceSettings {
    fn default() -> Self {
        Self::from_source(AppUpdateSource::default())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn github_uses_https() {
        assert!(GITHUB_MANIFEST_URL.starts_with("https://"));
        assert!(!AppUpdateSource::Github.requires_insecure_transport());
    }

    #[test]
    fn gitea_uses_http_and_flags_insecure() {
        assert!(GITEA_MANIFEST_URL.starts_with("http://"));
        assert!(AppUpdateSource::Gitea.requires_insecure_transport());
    }

    #[test]
    fn settings_roundtrip_labels() {
        let s = AppUpdateSourceSettings::from_source(AppUpdateSource::Gitea);
        assert_eq!(s.source_label, "Gitea");
        assert_eq!(s.manifest_url, GITEA_MANIFEST_URL);
    }
}
