import os, json
p = 'E:/AIcode/github/VeryAgent'
print('--- 大目录 ---')
dirs = ['node_modules', 'src-tauri/target', 'src-tauri/node_modules', '.next', '.codegraph', '.git']
for d in dirs:
    path = p + '/' + d
    if os.path.exists(path):
        size = sum(os.path.getsize(os.path.join(dirpath, f)) for dirpath, _, files in os.walk(path) for f in files) // 1024 // 1024
        print(f'{d}: {size} MB')

print('--- 大文件 (Rust) ---')
for root, dirs, files in os.walk(p + '/src-tauri/src'):
    for f in files:
        if f.endswith('.rs'):
            fp = os.path.join(root, f)
            sz = os.path.getsize(fp)
            if sz > 50000:
                print(f'{os.path.relpath(fp, p)}: {sz//1024} KB')

print('--- 大文件 (前端) ---')
for root, dirs, files in os.walk(p + '/src'):
    for f in files:
        if f.endswith(('.ts', '.tsx')):
            fp = os.path.join(root, f)
            sz = os.path.getsize(fp)
            if sz > 50000:
                print(f'{os.path.relpath(fp, p)}: {sz//1024} KB')

print('--- 依赖数 ---')
d = json.load(open(p + '/package.json'))
print(f'dependencies: {len(d.get("dependencies",{}))}')
print(f'devDependencies: {len(d.get("devDependencies",{}))}')
