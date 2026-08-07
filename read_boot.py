import os
p = os.getcwd()
f = p + '/src/app/(main)/project-boot/page.tsx'
print(open(f, encoding='utf-8').read()[:2000])
