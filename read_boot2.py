import os
p = os.getcwd()
f = p + '/src/components/project-boot/project-boot-workspace.tsx'
print(open(f, encoding='utf-8').read()[:3000])
