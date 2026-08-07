import json
en = json.load(open('src/i18n/messages/en.json', encoding='utf-8'))
zh = json.load(open('src/i18n/messages/zh-CN.json', encoding='utf-8'))
print(f'EN keys: {len(en)}')
print(f'ZH keys: {len(zh)}')
# Find keys in EN that are missing in ZH
missing = [k for k in en if k not in zh]
print(f'Missing in ZH: {len(missing)}')
for k in missing[:20]:
    v = en[k]
    if isinstance(v, str):
        print(f'  {k} = "{v[:60]}"')
    else:
        print(f'  {k} = {type(v).__name__}')
