import os, re, json

p = 'E:/AIcode/github/VeryAgent'
pkg = json.load(open(p + '/package.json', encoding='utf-8'))
all_deps = {}
all_deps.update(pkg.get('dependencies', {}))
all_deps.update(pkg.get('devDependencies', {}))

# Find all imports in src/
imports = set()
for r, dirs, files in os.walk(p + '/src'):
    for fn in files:
        if fn.endswith(('.ts', '.tsx')):
            with open(os.path.join(r, fn), 'r', encoding='utf-8', errors='ignore') as fp:
                for line in fp:
                    m = re.match(r'from\s+["\']([^"\']+)["\']', line) or re.match(r'import\s+["\']([^"\']+)["\']', line)
                    if m:
                        imports.add(m.group(1).split('/')[0])  # package name only

# Check each dependency
for dep in sorted(all_deps):
    # Check if the package name or its subpath appears in imports
    dep_base = dep.split('/')[0] if dep.startswith('@') else dep.split('/')[0]
    found = False
    for imp in imports:
        if imp.startswith(dep) or dep.startswith(imp):
            found = True
            break
    status = '✅ USED' if found else '⚠️ UNUSED?'
    print(f'{status}: {dep}')
