with open("src/ORPHostSession.ts", "r") as f:
    code = f.read()
code = code.replace("\\'", "'")
with open("src/ORPHostSession.ts", "w") as f:
    f.write(code)
