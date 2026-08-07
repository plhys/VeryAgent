import os
p = os.getcwd()
pp = p + '/src/app/(main)/project-boot'
if os.path.isdir(pp):
    for f in os.listdir(pp):
        print(f)
else:
    print('not found')
