import re
f = open('src-tauri/src/commands/conversations.rs', 'r', encoding='utf-8').read()
old = '    // If the conversation has an active connection but no pending user message\n    // (e.g., after TurnComplete), signal to the frontend that this is a live\n    // session so it preserves localTurns instead of clobbering them with DB turns.\n    if detail.in_flight_user_turn_id.is_none()\n        && manager.find_connection_by_conversation_id(conversation_id).await.is_some()\n    {\n        detail.in_flight_user_turn_id = Some("live".to_string());\n    }'
new = '    // If the conversation has an active connection, strip assistant turns from\n    // detail.turns so the frontend doesn\'t render them alongside the streaming\n    // localTurns (which have different IDs and would not be deduplicated).\n    // The frontend\'s liveMessage/localTurns are the authoritative source during\n    // a live session; DB turns are only for cold starts.\n    if manager.find_connection_by_conversation_id(conversation_id).await.is_some()\n    {\n        detail.turns.retain(|t| t.role != crate::models::message::TurnRole::Assistant);\n    }'
assert old in f, 'old text not found!'
f = f.replace(old, new, 1)
open('src-tauri/src/commands/conversations.rs', 'w', encoding='utf-8').write(f)
print('PATCH_OK')