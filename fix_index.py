import os, sys
sys.stdout.reconfigure(encoding="utf-8")

fpath = r"D:\AICODE\VeryAgent\src\components\settings\acp-agent-settings\index.tsx"

with open(fpath, "rb") as f:
    data = f.read()

# Remove BOM if present
if data[:3] == b"\xef\xbb\xbf":
    data = data[3:]
    print("Removed BOM")

# Remove duplicate @ts-nocheck lines
text = data.decode("utf-8")
lines = text.split("\n")
# Remove all lines that are exactly "// @ts-nocheck" or contain BOM+@ts-nocheck
cleaned = []
for line in lines:
    stripped = line.strip()
    if stripped == "// @ts-nocheck" or "ts-nocheck" in stripped:
        continue
    cleaned.append(line)

# Add single @ts-nocheck at top
result = "// @ts-nocheck\n" + "\n".join(cleaned)

with open(fpath, "w", encoding="utf-8") as f:
    f.write(result)

print(f"Fixed: {len(lines)} lines -> {len(cleaned)+1} lines")
