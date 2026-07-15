//! OpenWiki integration: config, permissions, runner, inject helpers.
//!
//! OpenWiki is a knowledge layer for VeryAgent, not another chat agent.
//! P0 covers Code Wiki only: settings, init/update bridge, session inject.

pub mod agents_md;
pub mod config;
pub mod inject;
pub mod runner;

pub use config::{
    OpenWikiAgentCapability, OpenWikiAgentPermission, OpenWikiConfig, OpenWikiRuntimeConfig,
    OpenWikiRuntimeState,
};
pub use inject::{maybe_inject_openwiki, OpenWikiInjectDecision};
pub use runner::{OpenWikiAction, OpenWikiRunResult, OpenWikiStatus};