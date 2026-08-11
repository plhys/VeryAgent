use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // team: one collaboration team = a leader slot + N member slots.
        manager
            .create_table(
                Table::create()
                    .table(Team::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Team::Id)
                            .string_len(36)
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Team::Name).string().not_null())
                    .col(
                        ColumnDef::new(Team::LeaderSlotId)
                            .string_len(36)
                            .not_null(),
                    )
                    .col(ColumnDef::new(Team::Workspace).string().not_null())
                    .col(
                        ColumnDef::new(Team::LeaderConversationId)
                            .integer()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(Team::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        // team_slot: one member (an existing agent) with up to 3 roles.
        manager
            .create_table(
                Table::create()
                    .table(TeamSlot::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TeamSlot::Id)
                            .string_len(36)
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TeamSlot::TeamId)
                            .string_len(36)
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TeamSlot::AgentType)
                            .string()
                            .not_null(),
                    )
                    // JSON array of role ids (leader/dev/test/doc/review).
                    .col(ColumnDef::new(TeamSlot::Roles).text().not_null())
                    .col(
                        ColumnDef::new(TeamSlot::DisplayName)
                            .string()
                            .not_null(),
                    )
                    // 'idle' | 'working' | 'stuck' | 'error'
                    .col(
                        ColumnDef::new(TeamSlot::Status)
                            .string()
                            .not_null()
                            .default("idle"),
                    )
                    .col(
                        ColumnDef::new(TeamSlot::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_team_slot_team")
                            .from(TeamSlot::Table, TeamSlot::TeamId)
                            .to(Team::Table, Team::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // team_task: a task assigned to a member slot.
        manager
            .create_table(
                Table::create()
                    .table(TeamTask::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TeamTask::Id)
                            .string_len(36)
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TeamTask::TeamId)
                            .string_len(36)
                            .not_null(),
                    )
                    .col(ColumnDef::new(TeamTask::Subject).string().not_null())
                    .col(ColumnDef::new(TeamTask::Description).text().null())
                    // 'pending' | 'in_progress' | 'completed' | 'failed'
                    .col(
                        ColumnDef::new(TeamTask::Status)
                            .string()
                            .not_null()
                            .default("pending"),
                    )
                    .col(
                        ColumnDef::new(TeamTask::OwnerSlotId)
                            .string_len(36)
                            .not_null(),
                    )
                    .col(ColumnDef::new(TeamTask::Result).text().null())
                    // Member conversation minted for this task; SET NULL on delete.
                    .col(ColumnDef::new(TeamTask::ConversationId).integer().null())
                    .col(
                        ColumnDef::new(TeamTask::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_team_task_team")
                            .from(TeamTask::Table, TeamTask::TeamId)
                            .to(Team::Table, Team::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_team_task_owner")
                            .from(TeamTask::Table, TeamTask::OwnerSlotId)
                            .to(TeamSlot::Table, TeamSlot::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // Team detail load: slots + tasks by team id.
        manager
            .create_index(
                Index::create()
                    .name("idx_team_slot_team")
                    .table(TeamSlot::Table)
                    .col(TeamSlot::TeamId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_team_task_team_status")
                    .table(TeamTask::Table)
                    .col(TeamTask::TeamId)
                    .col(TeamTask::Status)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TeamTask::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(TeamSlot::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(Team::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(DeriveIden)]
enum Team {
    Table,
    Id,
    Name,
    LeaderSlotId,
    Workspace,
    LeaderConversationId,
    CreatedAt,
}

#[derive(DeriveIden)]
enum TeamSlot {
    Table,
    Id,
    TeamId,
    AgentType,
    Roles,
    DisplayName,
    Status,
    CreatedAt,
}

#[derive(DeriveIden)]
enum TeamTask {
    Table,
    Id,
    TeamId,
    Subject,
    Description,
    Status,
    OwnerSlotId,
    Result,
    ConversationId,
    CreatedAt,
}
