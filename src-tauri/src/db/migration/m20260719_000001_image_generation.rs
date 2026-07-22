use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ImageGeneration::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ImageGeneration::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ImageGeneration::Enabled)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(
                        ColumnDef::new(ImageGeneration::ApiUrl)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(ImageGeneration::ApiKey)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(ImageGeneration::ModelName)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(ImageGeneration::DefaultSize)
                            .string()
                            .not_null()
                            .default("1024x1024"),
                    )
                    .col(
                        ColumnDef::new(ImageGeneration::UpdatedAt)
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
            .drop_table(
                Table::drop()
                    .table(ImageGeneration::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum ImageGeneration {
    Table,
    Id,
    Enabled,
    ApiUrl,
    ApiKey,
    ModelName,
    DefaultSize,
    UpdatedAt,
}
