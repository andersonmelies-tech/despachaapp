#!/usr/bin/env python3
"""
DespachaApp Bot - Telegram
Acessa SQLite diretamente. Sem ConversationHandler (sem estado perdível).
"""
import os, sys, sqlite3
from datetime import datetime

for _s in (sys.stdout, sys.stderr):
    if _s and hasattr(_s, 'reconfigure'):
        try: _s.reconfigure(encoding='utf-8', errors='replace')
        except: pass

try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
    from telegram.ext import (ApplicationBuilder, CommandHandler,
                               CallbackQueryHandler, MessageHandler,
                               filters, ContextTypes)
    TELEGRAM_OK = True
except ImportError:
    TELEGRAM_OK = False

# ── Banco ─────────────────────────────────────────────────────────────────────
DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tasks.db")

def get_db():
    conn = sqlite3.connect(DB, timeout=10, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")   # leitura fresca entre processos
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def db_one(sql, params=()):
    conn = get_db(); row = conn.execute(sql, params).fetchone(); conn.close()
    return dict(row) if row else None

def db_all(sql, params=()):
    conn = get_db(); rows = conn.execute(sql, params).fetchall(); conn.close()
    return [dict(r) for r in rows]

def db_run(sql, params=()):
    conn = get_db(); cur = conn.execute(sql, params); conn.commit()
    lid = cur.lastrowid; conn.close(); return lid

# ── Token ─────────────────────────────────────────────────────────────────────
def get_token():
    try:
        row = db_one("SELECT value FROM config WHERE key='telegram_token'")
        t = (row or {}).get("value", "").strip()
        if t and len(t) > 20: return t
    except Exception as e:
        print(f"[DESPACHA] Erro ao ler token: {e}")
    return os.getenv("TELEGRAM_TOKEN", "").strip()

# ── Fotos ────────────────────────────────────────────────────────────────────────
async def send_task_photos(bot, chat_id, task):
    """Envia fotos de uma tarefa como álbum no Telegram."""
    import json as _j
    photos_json = task.get("photos")
    if not photos_json:
        return
    try:
        photos = _j.loads(photos_json)
    except Exception:
        return
    if not photos:
        return

    from telegram import InputMediaPhoto
    MAX_TG_BYTES = 9 * 1024 * 1024  # 9MB limite seguro do Telegram

    media = []
    for i, data_url in enumerate(photos[:10]):
        try:
            if "," not in data_url:
                continue
            b64_str  = data_url.split(",", 1)[1]
            img_bytes = base64.b64decode(b64_str)
            if len(img_bytes) > MAX_TG_BYTES:
                print(f"[DESPACHA] Foto {i+1} muito grande ({len(img_bytes)//1024}KB), pulando")
                continue
            img_buf       = io.BytesIO(img_bytes)
            img_buf.name  = f"foto_{i+1}.jpg"
            caption = f"📷 {i+1}/{len(photos)} — Tarefa #{task['id']}: {task['title']}" if i == 0 else None
            media.append(InputMediaPhoto(media=img_buf, caption=caption, parse_mode="Markdown"))
        except Exception as e:
            print(f"[DESPACHA] Erro ao preparar foto {i+1}: {e}")

    if not media:
        print(f"[DESPACHA] Nenhuma foto válida para enviar na tarefa #{task.get('id')}")
        return

    try:
        await bot.send_media_group(chat_id=int(chat_id), media=media)
        print(f"[DESPACHA] {len(media)} foto(s) enviadas para chat {chat_id}")
    except Exception as e:
        print(f"[DESPACHA] Erro ao enviar album: {e}")
        # Tenta enviar uma por uma se o álbum falhar
        for m in media:
            try:
                await bot.send_photo(chat_id=int(chat_id), photo=m.media,
                                     caption=m.caption, parse_mode="Markdown")
            except Exception as e2:
                print(f"[DESPACHA] Erro foto individual: {e2}")

# ── Labels ────────────────────────────────────────────────────────────────────
URG = {"critica":"🚨 CRÍTICA","alta":"🔴 Alta","media":"🟡 Média","baixa":"🟢 Baixa"}
STA = {"pendente":"⏳ Pendente","em_andamento":"🔧 Em andamento",
       "concluida":"✅ Concluída","cancelada":"❌ Cancelada"}

# ── Estado leve em memória (modo de digitação aguardado por chat) ─────────────
_waiting = {}  # {chat_id: {"mode": "name"|"search"|"note", "note_task": int|None}}

def set_wait(chat_id, mode, note_task=None):
    _waiting[str(chat_id)] = {"mode": mode, "note_task": note_task}

def get_wait(chat_id):
    return _waiting.get(str(chat_id), {})

def clear_wait(chat_id):
    _waiting.pop(str(chat_id), None)

def fresh_read():
    """Força o SQLite a ler dados atualizados (WAL checkpoint)."""
    try:
        conn = get_db()
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        conn.close()
    except Exception:
        pass

# ── DB helpers ────────────────────────────────────────────────────────────────
def get_provider_by_chat(chat_id):
    return db_one("SELECT * FROM providers WHERE chat_id=? AND active=1", (str(chat_id),))

def get_provider_by_name(name):
    return db_one("SELECT * FROM providers WHERE LOWER(name) LIKE LOWER(?) AND active=1",
                  (f"%{name}%",))

def link_provider(provider_id, chat_id):
    db_run("UPDATE providers SET chat_id=? WHERE id=?", (str(chat_id), provider_id))

def get_tasks(chat_id=None, status=None, urgency=None, overdue=False, search=None):
    q = "SELECT * FROM tasks WHERE 1=1"; p = []
    if chat_id:
        prov = get_provider_by_chat(chat_id)
        if prov: q += " AND assignee_id=?"; p.append(prov["id"])
        else: return []
    if status:  q += " AND status=?";  p.append(status)
    if urgency: q += " AND urgency=?"; p.append(urgency)
    if overdue:
        now   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        today = datetime.now().strftime("%Y-%m-%d")
        q += (" AND ((due_date<? OR (sla_deadline IS NOT NULL AND sla_deadline<?))"
              " AND status NOT IN ('concluida','cancelada'))")
        p += [today, now]
    if search:
        q += " AND (title LIKE ? OR description LIKE ? OR requester LIKE ?)"
        p += [f"%{search}%"] * 3
    q += (" ORDER BY CASE urgency WHEN 'critica' THEN 1 WHEN 'alta' THEN 2"
          " WHEN 'media' THEN 3 ELSE 4 END, id DESC")
    return db_all(q, p)

def update_task(task_id, chat_id, **fields):
    task = db_one("SELECT * FROM tasks WHERE id=?", (task_id,))
    if not task: return None
    now  = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sets, params = [], []
    for k, v in fields.items(): sets.append(f"{k}=?"); params.append(v)
    if "status" in fields:
        ns = fields["status"]
        if ns == "em_andamento" and not task.get("started_at"):
            sets.append("started_at=?"); params.append(now)
        if ns == "concluida":
            sets.append("completed_at=?"); params.append(now)
            if task.get("started_at"):
                try:
                    e = int((datetime.now() -
                             datetime.strptime(task["started_at"], "%Y-%m-%d %H:%M:%S")
                             ).total_seconds() / 60)
                    sets.append("elapsed_minutes=?"); params.append(e)
                except: pass
    sets.append("updated_at=datetime('now','localtime')"); params.append(task_id)
    db_run(f"UPDATE tasks SET {','.join(sets)} WHERE id=?", params)
    for k, v in fields.items():
        if str(task.get(k)) != str(v):
            db_run("INSERT INTO task_history (task_id,action,old_value,new_value,changed_by) VALUES (?,?,?,?,?)",
                   (task_id, k, task.get(k), v, f"tg:{chat_id}"))
    return db_one("SELECT * FROM tasks WHERE id=?", (task_id,))

def get_stats(chat_id):
    prov = get_provider_by_chat(chat_id)
    if not prov: return None, {}, {}
    pid   = prov["id"]
    today = datetime.now().strftime("%Y-%m-%d")
    def cnt(sql, p): return (db_one(sql, p) or {}).get("c", 0)
    mine = {
        "total":     cnt("SELECT COUNT(*) c FROM tasks WHERE assignee_id=?", (pid,)),
        "concluidas":cnt("SELECT COUNT(*) c FROM tasks WHERE assignee_id=? AND status='concluida'", (pid,)),
        "andamento": cnt("SELECT COUNT(*) c FROM tasks WHERE assignee_id=? AND status='em_andamento'", (pid,)),
        "atrasadas": cnt("SELECT COUNT(*) c FROM tasks WHERE assignee_id=? AND due_date<? AND status NOT IN ('concluida','cancelada')", (pid, today)),
        "avg_min":   (db_one("SELECT AVG(elapsed_minutes) c FROM tasks WHERE assignee_id=? AND elapsed_minutes IS NOT NULL", (pid,)) or {}).get("c"),
    }
    geral = {
        "concluida":  cnt("SELECT COUNT(*) c FROM tasks WHERE status='concluida'", ()),
        "pendente":   cnt("SELECT COUNT(*) c FROM tasks WHERE status='pendente'", ()),
        "avg_minutes":(db_one("SELECT AVG(elapsed_minutes) c FROM tasks WHERE elapsed_minutes IS NOT NULL", ()) or {}).get("c"),
    }
    return prov, mine, geral

# ── Formatação ────────────────────────────────────────────────────────────────
def elapsed_str(m):
    if not m: return "–"
    h, mi = divmod(int(m), 60)
    return f"{h}h {mi}min" if h else f"{mi}min"

def fmt_short(t):
    urg = URG.get(t.get("urgency", ""), "")
    due = t.get("due_date", "") or "–"
    sla = t.get("sla_deadline", "")
    return f"{urg} *#{t['id']}* — {t['title']}\n   📅 {due}  👤 {t['assignee']}" + \
           (f"\n   ⏱ SLA: {sla[:16]}" if sla else "")

def fmt_detail(t):
    urg = URG.get(t.get("urgency", ""), "")
    sta = STA.get(t.get("status", ""), "")
    return (
        f"{urg} *Tarefa #{t['id']}*\n━━━━━━━━━━━━━━━━━━\n"
        f"📋 *{t['title']}*\n\n"
        f"📝 {t.get('description') or '–'}\n\n"
        f"👤 *Prestador:* {t['assignee']}\n"
        f"🏢 *Setor:* {t.get('sector') or '–'}\n"
        f"🏷 *Categoria:* {t.get('category') or '–'}\n"
        f"📅 *Prazo:* {t.get('due_date') or '–'}\n"
        f"⏱ *SLA:* {(t.get('sla_deadline') or '–')[:16]}\n"
        f"⚡ *Urgência:* {t.get('urgency','').upper()}\n"
        f"{sta} *Status:* {STA.get(t.get('status',''), t.get('status',''))}\n\n"
        f"🕐 *Iniciada:* {(t.get('started_at') or '–')[:16]}\n"
        f"✅ *Concluída:* {(t.get('completed_at') or '–')[:16]}\n"
        f"⏳ *Tempo total:* {elapsed_str(t.get('elapsed_minutes'))}\n\n"
        f"📌 *Obs:* {t.get('notes') or '–'}\n"
        f"📆 *Criada:* {str(t.get('created_at',''))[:16]}"
    )

def main_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📋 Minhas Tarefas",  callback_data="my_tasks"),
         InlineKeyboardButton("🔧 Em Andamento",    callback_data="in_progress")],
        [InlineKeyboardButton("🚨 Críticas",        callback_data="criticas"),
         InlineKeyboardButton("⏰ Atrasadas",       callback_data="atrasadas")],
        [InlineKeyboardButton("🔍 Buscar",          callback_data="search"),
         InlineKeyboardButton("📊 Meu Desempenho",  callback_data="stats")],
        [InlineKeyboardButton("✅ Concluídas Hoje", callback_data="done_today")],
    ])

def task_kb(t):
    tid = t["id"]; st = t.get("status", ""); rows = []
    if st == "pendente":
        rows.append([InlineKeyboardButton("▶️ INICIAR AGORA",    callback_data=f"start:{tid}")])
    if st == "em_andamento":
        rows.append([InlineKeyboardButton("✅ FINALIZAR TAREFA", callback_data=f"done:{tid}")])
    if st not in ("cancelada", "concluida"):
        rows.append([InlineKeyboardButton("❌ Cancelar",         callback_data=f"cancel:{tid}"),
                     InlineKeyboardButton("📌 Observação",       callback_data=f"note:{tid}")])
    rows.append([InlineKeyboardButton("🔙 Minhas Tarefas", callback_data="my_tasks"),
                 InlineKeyboardButton("🏠 Menu",            callback_data="menu")])
    return InlineKeyboardMarkup(rows)

# ── Handlers ──────────────────────────────────────────────────────────────────
async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id  = str(update.effective_chat.id)
    user     = update.effective_user
    clear_wait(chat_id)
    provider = get_provider_by_chat(chat_id)

    if not provider:
        fn = (user.first_name or "").strip()
        ln = (user.last_name  or "").strip()
        for nm in [f"{fn} {ln}".strip(), fn, ln]:
            if nm:
                p = get_provider_by_name(nm)
                if p:
                    link_provider(p["id"], chat_id)
                    provider = db_one("SELECT * FROM providers WHERE id=?", (p["id"],))
                    break

    if provider:
        await update.effective_message.reply_text(
            f"👷 Olá, *{provider['name']}*!\n"
            f"🏢 Setor: {provider.get('sector') or '–'}\n\n"
            f"Escolha uma opção:",
            parse_mode="Markdown", reply_markup=main_kb())
    else:
        set_wait(chat_id, "name")
        await update.effective_message.reply_text(
            "👷 Bem-vindo ao *DespachaApp*!\n\n"
            "Você ainda não está vinculado como prestador.\n"
            "Digite seu *nome completo* exatamente como cadastrado no sistema:",
            parse_mode="Markdown")

async def button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q       = update.callback_query
    await q.answer()
    data    = q.data
    chat_id = str(update.effective_chat.id)
    clear_wait(chat_id)

    # ── Menu principal ────────────────────────────────────────────────────
    if data == "menu":
        prov = get_provider_by_chat(chat_id)
        name = prov["name"] if prov else "Prestador"
        await q.edit_message_text(f"👷 *{name}* — Menu Principal:",
                                  parse_mode="Markdown", reply_markup=main_kb())
        return

    # ── Listas de tarefas ─────────────────────────────────────────────────
    if data == "my_tasks":
        # Força nova leitura do banco (sem cache) a cada clique
        conn = get_db()
        conn.execute("PRAGMA wal_checkpoint(PASSIVE)")
        conn.close()
        tasks = get_tasks(chat_id=chat_id, status="pendente") +                 get_tasks(chat_id=chat_id, status="em_andamento")
        tasks.sort(key=lambda x: {"critica":0,"alta":1,"media":2,"baixa":3}.get(x.get("urgency",""), 4))
        await show_list(q, tasks, "📋 Suas Tarefas Abertas"); return

    if data == "in_progress":
        fresh_read()
        await show_list(q, get_tasks(chat_id=chat_id, status="em_andamento"), "🔧 Em Andamento"); return

    if data == "criticas":
        tasks = [t for t in get_tasks(chat_id=chat_id, urgency="critica")
                 if t.get("status") not in ("concluida","cancelada")]
        await show_list(q, tasks, "🚨 Tarefas Críticas"); return

    if data == "atrasadas":
        fresh_read()
        await show_list(q, get_tasks(chat_id=chat_id, overdue=True), "⏰ Tarefas Atrasadas"); return

    if data == "done_today":
        today = datetime.now().strftime("%Y-%m-%d")
        tasks = [t for t in get_tasks(chat_id=chat_id, status="concluida")
                 if (t.get("completed_at") or "").startswith(today)]
        await show_list(q, tasks, f"✅ Concluídas Hoje ({len(tasks)})"); return

    # ── Desempenho ────────────────────────────────────────────────────────
    if data == "stats":
        prov, mine, geral = get_stats(chat_id)
        if not prov:
            await q.edit_message_text("❌ Prestador não encontrado."); return
        msg = (f"📊 *Meu Desempenho — {prov['name']}*\n━━━━━━━━━━━━━━━━\n"
               f"📦 Total: *{mine['total']}*\n"
               f"✅ Concluídas: *{mine['concluidas']}*\n"
               f"🔧 Em andamento: *{mine['andamento']}*\n"
               f"⏰ Atrasadas: *{mine['atrasadas']}*\n"
               f"⏱ Tempo médio: *{elapsed_str(mine['avg_min'])}*\n\n"
               f"*📈 Geral da equipe:*\n"
               f"✅ {geral['concluida']} concluídas | ⏳ {geral['pendente']} pendentes\n"
               f"⏱ Média global: {elapsed_str(geral['avg_minutes'])}")
        await q.edit_message_text(msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]]))
        return

    # ── Buscar ────────────────────────────────────────────────────────────
    if data == "search":
        set_wait(chat_id, "search")
        await q.edit_message_text(
            "🔍 *Buscar tarefa*\n\nDigite parte do título, solicitante ou descrição:",
            parse_mode="Markdown")
        return

    # ── Ver tarefa ────────────────────────────────────────────────────────
    if data.startswith("view:"):
        task = db_one("SELECT * FROM tasks WHERE id=?", (int(data.split(":")[1]),))
        if not task:
            await q.edit_message_text("❌ Tarefa não encontrada."); return
        await q.edit_message_text(fmt_detail(task), parse_mode="Markdown", reply_markup=task_kb(task))
        await send_task_photos(ctx.bot, chat_id, task)
        return

    # ── Iniciar tarefa ────────────────────────────────────────────────────
    if data.startswith("start:"):
        tid  = int(data.split(":")[1])
        task = update_task(tid, chat_id, status="em_andamento")
        if task:
            await q.edit_message_text(
                f"▶️ *Tarefa #{tid} INICIADA!*\n\n"
                f"📋 {task['title']}\n"
                f"🕐 Início: {str(task.get('started_at',''))[:16]}\n\n"
                f"_O tempo de execução está sendo medido._",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("✅ FINALIZAR AGORA", callback_data=f"done:{tid}")],
                    [InlineKeyboardButton("🔙 Minhas Tarefas",  callback_data="my_tasks")]]))
        return

    # ── Finalizar tarefa ──────────────────────────────────────────────────
    if data.startswith("done:"):
        tid  = int(data.split(":")[1])
        task = update_task(tid, chat_id, status="concluida")
        if task:
            await q.edit_message_text(
                f"✅ *Tarefa #{tid} CONCLUÍDA!*\n\n"
                f"📋 {task['title']}\n\n"
                f"🕐 Iniciada: {str(task.get('started_at',''))[:16]}\n"
                f"🏁 Concluída: {str(task.get('completed_at',''))[:16]}\n"
                f"⏱ *Tempo total: {elapsed_str(task.get('elapsed_minutes'))}*",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("📋 Minhas Tarefas", callback_data="my_tasks"),
                    InlineKeyboardButton("🏠 Menu",           callback_data="menu")]]))
        return

    # ── Cancelar tarefa ───────────────────────────────────────────────────
    if data.startswith("cancel:"):
        tid = int(data.split(":")[1])
        update_task(tid, chat_id, status="cancelada")
        await q.edit_message_text(f"❌ Tarefa #{tid} cancelada.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]]))
        return

    # ── Observação ────────────────────────────────────────────────────────
    if data.startswith("note:"):
        tid = int(data.split(":")[1])
        set_wait(chat_id, "note", note_task=tid)
        await q.edit_message_text(
            f"📌 *Observação para tarefa #{tid}*\n\nDigite a observação:",
            parse_mode="Markdown")
        return

async def show_list(q, tasks, title):
    if not tasks:
        await q.edit_message_text(
            f"*{title}*\n\n_Nenhuma tarefa encontrada._", parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]]))
        return
    msg  = f"*{title}* — {len(tasks)} tarefa(s)\n━━━━━━━━━━━━━━━━\n"
    btns = []
    for t in tasks[:8]:
        msg += fmt_short(t) + "\n\n"
        urg_icon = URG.get(t.get("urgency",""),"")[:2]
        st_icon  = "🔧" if t["status"] == "em_andamento" else "⏳"
        btns.append([InlineKeyboardButton(
            f"{urg_icon}{st_icon} #{t['id']} — {t['title'][:28]}",
            callback_data=f"view:{t['id']}")])
    btns.append([InlineKeyboardButton("🔙 Menu", callback_data="menu")])
    await q.edit_message_text(msg, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(btns))

async def text_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Trata textos digitados pelo usuário conforme o modo de espera."""
    if not update.message or not update.message.text:
        return
    chat_id = str(update.effective_chat.id)
    wait    = get_wait(chat_id)
    mode    = wait.get("mode")

    if mode == "name":
        clear_wait(chat_id)
        name = update.message.text.strip()
        p    = get_provider_by_name(name)
        if p:
            link_provider(p["id"], chat_id)
            await update.message.reply_text(
                f"✅ Vinculado como *{p['name']}*!\n\nEscolha uma opção:",
                parse_mode="Markdown", reply_markup=main_kb())
        else:
            set_wait(chat_id, "name")
            await update.message.reply_text(
                f"❌ *'{name}'* não encontrado. Verifique e tente novamente:",
                parse_mode="Markdown")

    elif mode == "search":
        clear_wait(chat_id)
        term  = update.message.text.strip()
        tasks = get_tasks(chat_id=chat_id, search=term) or get_tasks(search=term)
        msg   = f"🔍 *'{term}'* — {len(tasks)} resultado(s)\n━━━━━━━━━━━━━━━━\n"
        btns  = []
        for t in tasks[:8]:
            msg += fmt_short(t) + "\n\n"
            btns.append([InlineKeyboardButton(f"#{t['id']} {t['title'][:32]}",
                                              callback_data=f"view:{t['id']}")])
        btns.append([InlineKeyboardButton("🔙 Menu", callback_data="menu")])
        await update.message.reply_text(msg, parse_mode="Markdown",
                                        reply_markup=InlineKeyboardMarkup(btns))

    elif mode == "note":
        clear_wait(chat_id)
        tid = wait.get("note_task")
        if tid:
            update_task(tid, chat_id, notes=update.message.text.strip())
            await update.message.reply_text(
                f"📌 Observação salva na tarefa *#{tid}*!", parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]]))
    else:
        # Mensagem sem contexto — mostra menu
        await start(update, ctx)

async def cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    clear_wait(str(update.effective_chat.id))
    await update.effective_message.reply_text(
        "Cancelado. Use /start para recomeçar.")

# ── Run ───────────────────────────────────────────────────────────────────────
def run_bot():
    if not TELEGRAM_OK:
        print("[DESPACHA-ERRO] Execute: pip install python-telegram-bot"); return
    token = get_token()
    if not token or len(token) < 20:
        print("[DESPACHA-ERRO] Token nao configurado. Configure em Configuracoes > Telegram."); return
    print("[DESPACHA] Iniciando... token: " + token[:12] + "...")
    app = (ApplicationBuilder().token(token)
           .read_timeout(30).write_timeout(30).connect_timeout(30).pool_timeout(30).build())

    # Handlers independentes — sem ConversationHandler, sem estado perdível
    app.add_handler(CommandHandler("start",  start))
    app.add_handler(CommandHandler("menu",   start))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))

    print("[DESPACHA] Rodando. Ctrl+C para parar.")
    app.run_polling(bootstrap_retries=-1, drop_pending_updates=True)

if __name__ == "__main__":
    run_bot()
