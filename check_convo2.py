f = open('src/lib/api/conversations.ts', encoding='utf-8').read()
lines = f.split('\n')
for i in range(225, 255):
    if i < len(lines):
        print(f'{i+1}: {lines[i]}')
