#!/usr/bin/env python3
"""
DespachaApp Bot - Telegram + Supabase
"""
import os, sys, base64, io
from datetime import datetime

for _s in (sys.stdout, sys.stderr):
    if _s and hasattr(_s, 'reconfigure'):
        try: _s.reconfigure(encoding='utf-8', errors='replace')
        except: pass

try:
    from supabase import create_client
    SUPABASE_OK = True
except ImportError:
    SUPABASE_OK = False
    print("[BOT] ERRO: instale supabase — pip install supabase")

try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, InputMediaPhoto
    from telegram.ext import (ApplicationBuilder, CommandHandler,
                               CallbackQueryHandler, MessageHandler,
                               filters, ContextTypes)
    TELEGRAM_OK = True
except ImportError:
    TELEGRAM_OK = False
    print("[BOT] ERRO: instale python-telegram-bot — pip install python-telegram-bot")

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "").strip()  # service_role key

sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_OK and SUPABASE_URL else None

def sb_one(table, **filters):
    if not sb: return None
    try:
        q = sb.table(table).select("*")
        for k, v in filters.items(): q = q.eq(k, v)
        r = q.limit(1).execute()
        return r.data[0] if r.data else None
    except Exception as e:
        print(f"[BOT] sb_one erro: {e}"); return None

def sb_all(table, order=None, **filters):
    if not sb: return []
    try:
        q = sb.table(table).select("*")
        for k, v in filters.items(): q = q.eq(k, v)
        if order: q = q.order(order)
        return q.execute().data or []
    except Exception as e:
        print(f"[BOT] sb_all erro: {e}"); return []

def sb_update(table, data, **filters):
    if not sb: return None
    try:
        q = sb.table(table).update(data)
        for k, v in filters.items(): q = q.eq(k, v)
        return q.execute().data
    except Exception as e:
        print(f"[BOT] sb_update erro: {e}"); return None

def sb_insert(table, data):
    if not sb: return None
    try:
        return sb.table(table).insert(data).execute().data
    except Exception as e:
        print(f"[BOT] sb_insert erro: {e}"); return None

# ── Token ─────────────────────────────────────────────────────────────────────
def get_token():
    row = sb_one("config", key="telegram_token")
    t = (row or {}).get("value", "").strip()
    if t and len(t) > 20: return t
    return os.environ.get("TELEGRAM_TOKEN", "").strip()

# ── DB helpers ────────────────────────────────────────────────────────────────
def get_provider_by_chat(chat_id):
    return sb_one("providers", chat_id=str(chat_id), active=1)

def get_provider_by_name(name):
    if not sb: return None
    try:
        r = sb.table("providers").select("*").ilike("name", f"%{name}%").eq("active", 1).limit(1).execute()
        return r.data[0] if r.data else None
    except: return None

def link_provider(provider_id, chat_id):
    sb_update("providers", {"chat_id": str(chat_id)}, id=provider_id)

def get_tasks(chat_id=None, status=None, urgency=None, overdue=False, search=None):
    if not sb: return []
    try:
        q = sb.table("tasks").select("*")
        if chat_id:
            prov = get_provider_by_chat(chat_id)
            if not prov: return []
            q = q.eq("assignee_id", prov["id"])
        if status:  q = q.eq("status", status)
        if urgency: q = q.eq("urgency", urgency)
        if overdue:
            now = datetime.now().isoformat()
            q = q.lt("sla_deadline", now).not_.in_("status", ["concluida", "cancelada"])
        if search:
            q = q.or_(f"title.ilike.%{search}%,description.ilike.%{search}%,requester.ilike.%{search}%")
        r = q.execute()
        tasks = r.data or []
        # Ordena por urgência
        ord_urg = {"critica": 0, "alta": 1, "media": 2, "baixa": 3}
        return sorted(tasks, key=lambda x: (ord_urg.get(x.get("urgency",""), 4), -x["id"]))
    except Exception as e:
        print(f"[BOT] get_tasks erro: {e}"); return []

def update_task(task_id, chat_id, **fields):
    task = sb_one("tasks", id=task_id)
    if not task: return None
    now = datetime.now().isoformat()
    updates = dict(fields)
    if "status" in fields:
        ns = fields["status"]
        if ns == "em_andamento" and not task.get("started_at"):
            updates["started_at"] = now
        if ns == "concluida":
            updates["completed_at"] = now
            if task.get("started_at"):
                try:
                    e = int((datetime.now() - datetime.fromisoformat(task["started_at"].replace("Z",""))).total_seconds() / 60)
                    updates["elapsed_minutes"] = e
                except: pass
    sb_update("tasks", updates, id=task_id)
    # Histórico
    for k, v in fields.items():
        if str(task.get(k, "")) != str(v or ""):
            sb_insert("task_history", {"task_id": task_id, "action": k,
                "old_value": str(task.get(k, "")), "new_value": str(v or ""),
                "changed_by": f"tg:{chat_id}"})
    return sb_one("tasks", id=task_id)

def get_stats(chat_id):
    prov = get_provider_by_chat(chat_id)
    if not prov: return None, {}, {}
    pid = prov["id"]
    all_tasks = sb_all("tasks", assignee_id=pid) if sb else []
    global_tasks = sb.table("tasks").select("*").execute().data if sb else []
    today = datetime.now().date().isoformat()
    now = datetime.now().isoformat()
    mine = {
        "total":      len(all_tasks),
        "concluidas": sum(1 for t in all_tasks if t["status"] == "concluida"),
        "andamento":  sum(1 for t in all_tasks if t["status"] == "em_andamento"),
        "atrasadas":  sum(1 for t in all_tasks if t.get("due_date","") < today and t["status"] not in ("concluida","cancelada")),
        "avg_min":    None,
    }
    fin = [t for t in all_tasks if t.get("elapsed_minutes")]
    if fin: mine["avg_min"] = sum(t["elapsed_minutes"] for t in fin) // len(fin)
    gfin = [t for t in global_tasks if t.get("elapsed_minutes")]
    geral = {
        "concluida": sum(1 for t in global_tasks if t["status"] == "concluida"),
        "pendente":  sum(1 for t in global_tasks if t["status"] == "pendente"),
        "avg_minutes": sum(t["elapsed_minutes"] for t in gfin) // len(gfin) if gfin else None,
    }
    return prov, mine, geral

# ── Fotos ─────────────────────────────────────────────────────────────────────
async def send_task_photos(bot, chat_id, task):
    import json as _j
    photos_json = task.get("photos")
    if not photos_json: return
    try: photos = _j.loads(photos_json)
    except: return
    if not photos: return
    media = []
    for i, data_url in enumerate(photos[:10]):
        try:
            if "," not in data_url: continue
            img_bytes = base64.b64decode(data_url.split(",", 1)[1])
            if len(img_bytes) > 9 * 1024 * 1024: continue
            buf = io.BytesIO(img_bytes); buf.name = f"foto_{i+1}.jpg"
            caption = f"📷 {i+1}/{len(photos)} — #{task['id']}: {task['title']}" if i == 0 else None
            media.append(InputMediaPhoto(media=buf, caption=caption, parse_mode="Markdown"))
        except: pass
    if not media: return
    try:
        await bot.send_media_group(chat_id=int(chat_id), media=media)
    except:
        for m in media:
            try: await bot.send_photo(chat_id=int(chat_id), photo=m.media, caption=m.caption, parse_mode="Markdown")
            except: pass

# ── Labels ────────────────────────────────────────────────────────────────────
URG = {"critica": "🚨 CRÍTICA", "alta": "🔴 Alta", "media": "🟡 Média", "baixa": "🟢 Baixa"}
STA = {"pendente": "⏳ Pendente", "em_andamento": "🔧 Em andamento",
       "concluida": "✅ Concluída", "cancelada": "❌ Cancelada"}

_waiting = {}
def set_wait(chat_id, mode, note_task=None): _waiting[str(chat_id)] = {"mode": mode, "note_task": note_task}
def get_wait(chat_id): return _waiting.get(str(chat_id), {})
def clear_wait(chat_id): _waiting.pop(str(chat_id), None)

def elapsed_str(m):
    if not m: return "–"
    h, mi = divmod(int(m), 60)
    return f"{h}h {mi}min" if h else f"{mi}min"

def fmt_short(t):
    urg = URG.get(t.get("urgency", ""), "")
    due = (t.get("due_date") or "–")[:10]
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
        f"📅 *Prazo:* {(t.get('due_date') or '–')[:10]}\n"
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
    if st == "pendente":    rows.append([InlineKeyboardButton("▶️ INICIAR AGORA",    callback_data=f"start:{tid}")])
    if st == "em_andamento": rows.append([InlineKeyboardButton("✅ FINALIZAR TAREFA", callback_data=f"done:{tid}")])
    if st not in ("cancelada", "concluida"):
        rows.append([InlineKeyboardButton("❌ Cancelar", callback_data=f"cancel:{tid}"),
                     InlineKeyboardButton("📌 Observação", callback_data=f"note:{tid}")])
    rows.append([InlineKeyboardButton("🔙 Minhas Tarefas", callback_data="my_tasks"),
                 InlineKeyboardButton("🏠 Menu",            callback_data="menu")])
    return InlineKeyboardMarkup(rows)

# ── Handlers ──────────────────────────────────────────────────────────────────
async def start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    chat_id = str(update.effective_chat.id)
    user = update.effective_user
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
                    provider = sb_one("providers", id=p["id"])
                    break
    if provider:
        await update.effective_message.reply_text(
            f"👷 Olá, *{provider['name']}*!\n🏢 Setor: {provider.get('sector') or '–'}\n\nEscolha uma opção:",
            parse_mode="Markdown", reply_markup=main_kb())
    else:
        set_wait(chat_id, "name")
        await update.effective_message.reply_text(
            "👷 Bem-vindo ao *DespachaApp*!\n\nVocê ainda não está vinculado como prestador.\nDigite seu *nome completo* exatamente como cadastrado no sistema:",
            parse_mode="Markdown")

async def button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    data = q.data
    chat_id = str(update.effective_chat.id)
    clear_wait(chat_id)

    if data == "menu":
        prov = get_provider_by_chat(chat_id)
        name = prov["name"] if prov else "Prestador"
        await q.edit_message_text(f"👷 *{name}* — Menu Principal:", parse_mode="Markdown", reply_markup=main_kb())
        return

    if data == "my_tasks":
        tasks = get_tasks(chat_id=chat_id, status="pendente") + get_tasks(chat_id=chat_id, status="em_andamento")
        tasks.sort(key=lambda x: {"critica":0,"alta":1,"media":2,"baixa":3}.get(x.get("urgency",""), 4))
        await show_list(q, tasks, "📋 Suas Tarefas Abertas"); return

    if data == "in_progress":
        await show_list(q, get_tasks(chat_id=chat_id, status="em_andamento"), "🔧 Em Andamento"); return

    if data == "criticas":
        tasks = [t for t in get_tasks(chat_id=chat_id, urgency="critica")
                 if t.get("status") not in ("concluida","cancelada")]
        await show_list(q, tasks, "🚨 Tarefas Críticas"); return

    if data == "atrasadas":
        await show_list(q, get_tasks(chat_id=chat_id, overdue=True), "⏰ Tarefas Atrasadas"); return

    if data == "done_today":
        today = datetime.now().strftime("%Y-%m-%d")
        tasks = [t for t in get_tasks(chat_id=chat_id, status="concluida")
                 if (t.get("completed_at") or "").startswith(today)]
        await show_list(q, tasks, f"✅ Concluídas Hoje ({len(tasks)})"); return

    if data == "stats":
        prov, mine, geral = get_stats(chat_id)
        if not prov:
            await q.edit_message_text("❌ Prestador não encontrado."); return
        msg = (f"📊 *Meu Desempenho — {prov['name']}*\n━━━━━━━━━━━━━━━━\n"
               f"📦 Total: *{mine['total']}*\n✅ Concluídas: *{mine['concluidas']}*\n"
               f"🔧 Em andamento: *{mine['andamento']}*\n⏰ Atrasadas: *{mine['atrasadas']}*\n"
               f"⏱ Tempo médio: *{elapsed_str(mine['avg_min'])}*\n\n"
               f"*📈 Geral da equipe:*\n"
               f"✅ {geral['concluida']} concluídas | ⏳ {geral['pendente']} pendentes\n"
               f"⏱ Média global: {elapsed_str(geral['avg_minutes'])}")
        await q.edit_message_text(msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return

    if data == "search":
        set_wait(chat_id, "search")
        await q.edit_message_text("🔍 *Buscar tarefa*\n\nDigite parte do título, solicitante ou descrição:", parse_mode="Markdown"); return

    if data.startswith("view:"):
        task = sb_one("tasks", id=int(data.split(":")[1]))
        if not task:
            await q.edit_message_text("❌ Tarefa não encontrada."); return
        await q.edit_message_text(fmt_detail(task), parse_mode="Markdown", reply_markup=task_kb(task))
        await send_task_photos(ctx.bot, chat_id, task); return

    if data.startswith("start:"):
        tid = int(data.split(":")[1])
        task = update_task(tid, chat_id, status="em_andamento")
        if task:
            await q.edit_message_text(
                f"▶️ *Tarefa #{tid} INICIADA!*\n\n📋 {task['title']}\n🕐 Início: {str(task.get('started_at',''))[:16]}\n\n_O tempo de execução está sendo medido._",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("✅ FINALIZAR AGORA", callback_data=f"done:{tid}")],
                    [InlineKeyboardButton("🔙 Minhas Tarefas",  callback_data="my_tasks")]])); return

    if data.startswith("done:"):
        tid = int(data.split(":")[1])
        task = update_task(tid, chat_id, status="concluida")
        if task:
            await q.edit_message_text(
                f"✅ *Tarefa #{tid} CONCLUÍDA!*\n\n📋 {task['title']}\n\n🕐 Iniciada: {str(task.get('started_at',''))[:16]}\n🏁 Concluída: {str(task.get('completed_at',''))[:16]}\n⏱ *Tempo total: {elapsed_str(task.get('elapsed_minutes'))}*",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("📋 Minhas Tarefas", callback_data="my_tasks"),
                    InlineKeyboardButton("🏠 Menu",           callback_data="menu")]])); return

    if data.startswith("cancel:"):
        tid = int(data.split(":")[1])
        update_task(tid, chat_id, status="cancelada")
        await q.edit_message_text(f"❌ Tarefa #{tid} cancelada.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return

    if data.startswith("note:"):
        tid = int(data.split(":")[1])
        set_wait(chat_id, "note", note_task=tid)
        await q.edit_message_text(f"📌 *Observação para tarefa #{tid}*\n\nDigite a observação:", parse_mode="Markdown"); return

async def show_list(q, tasks, title):
    if not tasks:
        await q.edit_message_text(f"*{title}*\n\n_Nenhuma tarefa encontrada._", parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return
    msg  = f"*{title}* — {len(tasks)} tarefa(s)\n━━━━━━━━━━━━━━━━\n"
    btns = []
    for t in tasks[:8]:
        msg += fmt_short(t) + "\n\n"
        urg_icon = URG.get(t.get("urgency",""),"")[:2]
        st_icon  = "🔧" if t["status"] == "em_andamento" else "⏳"
        btns.append([InlineKeyboardButton(f"{urg_icon}{st_icon} #{t['id']} — {t['title'][:28]}", callback_data=f"view:{t['id']}")])
    btns.append([InlineKeyboardButton("🔙 Menu", callback_data="menu")])
    await q.edit_message_text(msg, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(btns))

async def text_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    chat_id = str(update.effective_chat.id)
    wait = get_wait(chat_id)
    mode = wait.get("mode")
    if mode == "name":
        clear_wait(chat_id)
        name = update.message.text.strip()
        p = get_provider_by_name(name)
        if p:
            link_provider(p["id"], chat_id)
            await update.message.reply_text(f"✅ Vinculado como *{p['name']}*!\n\nEscolha uma opção:", parse_mode="Markdown", reply_markup=main_kb())
        else:
            set_wait(chat_id, "name")
            await update.message.reply_text(f"❌ *'{name}'* não encontrado. Verifique e tente novamente:", parse_mode="Markdown")
    elif mode == "search":
        clear_wait(chat_id)
        term  = update.message.text.strip()
        tasks = get_tasks(chat_id=chat_id, search=term) or get_tasks(search=term)
        msg   = f"🔍 *'{term}'* — {len(tasks)} resultado(s)\n━━━━━━━━━━━━━━━━\n"
        btns  = []
        for t in tasks[:8]:
            msg += fmt_short(t) + "\n\n"
            btns.append([InlineKeyboardButton(f"#{t['id']} {t['title'][:32]}", callback_data=f"view:{t['id']}")])
        btns.append([InlineKeyboardButton("🔙 Menu", callback_data="menu")])
        await update.message.reply_text(msg, parse_mode="Markdown", reply_markup=InlineKeyboardMarkup(btns))
    elif mode == "note":
        clear_wait(chat_id)
        tid = wait.get("note_task")
        if tid:
            update_task(tid, chat_id, notes=update.message.text.strip())
            await update.message.reply_text(f"📌 Observação salva na tarefa *#{tid}*!", parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]]))
    else:
        await start(update, ctx)

async def cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    clear_wait(str(update.effective_chat.id))
    await update.effective_message.reply_text("Cancelado. Use /start para recomeçar.")

# ── Run ───────────────────────────────────────────────────────────────────────
def run_bot():
    if not TELEGRAM_OK: print("[BOT] ERRO: python-telegram-bot não instalado"); return
    if not SUPABASE_OK: print("[BOT] ERRO: supabase não instalado"); return
    if not SUPABASE_URL: print("[BOT] ERRO: SUPABASE_URL não configurado"); return
    token = get_token()
    if not token or len(token) < 20:
        print("[BOT] ERRO: Token Telegram não configurado"); return
    print(f"[BOT] Iniciando... token: {token[:12]}...")
    app = (ApplicationBuilder().token(token)
           .read_timeout(30).write_timeout(30).connect_timeout(30).pool_timeout(30).build())
    app.add_handler(CommandHandler("start",  start))
    app.add_handler(CommandHandler("menu",   start))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    print("[BOT] Rodando. Ctrl+C para parar.")
    app.run_polling(bootstrap_retries=-1, drop_pending_updates=True)

if __name__ == "__main__":
    run_bot()
