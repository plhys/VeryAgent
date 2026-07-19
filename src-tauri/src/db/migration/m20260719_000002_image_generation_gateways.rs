use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, Statement};

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Multi-gateway list as JSON text. Empty string means "use legacy flat columns".
        manager
            .alter_table(
                Table::alter()
                    .table(ImageGeneration::Table)
                    .add_column(
                        ColumnDef::new(ImageGeneration::GatewaysJson)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await?;

        // Best-effort migrate existing single-gateway row into gateways_json.
        let conn = manager.get_connection();
        let rows = conn
            .query_all(Statement::from_string(
                manager.get_database_backend(),
                "SELECT id, enabled, api_url, api_key, model_name, default_size FROM image_generation"
                    .to_string(),
            ))
            .await?;

        for row in rows {
            let id: i32 = row.try_get("", "id").unwrap_or(1);
            let api_url: String = row.try_get("", "api_url").unwrap_or_default();
            let api_key: String = row.try_get("", "api_key").unwrap_or_default();
            let model_name: String = row.try_get("", "model_name").unwrap_or_default();
            let default_size: String = row
                .try_get("", "default_size")
                .unwrap_or_else(|_| "1024x1024".to_string());
            let gw_enabled: bool = row.try_get("", "enabled").unwrap_or(false);

            if api_url.trim().is_empty()
                && api_key.trim().is_empty()
                && model_name.trim().is_empty()
            {
                continue;
            }

            let json = serde_json::json!([{
                "id": "gw-legacy",
                "note": "",
                "priority": 0,
                "enabled": true,
                "api_url": api_url,
                "api_key": api_key,
                "model_name": model_name,
                "default_size": if default_size.is_empty() {
                    "1024x1024".to_string()
                } else {
                    default_size
                },
            }])
            .to_string();

            // Escape single quotes for SQL.
            let escaped = json.replace('\'', "''");
            let _ = gw_enabled; // master enabled stays on the row
            conn.execute(Statement::from_string(
                manager.get_database_backend(),
                format!(
                    "UPDATE image_generation SET gateways_json = '{escaped}' WHERE id = {id}"
                ),
            ))
            .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(ImageGeneration::Table)
                    .drop_column(ImageGeneration::GatewaysJson)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ImageGeneration {
    Table,
    GatewaysJson,
}
