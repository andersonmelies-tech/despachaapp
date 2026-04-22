#!/usr/bin/env python3
"""DespachaApp Bot — Telegram + Supabase"""
import os, sys, base64, io, json as _json
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
    print("[BOT] ERRO: instale python-telegram-bot")

# ── Supabase ──────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "").strip()
sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_OK and SUPABASE_URL else None

def sb_one(table, **kw):
    if not sb: return None
    try:
        q = sb.table(table).select("*")
        for k, v in kw.items(): q = q.eq(k, v)
        r = q.limit(1).execute()
        return r.data[0] if r.data else None
    except Exception as e: print(f"[sb_one] {e}"); return None

def sb_all(table, order=None, **kw):
    if not sb: return []
    try:
        q = sb.table(table).select("*")
        for k, v in kw.items(): q = q.eq(k, v)
        if order: q = q.order(order)
        return q.execute().data or []
    except Exception as e: print(f"[sb_all] {e}"); return []

def sb_update(table, data, **kw):
    if not sb: return None
    try:
        q = sb.table(table).update(data)
        for k, v in kw.items(): q = q.eq(k, v)
        return q.execute().data
    except Exception as e: print(f"[sb_update] {e}"); return None

def sb_insert(table, data):
    if not sb: return None
    try: return sb.table(table).insert(data).execute().data
    except Exception as e: print(f"[sb_insert] {e}"); return None

# ── Token ─────────────────────────────────────────────────────────────────────
def get_token():
    row = sb_one("config", key="telegram_token")
    t = (row or {}).get("value", "").strip()
    return t if t and len(t) > 20 else os.environ.get("TELEGRAM_TOKEN", "").strip()

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
        tasks = q.execute().data or []
        ord_urg = {"critica": 0, "alta": 1, "media": 2, "baixa": 3}
        return sorted(tasks, key=lambda x: (ord_urg.get(x.get("urgency", ""), 4), -x["id"]))
    except Exception as e: print(f"[get_tasks] {e}"); return []

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
    mine = {
        "total":      len(all_tasks),
        "concluidas": sum(1 for t in all_tasks if t["status"] == "concluida"),
        "andamento":  sum(1 for t in all_tasks if t["status"] == "em_andamento"),
        "atrasadas":  sum(1 for t in all_tasks if t.get("due_date","") < today and t["status"] not in ("concluida","cancelada")),
    }
    fin = [t for t in all_tasks if t.get("elapsed_minutes")]
    mine["avg_min"] = sum(t["elapsed_minutes"] for t in fin) // len(fin) if fin else None
    gfin = [t for t in global_tasks if t.get("elapsed_minutes")]
    geral = {
        "concluida":   sum(1 for t in global_tasks if t["status"] == "concluida"),
        "pendente":    sum(1 for t in global_tasks if t["status"] == "pendente"),
        "avg_minutes": sum(t["elapsed_minutes"] for t in gfin) // len(gfin) if gfin else None,
    }
    return prov, mine, geral

# ── Estado de espera ──────────────────────────────────────────────────────────
_waiting = {}
def set_wait(chat_id, mode, task_id=None):
    _waiting[str(chat_id)] = {"mode": mode, "task_id": task_id}
def get_wait(chat_id): return _waiting.get(str(chat_id), {})
def clear_wait(chat_id): _waiting.pop(str(chat_id), None)

# ── Labels / formatação ───────────────────────────────────────────────────────
URG = {"critica": "🚨 CRÍTICA", "alta": "🔴 Alta", "media": "🟡 Média", "baixa": "🟢 Baixa"}
STA = {"pendente": "⏳ Pendente", "em_andamento": "🔧 Em andamento",
       "concluida": "✅ Concluída", "cancelada": "❌ Cancelada"}

def elapsed_str(m):
    if not m: return "–"
    h, mi = divmod(int(m), 60)
    return f"{h}h {mi}min" if h else f"{mi}min"

def fmt_date(d):
    if not d: return "–"
    try:
        dt = datetime.fromisoformat(str(d).replace("Z",""))
        return dt.strftime("%d/%m/%Y %H:%M") if "T" in str(d) else dt.strftime("%d/%m/%Y")
    except: return str(d)[:10]

def fmt_short(t):
    urg  = URG.get(t.get("urgency",""), "")
    sla  = fmt_date(t.get("sla_deadline",""))
    sta  = STA.get(t.get("status",""), "")
    pobs = "📌 " if t.get("provider_obs") else ""
    pdat = "📅 " if t.get("provider_new_date") else ""
    return (f"{urg} *#{t['id']}* — {t['title']}\n"
            f"   👤 {t['assignee']}  |  ⏱ Conclusão: *{sla}*\n"
            f"   {sta} {pobs}{pdat}")

def fmt_detail(t):
    urg  = URG.get(t.get("urgency",""), "")
    sta  = STA.get(t.get("status",""), "")
    sla  = fmt_date(t.get("sla_deadline",""))
    pobs = t.get("provider_obs","") or "–"
    pdat = fmt_date(t.get("provider_new_date",""))
    return (
        f"{urg} *Tarefa #{t['id']}*\n━━━━━━━━━━━━━━━━━━\n"
        f"📋 *{t['title']}*\n\n"
        f"📝 {t.get('description') or '–'}\n\n"
        f"👤 *Prestador:* {t['assignee']}\n"
        f"🏢 *Setor:* {t.get('sector') or '–'}\n"
        f"🏷 *Categoria:* {t.get('category') or '–'}\n\n"
        f"⏱ *📌 Conclusão prevista (SLA):* *{sla}*\n"
        f"⚡ *Urgência:* {t.get('urgency','').upper()}\n"
        f"🔄 *Status:* {sta}\n\n"
        f"🕐 *Iniciada:* {fmt_date(t.get('started_at',''))}\n"
        f"✅ *Concluída:* {fmt_date(t.get('completed_at',''))}\n"
        f"⏳ *Tempo total:* {elapsed_str(t.get('elapsed_minutes'))}\n\n"
        f"📌 *Obs interna:* {t.get('notes') or '–'}\n"
        f"💬 *Obs prestador:* {pobs}\n"
        + (f"📅 *Nova data proposta:* {pdat}\n" if t.get("provider_new_date") else "")
    )

# ── Teclados ──────────────────────────────────────────────────────────────────
def main_kb():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("📋 Minhas Tarefas",   callback_data="my_tasks"),
         InlineKeyboardButton("🔧 Em Andamento",     callback_data="in_progress")],
        [InlineKeyboardButton("🚨 Críticas",         callback_data="criticas"),
         InlineKeyboardButton("⏰ Atrasadas",        callback_data="atrasadas")],
        [InlineKeyboardButton("🔍 Buscar",           callback_data="search"),
         InlineKeyboardButton("📊 Meu Desempenho",  callback_data="stats")],
        [InlineKeyboardButton("✅ Concluídas Hoje",  callback_data="done_today")],
    ])

def task_kb(t):
    tid = t["id"]; st = t.get("status",""); rows = []
    if st == "pendente":
        rows.append([InlineKeyboardButton("▶️ INICIAR AGORA", callback_data=f"start:{tid}")])
    if st == "em_andamento":
        rows.append([InlineKeyboardButton("✅ FINALIZAR TAREFA", callback_data=f"done:{tid}")])
    if st not in ("cancelada","concluida"):
        rows.append([
            InlineKeyboardButton("💬 Observação",    callback_data=f"obs:{tid}"),
            InlineKeyboardButton("📷 Enviar Foto",   callback_data=f"photo:{tid}"),
        ])
        rows.append([
            InlineKeyboardButton("📅 Propor Nova Data", callback_data=f"newdate:{tid}"),
            InlineKeyboardButton("❌ Cancelar",         callback_data=f"cancel:{tid}"),
        ])
    rows.append([
        InlineKeyboardButton("🔙 Minhas Tarefas", callback_data="my_tasks"),
        InlineKeyboardButton("🏠 Menu",           callback_data="menu"),
    ])
    return InlineKeyboardMarkup(rows)

# ── Helpers de envio de fotos ─────────────────────────────────────────────────
async def send_task_photos(bot, chat_id, task):
    photos_json = task.get("photos")
    if not photos_json: return
    try: photos = _json.loads(photos_json)
    except: return
    if not photos: return
    media = []
    for i, data_url in enumerate(photos[:10]):
        try:
            if "," not in data_url: continue
            img_bytes = base64.b64decode(data_url.split(",",1)[1])
            if len(img_bytes) > 9*1024*1024: continue
            buf = io.BytesIO(img_bytes); buf.name = f"foto_{i+1}.jpg"
            caption = f"📷 {i+1}/{len(photos)} — #{task['id']}: {task['title']}" if i == 0 else None
            media.append(InputMediaPhoto(media=buf, caption=caption, parse_mode="Markdown"))
        except: pass
    if not media: return
    try: await bot.send_media_group(chat_id=int(chat_id), media=media)
    except:
        for m in media:
            try: await bot.send_photo(chat_id=int(chat_id), photo=m.media, caption=m.caption)
            except: pass

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
            "👷 Bem-vindo ao *DespachaApp*!\n\nVocê não está vinculado como prestador.\n"
            "Digite seu *nome completo* exatamente como cadastrado no sistema:",
            parse_mode="Markdown")

async def show_list(q, tasks, title):
    if not tasks:
        await q.edit_message_text(f"*{title}*\n\n_Nenhuma tarefa encontrada._",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return
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

async def button(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    await q.answer()
    data = q.data
    chat_id = str(update.effective_chat.id)
    clear_wait(chat_id)

    if data == "menu":
        prov = get_provider_by_chat(chat_id)
        name = prov["name"] if prov else "Prestador"
        await q.edit_message_text(f"👷 *{name}* — Menu Principal:",
            parse_mode="Markdown", reply_markup=main_kb()); return

    if data == "my_tasks":
        tasks = get_tasks(chat_id=chat_id, status="pendente") + get_tasks(chat_id=chat_id, status="em_andamento")
        tasks.sort(key=lambda x: {"critica":0,"alta":1,"media":2,"baixa":3}.get(x.get("urgency",""),4))
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
        await q.edit_message_text("🔍 *Buscar tarefa*\n\nDigite parte do título, solicitante ou descrição:",
            parse_mode="Markdown"); return

    if data.startswith("view:"):
        task = sb_one("tasks", id=int(data.split(":")[1]))
        if not task: await q.edit_message_text("❌ Tarefa não encontrada."); return
        await q.edit_message_text(fmt_detail(task), parse_mode="Markdown", reply_markup=task_kb(task))
        await send_task_photos(ctx.bot, chat_id, task); return

    if data.startswith("start:"):
        tid = int(data.split(":")[1])
        task = update_task(tid, chat_id, status="em_andamento")
        if task:
            sla = fmt_date(task.get("sla_deadline",""))
            await q.edit_message_text(
                f"▶️ *Tarefa #{tid} INICIADA!*\n\n"
                f"📋 {task['title']}\n"
                f"⏱ *Conclusão prevista:* {sla}\n"
                f"🕐 Início: {fmt_date(task.get('started_at',''))}\n\n"
                f"_O tempo de execução está sendo medido._",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("✅ FINALIZAR AGORA",  callback_data=f"done:{tid}")],
                    [InlineKeyboardButton("💬 Observação",       callback_data=f"obs:{tid}"),
                     InlineKeyboardButton("📅 Nova Data",        callback_data=f"newdate:{tid}")],
                    [InlineKeyboardButton("🔙 Minhas Tarefas",  callback_data="my_tasks")]])); return

    if data.startswith("done:"):
        tid = int(data.split(":")[1])
        task = update_task(tid, chat_id, status="concluida")
        if task:
            await q.edit_message_text(
                f"✅ *Tarefa #{tid} CONCLUÍDA!*\n\n"
                f"📋 {task['title']}\n\n"
                f"🕐 Iniciada:  {fmt_date(task.get('started_at',''))}\n"
                f"🏁 Concluída: {fmt_date(task.get('completed_at',''))}\n"
                f"⏱ *Tempo total: {elapsed_str(task.get('elapsed_minutes'))}*",
                parse_mode="Markdown",
                reply_markup=InlineKeyboardMarkup([[
                    InlineKeyboardButton("📋 Minhas Tarefas", callback_data="my_tasks"),
                    InlineKeyboardButton("🏠 Menu",           callback_data="menu")]])); return

    if data.startswith("cancel:"):
        tid = int(data.split(":")[1])
        update_task(tid, chat_id, status="cancelada")
        await q.edit_message_text(f"❌ Tarefa #{tid} cancelada.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return

    # ── Observação ────────────────────────────────────────────
    if data.startswith("obs:"):
        tid = int(data.split(":")[1])
        set_wait(chat_id, "obs", task_id=tid)
        await q.edit_message_text(
            f"💬 *Observação — Tarefa #{tid}*\n\n"
            f"Digite sua observação. Ela ficará visível para o gestor no sistema web:",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ Cancelar", callback_data=f"view:{tid}")]])); return

    # ── Foto ──────────────────────────────────────────────────
    if data.startswith("photo:"):
        tid = int(data.split(":")[1])
        set_wait(chat_id, "photo", task_id=tid)
        await q.edit_message_text(
            f"📷 *Enviar Foto — Tarefa #{tid}*\n\n"
            f"Envie a foto agora.\n"
            f"Você pode adicionar uma legenda junto com a foto.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ Cancelar", callback_data=f"view:{tid}")]])); return

    # ── Propor nova data ──────────────────────────────────────
    if data.startswith("newdate:"):
        tid = int(data.split(":")[1])
        task = sb_one("tasks", id=tid)
        sla = fmt_date(task.get("sla_deadline","")) if task else "–"
        set_wait(chat_id, "newdate", task_id=tid)
        await q.edit_message_text(
            f"📅 *Propor Nova Data — Tarefa #{tid}*\n\n"
            f"⏱ Data atual (SLA): *{sla}*\n\n"
            f"Digite a nova data proposta no formato:\n*DD/MM/AAAA*\n\n"
            f"_Ex: 25/12/2025_",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ Cancelar", callback_data=f"view:{tid}")]])); return

async def text_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    chat_id = str(update.effective_chat.id)
    wait    = get_wait(chat_id)
    mode    = wait.get("mode")

    if mode == "name":
        clear_wait(chat_id)
        name = update.message.text.strip()
        p = get_provider_by_name(name)
        if p:
            link_provider(p["id"], chat_id)
            await update.message.reply_text(
                f"✅ Vinculado como *{p['name']}*!\n\nEscolha uma opção:",
                parse_mode="Markdown", reply_markup=main_kb())
        else:
            set_wait(chat_id, "name")
            await update.message.reply_text(
                f"❌ *'{name}'* não encontrado no sistema.\nVerifique o nome e tente novamente:",
                parse_mode="Markdown")
        return

    if mode == "search":
        clear_wait(chat_id)
        term  = update.message.text.strip()
        tasks = get_tasks(chat_id=chat_id, search=term) or get_tasks(search=term)
        msg   = f"🔍 *'{term}'* — {len(tasks)} resultado(s)\n━━━━━━━━━━━━━━━━\n"
        btns  = []
        for t in tasks[:8]:
            msg += fmt_short(t) + "\n\n"
            btns.append([InlineKeyboardButton(f"#{t['id']} {t['title'][:32]}", callback_data=f"view:{t['id']}")])
        btns.append([InlineKeyboardButton("🔙 Menu", callback_data="menu")])
        await update.message.reply_text(msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup(btns)); return

    if mode == "obs":
        clear_wait(chat_id)
        tid  = wait.get("task_id")
        task = sb_one("tasks", id=tid) if tid else None
        if not task:
            await update.message.reply_text("❌ Tarefa não encontrada."); return
        prov = get_provider_by_chat(chat_id)
        name = prov["name"] if prov else "Prestador"
        now_str = datetime.now().strftime("%d/%m %H:%M")
        nova_obs = f"[{now_str}] {name}: {update.message.text.strip()}"
        obs_existente = task.get("provider_obs","") or ""
        obs_final = f"{obs_existente}\n{nova_obs}".strip() if obs_existente else nova_obs
        sb_update("tasks", {"provider_obs": obs_final}, id=tid)
        sb_insert("task_history", {"task_id": tid, "action": "observacao_prestador",
            "old_value": "", "new_value": nova_obs, "changed_by": f"tg:{name}"})
        await update.message.reply_text(
            f"💬 *Observação salva na tarefa #{tid}!*\n\n_{nova_obs}_",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👁 Ver tarefa",     callback_data=f"view:{tid}"),
                InlineKeyboardButton("🏠 Menu",           callback_data="menu")]])); return

    if mode == "newdate":
        clear_wait(chat_id)
        tid  = wait.get("task_id")
        task = sb_one("tasks", id=tid) if tid else None
        if not task:
            await update.message.reply_text("❌ Tarefa não encontrada."); return
        raw = update.message.text.strip()
        try:
            dt = datetime.strptime(raw, "%d/%m/%Y")
            new_date = dt.strftime("%Y-%m-%d")
        except:
            set_wait(chat_id, "newdate", task_id=tid)
            await update.message.reply_text(
                f"❌ Formato inválido. Use *DD/MM/AAAA*\nEx: 25/12/2025",
                parse_mode="Markdown"); return
        prov = get_provider_by_chat(chat_id)
        name = prov["name"] if prov else "Prestador"
        sb_update("tasks", {"provider_new_date": new_date}, id=tid)
        sb_insert("task_history", {"task_id": tid, "action": "proposta_nova_data",
            "old_value": str(task.get("due_date","") or ""), "new_value": new_date,
            "changed_by": f"tg:{name}"})
        await update.message.reply_text(
            f"📅 *Nova data proposta para #{tid}!*\n\n"
            f"Data: *{raw}*\n\n"
            f"_O gestor será notificado e poderá aprovar ou recusar._",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👁 Ver tarefa",  callback_data=f"view:{tid}"),
                InlineKeyboardButton("🏠 Menu",        callback_data="menu")]])); return

    await start(update, ctx)

async def photo_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    """Recebe foto enviada pelo prestador"""
    if not update.message or not update.message.photo: return
    chat_id = str(update.effective_chat.id)
    wait    = get_wait(chat_id)
    if wait.get("mode") != "photo":
        await update.message.reply_text("Use /start e selecione uma tarefa para enviar fotos.")
        return
    clear_wait(chat_id)
    tid  = wait.get("task_id")
    task = sb_one("tasks", id=tid) if tid else None
    if not task:
        await update.message.reply_text("❌ Tarefa não encontrada."); return

    await update.message.reply_text("⏳ Processando foto...")
    try:
        # Baixa a foto maior disponível
        photo_obj = update.message.photo[-1]
        tg_file   = await ctx.bot.get_file(photo_obj.file_id)
        buf = io.BytesIO()
        await tg_file.download_to_memory(buf)
        img_bytes = buf.getvalue()

        # Converte para base64
        b64      = base64.b64encode(img_bytes).decode()
        data_url = f"data:image/jpeg;base64,{b64}"

        # Adiciona ao array de fotos existente
        existing = []
        try:
            if task.get("photos"): existing = _json.loads(task["photos"])
        except: pass
        existing.append(data_url)

        updates = {"photos": _json.dumps(existing)}

        # Legenda da foto vira observação
        caption = update.message.caption
        if caption:
            prov = get_provider_by_chat(chat_id)
            name = prov["name"] if prov else "Prestador"
            now_str = datetime.now().strftime("%d/%m %H:%M")
            nova_obs = f"[{now_str}] {name} (foto): {caption}"
            obs_existente = task.get("provider_obs","") or ""
            updates["provider_obs"] = f"{obs_existente}\n{nova_obs}".strip() if obs_existente else nova_obs

        sb_update("tasks", updates, id=tid)
        sb_insert("task_history", {"task_id": tid, "action": "foto_prestador",
            "old_value": "", "new_value": f"Foto adicionada via Telegram",
            "changed_by": f"tg:{chat_id}"})

        await update.message.reply_text(
            f"📷 *Foto adicionada à tarefa #{tid}!*",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👁 Ver tarefa",  callback_data=f"view:{tid}"),
                InlineKeyboardButton("🏠 Menu",        callback_data="menu")]]))
    except Exception as e:
        print(f"[photo_handler] erro: {e}")
        await update.message.reply_text(f"❌ Erro ao processar foto: {e}")

async def cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    clear_wait(str(update.effective_chat.id))
    await update.effective_message.reply_text("Cancelado. Use /start para recomeçar.")

# ── Run ───────────────────────────────────────────────────────────────────────
def run_bot():
    if not TELEGRAM_OK: print("[BOT] ERRO: python-telegram-bot não instalado"); return
    if not SUPABASE_OK: print("[BOT] ERRO: supabase não instalado"); return
    if not SUPABASE_URL: print("[BOT] ERRO: SUPABASE_URL não configurado"); return
    token = get_token()
    if not token or len(token) < 20: print("[BOT] ERRO: Token Telegram não configurado"); return
    print(f"[BOT] Iniciando... token: {token[:12]}...")
    app = (ApplicationBuilder().token(token)
           .read_timeout(30).write_timeout(30).connect_timeout(30).pool_timeout(30).build())
    app.add_handler(CommandHandler("start",  start))
    app.add_handler(CommandHandler("menu",   start))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.PHOTO,                       photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND,     text_handler))
    print("[BOT] Rodando.")
    app.run_polling(bootstrap_retries=-1, drop_pending_updates=True)

if __name__ == "__main__":
    run_bot()
