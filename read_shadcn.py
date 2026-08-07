import os
p = os.getcwd()
f = p + '/src/components/project-boot/shadcn/shadcn-launcher.tsx'
print(open(f, encoding='utf-8').read()[:5000])
