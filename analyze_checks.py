import re

with open(r"D:\AICODE\VeryAgent\src\components\settings\acp-agent-settings\checks.ts", "r", encoding="utf-8") as f:
    content = f.read()

# Remove import block and @ts-nocheck
lines = content.split("\n")
body_start = 0
for i, line in enumerate(lines):
    if line.strip().startswith("export function") or line.strip().startswith("function") or line.strip().startswith("const"):
        body_start = i
        break

body = "\n".join(lines[body_start:])

# Find all identifiers used
identifiers = set()
for match in re.finditer(r'\b([A-Z][a-zA-Z0-9_]+)\b', body):
    identifiers.add(match.group(1))

# Common TS/JS built-ins to exclude
builtins = {"Array", "String", "Number", "Boolean", "Object", "Function", 
            "Promise", "Error", "Date", "RegExp", "Map", "Set", "Symbol",
            "Record", "Partial", "Pick", "Omit", "Exclude", "Extract",
            "NonNullable", "ReturnType", "Parameters", "Readonly", "Required",
            "keyof", "typeof", "never", "unknown", "any", "void", "undefined",
            "null", "true", "false", "as", "const", "from", "import", "export"}

used = identifiers - builtins
print("Identifiers used in checks.ts body:")
for name in sorted(used):
    count = body.count(name)
    if count > 0:
        print(f"  {name}: {count}")
