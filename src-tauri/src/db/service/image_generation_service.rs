//! CRUD service for the `image_generation` configuration table.
//!
//! Singleton row (id = 1) configures the platform image generation capability.
//! Supports multiple OpenAI-compatible gateways with user notes and priority
//! (0 = highest, 9 = lowest).

use chrono::Utc;
use sea_orm::{ActiveModelTrait, DatabaseConnection, EntityTrait, Set};
use serde::{Deserialize, Serialize};

use crate::db::entities::image_generation;

/// The well-known row id for the image_generation configuration singleton.
pub const IMAGE_GENERATION_CONFIG_ID: i32 = 1;

/// One configured image gateway (user-facing unit).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ImageGatewayEntry {
    /// Stable client-generated id (e.g. `gw-…`).
    pub id: String,
    /// Free-form note: site name, price, model family, etc.
    #[serde(default)]
    pub note: String,
    /// Priority 0..=9. **0 is highest** (tried first / shown first).
    #[serde(default)]
    pub priority: u8,
    /// Per-gateway enable (master `enabled` still gates injection).
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    #[serde(default = "default_image_size")]
    pub default_size: String,
}

fn default_true() -> bool {
    true
}

fn default_image_size() -> String {
    "1024x1024".to_string()
}

/// Shape returned to the frontend / command layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationConfig {
    /// Master switch: inject generate_image / modify_image tools.
    pub enabled: bool,
    /// Multi-gateway list (sorted by priority asc, then id).
    #[serde(default)]
    pub gateways: Vec<ImageGatewayEntry>,
    // ── Legacy flat fields (kept for older clients / companion path) ──
    // Always mirrored from the highest-priority usable gateway when present.
    pub api_url: String,
    pub api_key: String,
    pub model_name: String,
    pub default_size: String,
    pub updated_at: chrono::DateTime<Utc>,
}

/// Shape accepted by the save command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageGenerationConfigUpdate {
    pub enabled: bool,
    /// Preferred: multi-gateway list.
    #[serde(default)]
    pub gateways: Vec<ImageGatewayEntry>,
    // Legacy single-gateway fields (used when `gateways` is empty).
    #[serde(default)]
    pub api_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub model_name: String,
    #[serde(default)]
    pub default_size: String,
}

/// Clamp priority into 0..=9.
pub fn clamp_priority(p: u8) -> u8 {
    p.min(9)
}

/// Sort gateways: priority asc (0 first), then id.
pub fn sort_gateways(gateways: &mut [ImageGatewayEntry]) {
    gateways.sort_by(|a, b| {
        a.priority
            .cmp(&b.priority)
            .then_with(|| a.id.cmp(&b.id))
    });
}

/// Normalize a list for storage / API response.
pub fn normalize_gateways(mut gateways: Vec<ImageGatewayEntry>) -> Vec<ImageGatewayEntry> {
    for g in &mut gateways {
        g.priority = clamp_priority(g.priority);
        if g.default_size.trim().is_empty() {
            g.default_size = default_image_size();
        }
        g.api_url = g.api_url.trim().to_string();
        g.model_name = g.model_name.trim().to_string();
        g.note = g.note.trim().to_string();
        if g.id.trim().is_empty() {
            g.id = format!("gw-{}", Utc::now().timestamp_millis());
        }
    }
    sort_gateways(&mut gateways);
    gateways
}

/// First enabled gateway with non-empty credentials (priority order).
pub fn pick_active_gateway(gateways: &[ImageGatewayEntry]) -> Option<&ImageGatewayEntry> {
    gateways.iter().find(|g| {
        g.enabled
            && !g.api_url.trim().is_empty()
            && !g.api_key.trim().is_empty()
            && !g.model_name.trim().is_empty()
    })
}

/// All enabled gateways with credentials, in priority order (for failover).
pub fn usable_gateways(gateways: &[ImageGatewayEntry]) -> Vec<&ImageGatewayEntry> {
    gateways
        .iter()
        .filter(|g| {
            g.enabled
                && !g.api_url.trim().is_empty()
                && !g.api_key.trim().is_empty()
                && !g.model_name.trim().is_empty()
        })
        .collect()
}

fn parse_gateways_json(raw: &str) -> Vec<ImageGatewayEntry> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    serde_json::from_str::<Vec<ImageGatewayEntry>>(trimmed)
        .ok()
        .map(normalize_gateways)
        .unwrap_or_default()
}

fn gateways_from_legacy(
    api_url: &str,
    api_key: &str,
    model_name: &str,
    default_size: &str,
) -> Vec<ImageGatewayEntry> {
    if api_url.trim().is_empty()
        && api_key.trim().is_empty()
        && model_name.trim().is_empty()
    {
        return Vec::new();
    }
    normalize_gateways(vec![ImageGatewayEntry {
        id: "gw-legacy".into(),
        note: String::new(),
        priority: 0,
        enabled: true,
        api_url: api_url.to_string(),
        api_key: api_key.to_string(),
        model_name: model_name.to_string(),
        default_size: if default_size.trim().is_empty() {
            default_image_size()
        } else {
            default_size.to_string()
        },
    }])
}

fn flatten_from_gateways(gateways: &[ImageGatewayEntry]) -> (String, String, String, String) {
    if let Some(g) = pick_active_gateway(gateways) {
        (
            g.api_url.clone(),
            g.api_key.clone(),
            g.model_name.clone(),
            if g.default_size.trim().is_empty() {
                default_image_size()
            } else {
                g.default_size.clone()
            },
        )
    } else if let Some(g) = gateways.first() {
        (
            g.api_url.clone(),
            g.api_key.clone(),
            g.model_name.clone(),
            if g.default_size.trim().is_empty() {
                default_image_size()
            } else {
                g.default_size.clone()
            },
        )
    } else {
        (
            String::new(),
            String::new(),
            String::new(),
            default_image_size(),
        )
    }
}

fn model_to_config(model: image_generation::Model) -> ImageGenerationConfig {
    let mut gateways = parse_gateways_json(&model.gateways_json);
    if gateways.is_empty() {
        gateways = gateways_from_legacy(
            &model.api_url,
            &model.api_key,
            &model.model_name,
            &model.default_size,
        );
    }
    let (api_url, api_key, model_name, default_size) = flatten_from_gateways(&gateways);
    ImageGenerationConfig {
        enabled: model.enabled,
        gateways,
        api_url,
        api_key,
        model_name,
        default_size,
        updated_at: model.updated_at,
    }
}

/// Read the current configuration. Returns a default (disabled) config if the
/// row does not yet exist.
pub async fn get_config(conn: &DatabaseConnection) -> ImageGenerationConfig {
    let row = image_generation::Entity::find_by_id(IMAGE_GENERATION_CONFIG_ID)
        .one(conn)
        .await
        .ok()
        .flatten();

    match row {
        Some(model) => model_to_config(model),
        None => ImageGenerationConfig {
            enabled: false,
            gateways: Vec::new(),
            api_url: String::new(),
            api_key: String::new(),
            model_name: String::new(),
            default_size: default_image_size(),
            updated_at: Utc::now(),
        },
    }
}

/// Create or update the image_generation configuration row.
pub async fn save_config(
    conn: &DatabaseConnection,
    update: ImageGenerationConfigUpdate,
) -> Result<ImageGenerationConfig, sea_orm::DbErr> {
    let now = Utc::now();

    let mut gateways = if !update.gateways.is_empty() {
        normalize_gateways(update.gateways)
    } else {
        // Legacy single-gateway save path.
        gateways_from_legacy(
            &update.api_url,
            &update.api_key,
            &update.model_name,
            &update.default_size,
        )
    };

    let (api_url, api_key, model_name, default_size) = flatten_from_gateways(&gateways);
    let gateways_json = if gateways.is_empty() {
        String::new()
    } else {
        serde_json::to_string(&gateways).unwrap_or_default()
    };

    // Keep local gateways in sync for the returned config.
    sort_gateways(&mut gateways);

    let existing = image_generation::Entity::find_by_id(IMAGE_GENERATION_CONFIG_ID)
        .one(conn)
        .await?;

    let model = match existing {
        Some(row) => {
            let mut active: image_generation::ActiveModel = row.into();
            active.enabled = Set(update.enabled);
            active.api_url = Set(api_url);
            active.api_key = Set(api_key);
            active.model_name = Set(model_name);
            active.default_size = Set(default_size);
            active.gateways_json = Set(gateways_json);
            active.updated_at = Set(now);
            active.update(conn).await?
        }
        None => {
            let active = image_generation::ActiveModel {
                id: Set(IMAGE_GENERATION_CONFIG_ID),
                enabled: Set(update.enabled),
                api_url: Set(api_url),
                api_key: Set(api_key),
                model_name: Set(model_name),
                default_size: Set(default_size),
                gateways_json: Set(gateways_json),
                updated_at: Set(now),
            };
            active.insert(conn).await?
        }
    };

    Ok(model_to_config(model))
}

/// Convert a gateway entry into the flat config shape used by the HTTP client.
pub fn config_for_gateway(
    master_enabled: bool,
    gateway: &ImageGatewayEntry,
    updated_at: chrono::DateTime<Utc>,
) -> ImageGenerationConfig {
    ImageGenerationConfig {
        enabled: master_enabled,
        gateways: vec![gateway.clone()],
        api_url: gateway.api_url.clone(),
        api_key: gateway.api_key.clone(),
        model_name: gateway.model_name.clone(),
        default_size: if gateway.default_size.trim().is_empty() {
            default_image_size()
        } else {
            gateway.default_size.clone()
        },
        updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priority_zero_sorts_first() {
        let mut list = vec![
            ImageGatewayEntry {
                id: "b".into(),
                note: "cheap".into(),
                priority: 5,
                enabled: true,
                api_url: "https://b".into(),
                api_key: "k".into(),
                model_name: "m".into(),
                default_size: "1024x1024".into(),
            },
            ImageGatewayEntry {
                id: "a".into(),
                note: "main".into(),
                priority: 0,
                enabled: true,
                api_url: "https://a".into(),
                api_key: "k".into(),
                model_name: "m".into(),
                default_size: "1024x1024".into(),
            },
        ];
        sort_gateways(&mut list);
        assert_eq!(list[0].id, "a");
        assert_eq!(list[1].id, "b");
    }

    #[test]
    fn pick_skips_disabled_and_incomplete() {
        let list = normalize_gateways(vec![
            ImageGatewayEntry {
                id: "1".into(),
                note: "".into(),
                priority: 0,
                enabled: false,
                api_url: "https://x".into(),
                api_key: "k".into(),
                model_name: "m".into(),
                default_size: "1024x1024".into(),
            },
            ImageGatewayEntry {
                id: "2".into(),
                note: "".into(),
                priority: 1,
                enabled: true,
                api_url: "".into(),
                api_key: "k".into(),
                model_name: "m".into(),
                default_size: "1024x1024".into(),
            },
            ImageGatewayEntry {
                id: "3".into(),
                note: "ok".into(),
                priority: 2,
                enabled: true,
                api_url: "https://ok".into(),
                api_key: "k".into(),
                model_name: "gpt-image-1".into(),
                default_size: "1024x1024".into(),
            },
        ]);
        let picked = pick_active_gateway(&list).unwrap();
        assert_eq!(picked.id, "3");
    }
}
