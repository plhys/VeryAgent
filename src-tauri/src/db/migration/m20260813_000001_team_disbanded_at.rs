use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // team.disbanded_at: soft-archive marker. A disbanded team disappears
        // from the sidebar but keeps every record (slots/tasks/conversations);
        // re-creating a team on the same workspace restores it. NULL = active.
        manager
            .alter_table(
                Table::alter()
                    .table(Team::Table)
                    .add_column(ColumnDef::new(Team::DisbandedAt).timestamp_with_time_zone().null())
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Team::Table)
                    .drop_column(Team::DisbandedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Team {
    Table,
    DisbandedAt,
}
