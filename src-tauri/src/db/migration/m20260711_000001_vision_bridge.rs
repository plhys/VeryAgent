use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(VisionBridge::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(VisionBridge::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(VisionBridge::Enabled)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(VisionBridge::ApiUrl).text().not_null().default(""))
                    .col(ColumnDef::new(VisionBridge::ApiKey).text().not_null().default(""))
                    .col(ColumnDef::new(VisionBridge::ModelName).string().not_null().default(""))
                    .col(
                        ColumnDef::new(VisionBridge::AgentTypesJson)
                            .text()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(VisionBridge::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default("CURRENT_TIMESTAMP"),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(VisionBridge::Table).if_exists().to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum VisionBridge {
    Table,
    Id,
    Enabled,
    ApiUrl,
    ApiKey,
    ModelName,
    AgentTypesJson,
    UpdatedAt,
}
