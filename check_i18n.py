import json
keys = json.load(open('src/i18n/messages/zh-CN.json', encoding='utf-8'))
print('Total keys:', len(keys))
for k, v in sorted(keys.items()):
    if isinstance(v, str):
        # Check if the value is still English (contains mostly ASCII)
        eng_ratio = sum(1 for c in v if c.isascii() and c.isalpha()) / max(len(v), 1)
        if eng_ratio > 0.8 and len(v) > 10:
            print(f'ENGLISH: {k} = "{v[:60]}"')
