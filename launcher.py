#!/usr/bin/env python3
"""
🚀 Despacha — Launcher com Ícone na Bandeja
Execute: python launcher.py
"""
import subprocess, sys, os, time, threading, webbrowser, signal

# ── Verifica / instala dependências ─────────────────────────────────────────
def check_deps():
    missing = []
    try: import fastapi
    except ImportError: missing.append("fastapi>=0.110.0")
    try: import uvicorn
    except ImportError: missing.append("uvicorn[standard]>=0.29.0")
    try: import requests
    except ImportError: missing.append("requests>=2.31.0")
    try: import pystray
    except ImportError: missing.append("pystray")
    try: from PIL import Image
    except ImportError: missing.append("pillow")
    try: import telegram
    except ImportError: missing.append("python-telegram-bot>=20.0")

    if missing:
        print(f"📦 Instalando: {', '.join(missing)}")
        subprocess.check_call([sys.executable, "-m", "pip", "install"] + missing)
        print("✅ Dependências instaladas!\n")

check_deps()

# ── Imports pós-instalação ───────────────────────────────────────────────────
import pystray
from PIL import Image, ImageDraw, ImageFont

# ── Estado global ────────────────────────────────────────────────────────────
procs = {"server": None, "bot": None}
status = {"server": False, "bot": False}
tray_icon = None

# ── Gera ícone dinamicamente (engrenagem + letras TM) ───────────────────────
def make_icon(server_ok=False, bot_ok=False):
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Fundo circular
    bg = (34, 197, 94) if (server_ok and bot_ok) else \
         (234, 179, 8) if server_ok else \
         (239, 68, 68)
    draw.ellipse([2, 2, size-2, size-2], fill=bg)

    # Texto "TM"
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except:
        font = ImageFont.load_default()

    text = "TM"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text(((size - tw) // 2, (size - th) // 2 - 2), text, fill="white", font=font)

    # Indicador bot (bolinha pequena canto inferior direito)
    dot_color = (74, 222, 128) if bot_ok else (248, 113, 113)
    draw.ellipse([size-16, size-16, size-4, size-4], fill=dot_color, outline="white", width=1)

    return img

# ── Inicia / para servidor ────────────────────────────────────────────────────
def start_server():
    if procs["server"] and procs["server"].poll() is None:
        return
    print("🖥  Iniciando servidor web (porta 8000)...")
    procs["server"] = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    status["server"] = True
    update_icon()

def stop_server():
    if procs["server"] and procs["server"].poll() is None:
        procs["server"].terminate()
        procs["server"] = None
    status["server"] = False
    update_icon()

# ── Inicia / para bot ─────────────────────────────────────────────────────────
def start_bot():
    token = os.getenv("TELEGRAM_TOKEN", "")
    if not token:
        print("⚠  TELEGRAM_TOKEN não configurado. Bot não iniciado.")
        return
    if procs["bot"] and procs["bot"].poll() is None:
        return
    print("🤖 Iniciando bot Telegram...")
    procs["bot"] = subprocess.Popen(
        [sys.executable, "bot.py"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    status["bot"] = True
    update_icon()

def stop_bot():
    if procs["bot"] and procs["bot"].poll() is None:
        procs["bot"].terminate()
        procs["bot"] = None
    status["bot"] = False
    update_icon()

# ── Atualiza ícone da bandeja ─────────────────────────────────────────────────
def update_icon():
    if tray_icon:
        tray_icon.icon = make_icon(status["server"], status["bot"])
        tray_icon.menu = build_menu()

# ── Monitora processos (reinicia se cair) ─────────────────────────────────────
def watchdog():
    while True:
        time.sleep(5)
        if status["server"] and (not procs["server"] or procs["server"].poll() is not None):
            print("⚠  Servidor caiu — reiniciando...")
            start_server()
        if status["bot"] and (not procs["bot"] or procs["bot"].poll() is not None):
            token = os.getenv("TELEGRAM_TOKEN", "")
            if token:
                print("⚠  Bot caiu — reiniciando...")
                start_bot()
        update_icon()

# ── Ações do menu da bandeja ──────────────────────────────────────────────────
def action_open_panel(icon, item):
    webbrowser.open("http://localhost:8000")

def action_toggle_server(icon, item):
    if status["server"]:
        stop_server()
    else:
        start_server()

def action_toggle_bot(icon, item):
    if status["bot"]:
        stop_bot()
    else:
        start_bot()

def action_restart_all(icon, item):
    stop_server(); stop_bot()
    time.sleep(1)
    start_server(); start_bot()

def action_quit(icon, item):
    print("\n👋 Encerrando Despacha...")
    stop_server(); stop_bot()
    icon.stop()

# ── Constrói menu ─────────────────────────────────────────────────────────────
def build_menu():
    srv_label = "🟢 Servidor: RODANDO" if status["server"] else "🔴 Servidor: PARADO"
    bot_label = "🟢 Bot: RODANDO" if status["bot"] else "🔴 Bot: PARADO"
    srv_action = "⏹ Parar Servidor" if status["server"] else "▶️ Iniciar Servidor"
    bot_action = "⏹ Parar Bot" if status["bot"] else "▶️ Iniciar Bot"

    return pystray.Menu(
        pystray.MenuItem("⚙  Despacha", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(srv_label, None, enabled=False),
        pystray.MenuItem(bot_label, None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("🌐 Abrir Painel Web", action_open_panel),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem(srv_action, action_toggle_server),
        pystray.MenuItem(bot_action, action_toggle_bot),
        pystray.MenuItem("🔄 Reiniciar Tudo", action_restart_all),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("❌ Sair", action_quit),
    )

# ── MAIN ──────────────────────────────────────────────────────────────────────
def main():
    global tray_icon

    print("=" * 50)
    print("⚙  DESPACHA — Launcher")
    print("=" * 50)

    # Inicia serviços
    start_server()
    start_bot()

    # Abre painel após 2s
    threading.Thread(target=lambda: (time.sleep(2), webbrowser.open("http://localhost:8000")), daemon=True).start()

    # Watchdog em background
    threading.Thread(target=watchdog, daemon=True).start()

    print("\n✅ Sistema iniciado!")
    print("📊 Painel: http://localhost:8000")
    print("🖥  Ícone na bandeja do sistema ativo.")
    print("🛑 Use o ícone na bandeja ou Ctrl+C para parar.\n")

    # Cria ícone na bandeja
    tray_icon = pystray.Icon(
        name="Despacha",
        icon=make_icon(status["server"], status["bot"]),
        title="Despacha — Gestão de Serviços",
        menu=build_menu()
    )
    tray_icon.run()

if __name__ == "__main__":
    main()
