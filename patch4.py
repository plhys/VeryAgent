import re
f = open('src-tauri/src/commands/conversations.rs', 'r', encoding='utf-8').read()
old = '        detail.turns.retain(|t| t.role != crate::models::message::TurnRole::Assistant);'
new = '        detail.turns.retain(|t| !matches!(t.role, crate::models::message::TurnRole::Assistant));'
assert old in f, 'old text not found!'
f = f.replace(old, new, 1)
open('src-tauri/src/commands/conversations.rs', 'w', encoding='utf-8').write(f)
print('PATCH_OK')