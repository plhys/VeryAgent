import json
en = json.load(open('src/i18n/messages/en.json', encoding='utf-8'))
zh = json.load(open('src/i18n/messages/zh-CN.json', encoding='utf-8'))
# Compare keys
for k in sorted(en):
    ev = en[k]
    zv = zh.get(k, '')
    if isinstance(ev, str) and isinstance(zv, str):
        if ev == zv:
            print(f'SAME: {k} = "{ev[:50]}"')
    elif isinstance(ev, dict) and isinstance(zv, dict):
        # Compare nested
        for sk in sorted(ev):
            if ev[sk] == zv.get(sk, ''):
                print(f'SAME: {k}.{sk} = "{ev[sk][:50]}"')
