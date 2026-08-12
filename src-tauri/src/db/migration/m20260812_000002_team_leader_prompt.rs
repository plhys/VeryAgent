use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // team.leader_prompt: the role/system prompt injected into the leader
        // conversation on connect. It tells the leader (PM) it has a team of
        // members to decompose work for, and how to delegate/confirm/report.
        manager
            .alter_table(
                Table::alter()
                    .table(Team::Table)
                    .add_column(ColumnDef::new(Team::LeaderPrompt).text().null())
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
                    .drop_column(Team::LeaderPrompt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Team {
    Table,
    LeaderPrompt,
}
