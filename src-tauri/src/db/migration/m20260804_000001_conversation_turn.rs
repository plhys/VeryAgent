use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ConversationTurn::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ConversationTurn::Id)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ConversationTurn::ConversationId).integer().not_null())
                    .col(ColumnDef::new(ConversationTurn::TurnId).string().not_null())
                    .col(ColumnDef::new(ConversationTurn::Sequence).integer().not_null())
                    .col(ColumnDef::new(ConversationTurn::Role).string().not_null())
                    .col(ColumnDef::new(ConversationTurn::BlocksJson).text().not_null())
                    .col(
                        ColumnDef::new(ConversationTurn::Timestamp)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ConversationTurn::CompletedAt).timestamp_with_time_zone().null())
                    .col(ColumnDef::new(ConversationTurn::UsageJson).text().null())
                    .col(ColumnDef::new(ConversationTurn::DurationMs).big_integer().null())
                    .col(ColumnDef::new(ConversationTurn::Model).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_conversation_turn_conversation")
                            .from(ConversationTurn::Table, ConversationTurn::ConversationId)
                            .to(Conversation::Table, Conversation::Id)
                            .on_delete(ForeignKeyAction::Cascade)
                            .on_update(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_conversation_turn_conversation_sequence")
                    .table(ConversationTurn::Table)
                    .col(ConversationTurn::ConversationId)
                    .col(ConversationTurn::Sequence)
                    .unique()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_conversation_turn_conversation_turn_id")
                    .table(ConversationTurn::Table)
                    .col(ConversationTurn::ConversationId)
                    .col(ConversationTurn::TurnId)
                    .unique()
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ConversationTurn::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum ConversationTurn {
    Table,
    Id,
    ConversationId,
    TurnId,
    Sequence,
    Role,
    BlocksJson,
    Timestamp,
    CompletedAt,
    UsageJson,
    DurationMs,
    Model,
}

#[derive(DeriveIden)]
enum Conversation {
    Table,
    Id,
}
