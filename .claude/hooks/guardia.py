#!/usr/bin/env python3
"""Hook PreToolUse de JP Smoke. Sale con código 2 (bloquea) si:
1. Se intenta escribir en Pulso, GMDevz (Empresa), Pagina o Rutami: son solo de consulta (CLAUDE.md). Leer y copiar DESDE ahí sí se permite.
2. Un `git commit` lleva secretos o archivos .env en los cambios preparados.
"""
import json, re, shlex, subprocess, sys

PROTEGIDAS = ("/Developer/pulso", "/Developer/Empresa", "/Developer/Pagina", "/Developer/rutami", "/Developer/aura")
FICHAS_PERMITIDAS = ()
SIEMPRE_ESCRIBEN = {"rm", "rmdir", "mv", "touch", "mkdir", "chmod", "chown", "tee", "ln", "truncate", "unlink"}
COPIAN = {"cp", "rsync", "install", "ditto"}
HERRAMIENTAS = {"pnpm", "npm", "npx", "yarn", "supabase", "flutter", "dart", "git", "make"}
GIT_ESCRIBE = {"commit", "push", "reset", "checkout", "switch", "clean", "stash", "merge", "rebase", "add",
               "rm", "mv", "restore", "apply", "pull", "tag", "branch", "init"}
SECRETOS = re.compile(
    r"(sb_secret_[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|"
    r"sk_(live|test)_[A-Za-z0-9]{10,}|prv_(prod|test)_[A-Za-z0-9]{10,}|"
    r"-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|"
    r"postgres(ql)?://[^:\s/]+:(?!postgres@)[^@\s]{6,}@(?!127\.0\.0\.1|localhost))")


def bloquear(msg):
    print(msg, file=sys.stderr)
    sys.exit(2)


def protegida(texto):
    # Carpeta exacta: /Developer/rutami protege la app Flutter, no /Developer/rutami-web (otro repo, sí editable).
    return any(re.search(re.escape(p) + r"(?![\w.-])", texto) for p in PROTEGIDAS)


def tokens(segmento):
    try:
        lx = shlex.shlex(segmento, posix=True, punctuation_chars=True)
        lx.whitespace_split = True
        return list(lx)
    except ValueError:
        return segmento.split()


def revisar_bash(cmd):
    dentro = False  # tras un `cd` a una carpeta protegida
    for seg in re.split(r"&&|\|\||;|\||\n", cmd):
        t = tokens(seg.strip())
        if not t:
            continue
        # Redirecciones: solo importa el destino.
        for i, tok in enumerate(t):
            if tok in (">", ">>") and i + 1 < len(t) and protegida(t[i + 1]):
                return "redirige la salida hacia proyectos de referencia"
        verbo = t[0]
        if verbo == "cd":
            dentro = len(t) > 1 and protegida(t[1])
            continue
        args = t[1:]
        if verbo in SIEMPRE_ESCRIBEN or (verbo == "sed" and any(a.startswith("-i") for a in args)):
            if dentro or any(protegida(a) for a in args):
                return f"usa `{verbo}` sobre proyectos de referencia"
        if verbo in COPIAN:
            destinos = [a for a in args if not a.startswith("-") and a not in (">", ">>")]
            if destinos and (protegida(destinos[-1]) or (dentro and not destinos[-1].startswith("/"))):
                return f"copia hacia proyectos de referencia con `{verbo}`"
        if verbo == "find" and ("-delete" in args or "-exec" in args) and (dentro or protegida(seg)):
            return "borra o ejecuta con `find` dentro de proyectos de referencia"
        if verbo in HERRAMIENTAS:
            if verbo == "git":
                sub = next((a for a in args if not a.startswith("-") and not protegida(a)), "")
                if sub in GIT_ESCRIBE and (dentro or protegida(seg)):
                    return f"ejecuta `git {sub}` en proyectos de referencia"
            elif dentro or protegida(seg):
                return f"ejecuta `{verbo}` dentro de proyectos de referencia"
    return None


data = json.load(sys.stdin)
tool = data.get("tool_name", "")
entrada = data.get("tool_input", {}) or {}

if tool in ("Edit", "Write", "NotebookEdit", "MultiEdit"):
    ruta = entrada.get("file_path", "") or entrada.get("notebook_path", "")
    if protegida(ruta) and not ruta.endswith(FICHAS_PERMITIDAS):
        bloquear(f"Bloqueado: {ruta} es de solo lectura (proyecto de referencia). Copia a JP Smoke lo que necesites.")

if tool == "Bash":
    cmd = entrada.get("command", "")
    motivo = revisar_bash(cmd)
    if motivo:
        bloquear(f"Bloqueado: el comando {motivo} (solo lectura). Leer y copiar desde ahí hacia JP Smoke sí se permite.")
    if re.search(r"\bgit\b[^|;&]*\bcommit\b", cmd):
        cwd = data.get("cwd") or None
        try:
            diff = subprocess.run(["git", "diff", "--cached", "-U0"], capture_output=True, text=True, cwd=cwd, timeout=20).stdout
            archivos = subprocess.run(["git", "diff", "--cached", "--name-only"], capture_output=True, text=True, cwd=cwd, timeout=20).stdout.split()
        except Exception:
            diff, archivos = "", []
        agregadas = "\n".join(l for l in diff.splitlines() if l.startswith("+") and not l.startswith("+++"))
        hallado = SECRETOS.search(agregadas)
        if hallado:
            bloquear(f"Bloqueado: el commit parece llevar un secreto ({hallado.group(0)[:12]}…). "
                     "Muévelo al Llavero de macOS o a .env (ignorado) y vuelve a intentar.")
        # .env.production (raíz) solo lleva variables PÚBLICAS (PUBLIC_*).
        env = [f for f in archivos if re.search(r"(^|/)\.env(\.|$)", f) and not f.endswith(".env.example") and f != ".env.production"]
        if env:
            bloquear(f"Bloqueado: no se suben archivos .env ({', '.join(env)}). Solo .env.example y .env.production (públicas).")
sys.exit(0)
