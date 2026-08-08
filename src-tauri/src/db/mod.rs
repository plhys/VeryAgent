pub mod entities;
pub mod error;
pub mod migration;
pub mod service;

#[cfg(any(test, feature = "test-utils"))]
pub mod test_helpers;

use std::path::Path;
use std::time::Duration;

use sea_orm::{
    ConnectOptions, ConnectionTrait, Database, DatabaseConnection, DbBackend, Statement,
};
use sea_orm_migration::MigratorTrait;

use error::DbError;
use migration::Migrator;

/// 迁移记录表名（sea-orm 默认，注意是 `seaql_migrations`）。
const MIGRATION_TABLE: &str = "seaql_migrations";

/// 清理孤儿迁移记录。
///
/// 当某个迁移文件在重构中被删除（例如 quick_message 功能被移除，其迁移
/// `m20260424_000002_quick_message` 从 Migrator 列表消失），已应用过该迁移的
/// 旧数据库 `seaorm_migrations` 表仍保留其记录，`Migrator::up` 会因
/// “Migration file is missing but has been applied” 直接报错导致应用无法启动。
///
/// 这里在跑 `Migrator::up` 前先把“已应用但当前 Migrator 已不认识的版本”
/// 从迁移表中删除，让启动继续。删除是安全的：
/// 1. 迁移文件已从代码库移除，意味着其 schema 变更已被后续迁移覆盖或
///    该功能已下线（表已被 drop 或不再使用）。
/// 2. 我们只删 Migrator 列表里不存在的孤儿记录，不动任何仍受管的迁移。
async fn prune_orphan_migration_records(
    conn: &DatabaseConnection,
) -> Result<(), DbError> {
    // 当前 Migrator 认识的所有迁移名
    let known: Vec<String> = Migrator::migrations()
        .iter()
        .map(|m| m.name().to_string())
        .collect();
    if known.is_empty() {
        return Ok(());
    }

    // 全新数据库还没有迁移表（Migrator::up 首次运行才创建），无需清理。
    // 用 sqlite_master 判断表是否存在，避免对不存在的表查询报错。
    let table_exists: bool = conn
        .query_one(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name = '{MIGRATION_TABLE}'"
            ),
        ))
        .await
        .map_err(|e| DbError::Migration(format!("check migration table failed: {e}")))?
        .is_some();
    if !table_exists {
        return Ok(());
    }

    let rows: Vec<(String, i64)> = conn
        .query_all(Statement::from_string(
            DbBackend::Sqlite,
            format!(
                "SELECT version, applied_at FROM {MIGRATION_TABLE}"
            ),
        ))
        .await
        .map_err(|e| DbError::Migration(format!("read migration table failed: {e}")))?
        .into_iter()
        .map(|row| {
            (
                row.try_get("", "version")
                    .unwrap_or_default(),
                row.try_get("", "applied_at")
                    .unwrap_or_default(),
            )
        })
        .collect();

    for (version, applied_at) in rows {
        if !known.contains(&version) {
            tracing::warn!(
                "[db] pruning orphan migration record: {version} (applied_at={applied_at})"
            );
            // version 是代码库内部迁移名（自控，非用户输入），无注入风险。
            conn.execute(Statement::from_string(
                DbBackend::Sqlite,
                format!("DELETE FROM {MIGRATION_TABLE} WHERE version = '{version}'"),
            ))
            .await
            .map_err(|e| DbError::Migration(format!(
                "prune orphan migration {version} failed: {e}"
            )))?;
        }
    }

    Ok(())
}

pub struct AppDatabase {
    pub conn: DatabaseConnection,
}

pub(crate) fn database_file_name() -> &'static str {
    if cfg!(all(debug_assertions, feature = "tauri-runtime")) {
        "veryagent-dev.db"
    } else {
        "veryagent.db"
    }
}

pub async fn init_database(
    app_data_dir: impl AsRef<Path>,
    app_version: &str,
) -> Result<AppDatabase, DbError> {
    let app_data_dir = app_data_dir.as_ref();
    std::fs::create_dir_all(app_data_dir)?;

    // Apply any pending restore BEFORE opening a connection — swapping
    // `veryagent.db` under a live SQLite handle would corrupt it. A failure here
    // aborts startup loudly (leaving the safety snapshot intact) rather than
    // booting a half-restored data dir.
    match crate::commands::backup::restore::apply_pending_restore_on_startup(app_data_dir) {
        Ok(crate::commands::backup::restore::RestoreApplied::Applied { .. }) => {}
        Ok(crate::commands::backup::restore::RestoreApplied::None) => {}
        Err(e) => return Err(DbError::Io(e)),
    }
    crate::commands::backup::restore::cleanup_transient_dirs(app_data_dir);

    let db_path = app_data_dir.join(database_file_name());
    let db_url = format!(
        "sqlite:{}?mode=rwc",
        urlencoding::encode(&db_path.to_string_lossy())
    );

    // Apply migrations on a dedicated single connection. The runtime pool below
    // keeps several connections open for read concurrency, but sea-orm spreads a
    // migration's statements across whichever pooled connections are free. A
    // statement that references a column an earlier migration just added (e.g.
    // the `is_chat` → `kind` backfill) can then land on a connection whose
    // cached SQLite schema predates the `ALTER TABLE`, producing a flaky
    // `no such column: "is_chat"` under load. One connection observes every DDL
    // change in order, so the schema it compiles against is always current.
    let mut migrate_opts = ConnectOptions::new(db_url.clone());
    migrate_opts
        .max_connections(1)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(10))
        .sqlx_logging(false);
    let migrate_conn = Database::connect(migrate_opts).await?;
    apply_sqlite_pragmas(&migrate_conn).await?;
    // 先清理孤儿迁移记录，避免“迁移文件已删除但数据库仍标记已应用”导致
    // Migrator::up 报错（重构移除功能/迁移时会出现）。
    prune_orphan_migration_records(&migrate_conn).await?;
    Migrator::up(&migrate_conn, None)
        .await
        .map_err(|e| DbError::Migration(e.to_string()))?;
    migrate_conn.close().await?;

    // Runtime connection pool. Migrations are already applied above, so the
    // schema is stable and spreading queries across pooled connections is safe.
    let mut opts = ConnectOptions::new(db_url);
    opts.max_connections(5)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(10))
        .idle_timeout(Duration::from_secs(300))
        .sqlx_logging(false);
    let conn = Database::connect(opts).await?;
    apply_sqlite_pragmas(&conn).await?;

    service::app_metadata_service::update_app_version(&conn, app_version).await?;

    Ok(AppDatabase { conn })
}

/// Apply SQLite performance and reliability pragmas to a freshly opened
/// connection. `journal_mode=WAL` persists in the database header; the rest are
/// per-connection settings that must be re-applied every time a connection opens.
async fn apply_sqlite_pragmas(conn: &DatabaseConnection) -> Result<(), DbError> {
    for pragma in [
        "PRAGMA journal_mode=WAL;",
        "PRAGMA busy_timeout=5000;",
        "PRAGMA synchronous=NORMAL;",
        "PRAGMA foreign_keys=ON;",
        "PRAGMA cache_size=-8000;",
    ] {
        conn.execute(Statement::from_string(DbBackend::Sqlite, pragma.to_owned()))
            .await?;
    }
    Ok(())
}
