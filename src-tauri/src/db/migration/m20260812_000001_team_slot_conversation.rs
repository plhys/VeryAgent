use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // team_slot.conversation_id: the member's current working conversation.
        // Minted when a task is assigned; the member mini-window streams it.
        // SET NULL on delete keeps the slot row alive if the conversation goes.
        manager
            .alter_table(
                Table::alter()
                    .table(TeamSlot::Table)
                    .add_column(
                        ColumnDef::new(TeamSlot::ConversationId)
                            .integer()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        // Keep the find-task-by-conversation lookup fast (auto-report path).
        manager
            .create_index(
                Index::create()
                    .name("idx_team_task_conversation")
                    .table(TeamTask::Table)
                    .col(TeamTask::ConversationId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_team_task_conversation")
                    .table(TeamTask::Table)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(TeamSlot::Table)
                    .drop_column(TeamSlot::ConversationId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum TeamSlot {
    Table,
    ConversationId,
}

#[derive(DeriveIden)]
enum TeamTask {
    Table,
    ConversationId,
}
