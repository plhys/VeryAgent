import os
p = os.getcwd()
targets = ['base-ui', 'fira-code', 'geist', 'geist-mono']
for t in targets:
    found = False
    for r, dirs, files in os.walk(p + '/src'):
        for f in files:
            if f.endswith(('.ts', '.tsx', '.css', '.json')):
                try:
                    content = open(os.path.join(r, f), 'r', encoding='utf-8', errors='ignore').read()
                    if t in content:
                        print(f'FOUND: {t} in {os.path.relpath(os.path.join(r,f), p)}')
                        found = True
                except:
                    pass
    if not found:
        print(f'NOT FOUND: {t}')
