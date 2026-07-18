//! Web (axum) handlers for the generic npm CLI install / uninstall commands.

use std::sync::Arc;

use axum::extract::Extension;
use axum::Json;
use serde::Deserialize;

use crate::app_error::AppCommandError;
use crate::commands::npm_cli::{
    npm_install_cli_core, npm_uninstall_package, NpmInstallParams, NpmInstallResult,
    NpmUninstallParams,
};
use crate::web::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallNpmCliBody {
    pub params: NpmInstallParams,
}

pub async fn install_npm_cli(
    Extension(state): Extension<Arc<AppState>>,
    Json(body): Json<InstallNpmCliBody>,
) -> Result<Json<NpmInstallResult>, AppCommandError> {
    let result = npm_install_cli_core(&body.params, &state.emitter).await?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UninstallNpmCliBody {
    pub params: NpmUninstallParams,
}

pub async fn uninstall_npm_cli(
    Extension(_state): Extension<Arc<AppState>>,
    Json(body): Json<UninstallNpmCliBody>,
) -> Result<Json<NpmInstallResult>, AppCommandError> {
    let result = npm_uninstall_package(&body.params.package_name, &body.params.binary_name).await?;
    Ok(Json(result))
}
