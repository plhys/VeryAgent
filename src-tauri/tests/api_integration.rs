//! HTTP API integration tests.
//!
//! Builds the real Axum router from `web::router::build_router`, wired to an
//! in-memory SQLite database (`fresh_in_memory_db`) and a `WebOnly` event
//! emitter (`EventEmitter::test_web_only`). Drives requests through
//! `axum-test::TestServer` so no TCP socket is involved.
//!
//! Scope of this first pass:
//! - Authentication matrix on a representative protected endpoint
//! - Public endpoint (`get_system_language_settings`) reachable without token
//! - One DB-backed endpoint (`list_folders`) returns expected JSON shape
//!
//! Not covered: WebSocket attach (separate concern), endpoints that touch the
//! Tauri webview (those are gated behind `tauri-runtime`).

use std::sync::Arc;

use axum_test::TestServer;
use veryagent_lib::app_state::AppState;
use veryagent_lib::db::test_helpers::fresh_in_memory_db;
use veryagent_lib::web::router::build_router;
use veryagent_lib::web::shutdown::ShutdownSignal;
use serde_json::{json, Value};

const TEST_TOKEN: &str = "integration-test-token";

async fn build_test_server() -> (TestServer, tempfile::TempDir, tempfile::TempDir) {
    let data_dir = tempfile::tempdir().expect("data dir");
    let static_dir = tempfile::tempdir().expect("static dir");

    let db = fresh_in_memory_db().await;
    let state = Arc::new(AppState::new_for_test(db, data_dir.path().to_path_buf()));
    let shutdown = Arc::new(ShutdownSignal::new());

    let router = build_router(
        state,
        TEST_TOKEN.to_string(),
        static_dir.path().to_path_buf(),
        shutdown,
    );

    let server = TestServer::new(router).expect("test server");
    // Keep data_dir and static_dir alive for the whole test by returning them.
    (server, data_dir, static_dir)
}

// ────────────────────────────────────────────────────────────────────────────
// Auth matrix
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn protected_endpoint_rejects_missing_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server.post("/api/list_folders").json(&json!({})).await;
    assert_eq!(resp.status_code(), 401);
}

#[tokio::test]
async fn protected_endpoint_rejects_wrong_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/list_folders")
        .add_header("authorization", "Bearer wrong-token")
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 401);
}

#[tokio::test]
async fn protected_endpoint_accepts_correct_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/list_folders")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
}

// ────────────────────────────────────────────────────────────────────────────
// Public endpoint
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn public_language_settings_reachable_without_token() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/get_system_language_settings")
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body: Value = resp.json();
    // Shape contract: returns a JSON object (exact fields vary by default).
    assert!(body.is_object(), "expected object body, got {body}");
}

// ────────────────────────────────────────────────────────────────────────────
// DB-backed endpoint
// ────────────────────────────────────────────────────────────────────────────

// Note: `/api/list_folders` invokes every parser against the *real* user home
// directory, so it can't be asserted to-be-empty without elaborate filesystem
// isolation. We test DB-backed endpoints (`load_folder_history`,
// `list_open_folders`) instead — those only touch the in-memory SQLite.

#[tokio::test]
async fn load_folder_history_returns_empty_array_on_fresh_db() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/load_folder_history")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body: Value = resp.json();
    assert_eq!(
        body.as_array().expect("array body").len(),
        0,
        "fresh DB should have no folder history"
    );
}

#[tokio::test]
async fn open_folder_then_list_open_folders_shows_it() {
    let (server, _data, _static) = build_test_server().await;
    let open_resp = server
        .post("/api/open_folder")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({"path": "/tmp/veryagent-test-folder"}))
        .await;
    assert_eq!(
        open_resp.status_code(),
        200,
        "open_folder failed: {}",
        open_resp.text()
    );

    let list_resp = server
        .post("/api/list_open_folders")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(list_resp.status_code(), 200);
    let body: Value = list_resp.json();
    let arr = body.as_array().expect("array");
    assert_eq!(
        arr.len(),
        1,
        "list_open_folders should reflect the open_folder call, got {body}"
    );
}

#[tokio::test]
async fn acp_find_connection_for_conversation_returns_null_when_none_live() {
    // No live ACP connection is bound to any conversation on a fresh server, so
    // discovery returns JSON `null` (Option::None) with 200 — the frontend
    // reads this as "no live owner, open the persisted detail instead".
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/acp_find_connection_for_conversation")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({"conversationId": 999, "agentType": "claude_code"}))
        .await;
    assert_eq!(resp.status_code(), 200, "body: {}", resp.text());
    let body: Value = resp.json();
    assert!(
        body.is_null(),
        "expected null for an unbound conversation, got {body}"
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Field naming sanity (snake_case ↔ camelCase boundary)
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn health_endpoint_returns_status_field() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/health")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    let body: Value = resp.json();
    assert_eq!(body["status"], "ok");
}

#[tokio::test]
async fn unknown_endpoint_returns_501_with_typed_error() {
    let (server, _data, _static) = build_test_server().await;
    let resp = server
        .post("/api/this_endpoint_does_not_exist")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 501);
    let body: Value = resp.json();
    assert_eq!(body["code"], "not_implemented");
    assert!(body["message"].is_string());
}

// ────────────────────────────────────────────────────────────────────────────
// Live feedback settings + submit gate
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn feedback_settings_round_trip_defaults_off() {
    let (server, _data, _static) = build_test_server().await;
    // Default is OFF (opt-in feature).
    let resp = server
        .post("/api/get_feedback_settings")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.status_code(), 200);
    assert_eq!(resp.json::<Value>()["enabled"], false);

    // Enable it.
    let resp = server
        .post("/api/set_feedback_settings")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({ "settings": { "enabled": true } }))
        .await;
    assert_eq!(resp.status_code(), 200);
    assert_eq!(resp.json::<Value>()["enabled"], true);

    // Reads back enabled.
    let resp = server
        .post("/api/get_feedback_settings")
        .add_header("authorization", format!("Bearer {TEST_TOKEN}"))
        .json(&json!({}))
        .await;
    assert_eq!(resp.json::<Value>()["enabled"], true);
}

// The submit gate is per-connection (the agent's actual `check_user_feedback`
// capability, unit-tested in `ConnectionManager::submit_feedback`
// (`submit_feedback_rejected_when_tool_unavailable`), not via the global setting.

// ────────────────────────────────────────────────────────────────────────────
// Team collaboration Step 1: assign-task w/ conversation + slot status
// ────────────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn team_assign_task_with_conversation_then_set_slot_status() {
    let (server, _data, _static) = build_test_server().await;
    let auth = format!("Bearer {TEST_TOKEN}");

    // Create a team with a leader + one dev member.
    let create_resp = server
        .post("/api/team_create")
        .add_header("authorization", &auth)
        .json(&json!({
            "draft": {
                "name": "E2E Team",
                "workspace": "/tmp/veryagent-team-workspace",
                "slots": [
                    {
                        "agentType": "claude_code",
                        "displayName": "Lead",
                        "roles": ["leader", "dev"]
                    },
                    {
                        "agentType": "codex",
                        "displayName": "Dev",
                        "roles": ["dev"]
                    }
                ]
            }
        }))
        .await;
    assert_eq!(create_resp.status_code(), 200, "create: {}", create_resp.text());
    let team: Value = create_resp.json();
    let team_id = team["id"].as_str().expect("team id").to_string();
    assert_eq!(team["slots"].as_array().map(|a| a.len()), Some(2));

    // Grab the dev (non-leader) slot id.
    let slots = team["slots"].as_array().expect("slots array");
    let dev_slot = slots
        .iter()
        .find(|s| !s["roles"].as_array().unwrap().iter().any(|r| r == "leader"))
        .expect("dev slot");
    let dev_slot_id = dev_slot["id"].as_str().expect("dev slot id").to_string();
    assert_eq!(
        dev_slot["conversation_id"],
        Value::Null,
        "no conversation yet"
    );

    // Assign a task with a conversation_id — slot should flip to working and
    // carry the conversation; the task records it too.
    let assign_resp = server
        .post("/api/team_assign_task")
        .add_header("authorization", &auth)
        .json(&json!({
            "teamId": team_id,
            "ownerSlotId": dev_slot_id,
            "subject": "Build the landing page",
            "description": "Use the existing design tokens.",
            "conversationId": 42
        }))
        .await;
    assert_eq!(
        assign_resp.status_code(),
        200,
        "assign: {}",
        assign_resp.text()
    );
    let task: Value = assign_resp.json();
    assert_eq!(task["subject"], "Build the landing page");
    assert_eq!(task["owner_slot_id"], dev_slot_id);
    assert_eq!(task["conversation_id"], 42);
    assert_eq!(task["status"], "pending");

    // Re-fetch the team: the slot now points at the conversation and is working.
    let get_resp = server
        .post("/api/team_get")
        .add_header("authorization", &auth)
        .json(&json!({ "id": team_id }))
        .await;
    assert_eq!(get_resp.status_code(), 200, "get: {}", get_resp.text());
    let refreshed: Value = get_resp.json();
    let refreshed_dev = refreshed["slots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"].as_str() == Some(dev_slot_id.as_str()))
        .expect("dev slot in team_get");
    assert_eq!(refreshed_dev["conversation_id"], 42);
    assert_eq!(refreshed_dev["status"], "working");
    assert_eq!(
        refreshed["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|t| t["id"].as_str() == task["id"].as_str())
            .map(|t| t["conversation_id"].as_i64()),
        Some(Some(42))
    );

    // team_set_slot_status: flip the member back to idle.
    let status_resp = server
        .post("/api/team_set_slot_status")
        .add_header("authorization", &auth)
        .json(&json!({ "slotId": dev_slot_id, "status": "idle" }))
        .await;
    assert_eq!(
        status_resp.status_code(),
        200,
        "set slot status: {}",
        status_resp.text()
    );
    let slot: Value = status_resp.json();
    assert_eq!(slot["id"].as_str(), Some(dev_slot_id.as_str()));
    assert_eq!(slot["status"], "idle");
    // conversation_id survives a status flip (it's only cleared by re-assign).
    assert_eq!(slot["conversation_id"], 42);
}
