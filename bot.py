#!/usr/bin/env python3
"""DespachaApp Bot — Telegram + Supabase"""
import os, sys, base64, io, json as _json, asyncio, time
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
    from PIL import Image as _PILImage
    PIL_OK = True
except ImportError:
    PIL_OK = False

try:
    from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, InputMediaPhoto
    from telegram.ext import (ApplicationBuilder, CommandHandler,
                               CallbackQueryHandler, MessageHandler,
                               filters, ContextTypes)
    TELEGRAM_OK = True
except ImportError:
    TELEGRAM_OK = False
    print("[BOT] ERRO: instale python-telegram-bot")

# ── Supabase (cliente síncrono) ───────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "").strip()
sb = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_OK and SUPABASE_URL else None

# ── Helpers síncronos (chamados via asyncio.to_thread) ────────────────────────
def _sb_one(table, **kw):
    if not sb: return None
    try:
        q = sb.table(table).select("*")
        for k, v in kw.items(): q = q.eq(k, v)
        r = q.limit(1).execute()
        return r.data[0] if r.data else None
    except Exception as e: print(f"[sb_one] {e}"); return None

def _sb_all(table, order=None, **kw):
    if not sb: return []
    try:
        q = sb.table(table).select("*")
        for k, v in kw.items(): q = q.eq(k, v)
        if order: q = q.order(order)
        return q.execute().data or []
    except Exception as e: print(f"[sb_all] {e}"); return []

def _sb_update(table, data, **kw):
    if not sb: return None
    try:
        q = sb.table(table).update(data)
        for k, v in kw.items(): q = q.eq(k, v)
        return q.execute().data
    except Exception as e: print(f"[sb_update] {e}"); return None

def _sb_insert(table, data):
    if not sb: return None
    try: return sb.table(table).insert(data).execute().data
    except Exception as e: print(f"[sb_insert] {e}"); return None

def _get_tasks_sync(prov_id=None, company_id=None, status=None, urgency=None, overdue=False, search=None):
    if not sb: return []
    try:
        q = sb.table("tasks").select("*")
        if company_id: q = q.eq("company_id", str(company_id))
        if prov_id:    q = q.eq("assignee_id", prov_id)
        if status:   q = q.in_("status", status) if isinstance(status, list) else q.eq("status", status)
        if urgency:  q = q.eq("urgency", urgency)
        if overdue:
            now = datetime.now().isoformat()
            q = q.lt("sla_deadline", now).not_.in_("status", ["concluida", "cancelada"])
        if search:
            q = q.or_(f"title.ilike.%{search}%,description.ilike.%{search}%,requester.ilike.%{search}%")
        tasks = q.execute().data or []
        ord_urg = {"critica": 0, "alta": 1, "media": 2, "baixa": 3}
        return sorted(tasks, key=lambda x: (ord_urg.get(x.get("urgency", ""), 4), -x["id"]))
    except Exception as e: print(f"[get_tasks] {e}"); return []

def _get_stats_sync(prov_id, company_id=None):
    if not sb: return {}, {}
    try:
        q_mine = sb.table("tasks").select("*").eq("assignee_id", prov_id)
        q_glob = sb.table("tasks").select("*")
        if company_id:
            q_mine = q_mine.eq("company_id", str(company_id))
            q_glob = q_glob.eq("company_id", str(company_id))
        all_tasks    = q_mine.execute().data or []
        global_tasks = q_glob.execute().data or []
        today = datetime.now().date().isoformat()
        mine = {
            "total":      len(all_tasks),
            "concluidas": sum(1 for t in all_tasks if t["status"] == "concluida"),
            "andamento":  sum(1 for t in all_tasks if t["status"] == "em_andamento"),
            "atrasadas":  sum(1 for t in all_tasks if t.get("due_date","") < today and t["status"] not in ("concluida","cancelada")),
        }
        fin  = [t for t in all_tasks    if t.get("elapsed_minutes")]
        gfin = [t for t in global_tasks if t.get("elapsed_minutes")]
        mine["avg_min"] = sum(t["elapsed_minutes"] for t in fin) // len(fin) if fin else None
        geral = {
            "concluida":   sum(1 for t in global_tasks if t["status"] == "concluida"),
            "pendente":    sum(1 for t in global_tasks if t["status"] == "pendente"),
            "avg_minutes": sum(t["elapsed_minutes"] for t in gfin) // len(gfin) if gfin else None,
        }
        return mine, geral
    except Exception as e: print(f"[get_stats] {e}"); return {}, {}

def _update_task_sync(task_id, chat_id, **fields):
    task = _sb_one("tasks", id=task_id)
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
    _sb_update("tasks", updates, id=task_id)
    for k, v in fields.items():
        if str(task.get(k, "")) != str(v or ""):
            _sb_insert("task_history", {"task_id": task_id, "action": k,
                "old_value": str(task.get(k, "")), "new_value": str(v or ""),
                "changed_by": f"tg:{chat_id}"})
    return _sb_one("tasks", id=task_id)

# ── Wrappers async (não bloqueiam o event loop) ───────────────────────────────
async def aone(table, **kw):       return await asyncio.to_thread(_sb_one, table, **kw)
async def aall(table, **kw):       return await asyncio.to_thread(_sb_all, table, **kw)
async def aupd(table, data, **kw): return await asyncio.to_thread(_sb_update, table, data, **kw)
async def ains(table, data):       return await asyncio.to_thread(_sb_insert, table, data)
async def aget_tasks(**kw):        return await asyncio.to_thread(_get_tasks_sync, **kw)
async def aupdate_task(tid, cid, **fields): return await asyncio.to_thread(_update_task_sync, tid, cid, **fields)

# ── Cache de prestador (evita query repetida a cada clique) ───────────────────
_prov_cache: dict = {}
_CACHE_TTL = 300  # 5 minutos

async def get_prov(chat_id):
    cid = str(chat_id)
    entry = _prov_cache.get(cid)
    if entry and (time.monotonic() - entry[1]) < _CACHE_TTL:
        return entry[0]
    p = await aone("providers", chat_id=cid, active=1)
    _prov_cache[cid] = (p, time.monotonic())
    return p

def invalidate_prov_cache(chat_id):
    _prov_cache.pop(str(chat_id), None)

# ── Token ─────────────────────────────────────────────────────────────────────
def get_token():
    row = _sb_one("config", key="telegram_token")
    t = (row or {}).get("value", "").strip()
    return t if t and len(t) > 20 else os.environ.get("TELEGRAM_TOKEN", "").strip()

# ── Estado de espera ──────────────────────────────────────────────────────────
_waiting: dict = {}
def set_wait(chat_id, mode, task_id=None, extra=None):
    _waiting[str(chat_id)] = {"mode": mode, "task_id": task_id, **(extra or {})}
def get_wait(chat_id): return _waiting.get(str(chat_id), {})
def clear_wait(chat_id): _waiting.pop(str(chat_id), None)

# ── Compressão de imagem ──────────────────────────────────────────────────────
def compress_photo(img_bytes, max_px=800, quality=62):
    if not PIL_OK: return img_bytes
    try:
        img = _PILImage.open(io.BytesIO(img_bytes))
        if img.mode not in ("RGB", "L"): img = img.convert("RGB")
        img.thumbnail((max_px, max_px), _PILImage.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        compressed = buf.getvalue()
        print(f"[compress] {len(img_bytes)//1024}KB → {len(compressed)//1024}KB")
        return compressed
    except Exception as e: print(f"[compress_photo] {e}"); return img_bytes

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
        f"⏱ *Conclusão prevista (SLA):* *{sla}*\n"
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
            InlineKeyboardButton("💬 Observação",       callback_data=f"obs:{tid}"),
            InlineKeyboardButton("📷 Enviar Foto",      callback_data=f"photo:{tid}"),
        ])
        rows.append([
            InlineKeyboardButton("📅 Propor Nova Data", callback_data=f"newdate:{tid}"),
            InlineKeyboardButton("❌ Cancelar",          callback_data=f"cancel:{tid}"),
        ])
    rows.append([
        InlineKeyboardButton("🔙 Minhas Tarefas", callback_data="my_tasks"),
        InlineKeyboardButton("🏠 Menu",           callback_data="menu"),
    ])
    return InlineKeyboardMarkup(rows)

# ── Envio de fotos ────────────────────────────────────────────────────────────
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
    user    = update.effective_user
    clear_wait(chat_id)

    # Deep link: /start <invite_code> — vincula prestador à empresa pelo código
    invite_code = None
    if ctx.args:
        invite_code = ctx.args[0].strip()

    provider = await get_prov(chat_id)
    if not provider:
        # Resolve company_id pelo invite_code (se fornecido)
        invite_company_id = None
        if invite_code and sb:
            try:
                r = sb.table("companies").select("id").eq("invite_code", invite_code).eq("active", True).limit(1).execute()
                if r.data: invite_company_id = r.data[0]["id"]
            except: pass

        # Tenta vincular pelo nome do Telegram
        fn = (user.first_name or "").strip()
        ln = (user.last_name  or "").strip()
        for nm in [f"{fn} {ln}".strip(), fn, ln]:
            if nm:
                if not sb: break
                try:
                    q = sb.table("providers").select("*").ilike("name", f"%{nm}%").eq("active", 1)
                    if invite_company_id:
                        q = q.eq("company_id", invite_company_id)
                    r = q.limit(1).execute()
                    p = r.data[0] if r.data else None
                except: p = None
                if p:
                    await aupd("providers", {"chat_id": chat_id}, id=p["id"])
                    invalidate_prov_cache(chat_id)
                    provider = await get_prov(chat_id)
                    break
    if provider:
        await update.effective_message.reply_text(
            f"👷 Olá, *{provider['name']}*!\n🏢 Setor: {provider.get('sector') or '–'}\n\nEscolha uma opção:",
            parse_mode="Markdown", reply_markup=main_kb())
    else:
        set_wait(chat_id, "name", extra={"invite_code": invite_code} if invite_code else None)
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
    await q.answer()   # responde imediatamente — remove o "loading" no Telegram
    data    = q.data
    chat_id = str(update.effective_chat.id)
    clear_wait(chat_id)

    if data == "menu":
        prov = await get_prov(chat_id)
        name = prov["name"] if prov else "Prestador"
        await q.edit_message_text(f"👷 *{name}* — Menu Principal:",
            parse_mode="Markdown", reply_markup=main_kb()); return

    if data == "my_tasks":
        prov = await get_prov(chat_id)
        if not prov: await q.edit_message_text("❌ Prestador não vinculado. Use /start."); return
        company_id = prov.get("company_id")
        # Uma única query com filtro OR de status
        tasks = await aget_tasks(prov_id=prov["id"], company_id=company_id, status=["pendente", "em_andamento"])
        await show_list(q, tasks, "📋 Suas Tarefas Abertas"); return

    if data == "in_progress":
        prov = await get_prov(chat_id)
        if not prov: await q.edit_message_text("❌ Prestador não vinculado."); return
        company_id = prov.get("company_id")
        tasks = await aget_tasks(prov_id=prov["id"], company_id=company_id, status="em_andamento")
        await show_list(q, tasks, "🔧 Em Andamento"); return

    if data == "criticas":
        prov = await get_prov(chat_id)
        if not prov: await q.edit_message_text("❌ Prestador não vinculado."); return
        company_id = prov.get("company_id")
        tasks = await aget_tasks(prov_id=prov["id"], company_id=company_id, urgency="critica")
        tasks = [t for t in tasks if t.get("status") not in ("concluida","cancelada")]
        await show_list(q, tasks, "🚨 Tarefas Críticas"); return

    if data == "atrasadas":
        prov = await get_prov(chat_id)
        if not prov: await q.edit_message_text("❌ Prestador não vinculado."); return
        company_id = prov.get("company_id")
        tasks = await aget_tasks(prov_id=prov["id"], company_id=company_id, overdue=True)
        await show_list(q, tasks, "⏰ Tarefas Atrasadas"); return

    if data == "done_today":
        prov = await get_prov(chat_id)
        if not prov: await q.edit_message_text("❌ Prestador não vinculado."); return
        company_id = prov.get("company_id")
        today = datetime.now().strftime("%Y-%m-%d")
        tasks = await aget_tasks(prov_id=prov["id"], company_id=company_id, status="concluida")
        tasks = [t for t in tasks if (t.get("completed_at") or "").startswith(today)]
        await show_list(q, tasks, f"✅ Concluídas Hoje ({len(tasks)})"); return

    if data == "stats":
        prov = await get_prov(chat_id)
        if not prov: await q.edit_message_text("❌ Prestador não encontrado."); return
        company_id = prov.get("company_id")
        mine, geral = await asyncio.to_thread(_get_stats_sync, prov["id"], company_id)
        msg = (f"📊 *Meu Desempenho — {prov['name']}*\n━━━━━━━━━━━━━━━━\n"
               f"📦 Total: *{mine.get('total',0)}*\n✅ Concluídas: *{mine.get('concluidas',0)}*\n"
               f"🔧 Em andamento: *{mine.get('andamento',0)}*\n⏰ Atrasadas: *{mine.get('atrasadas',0)}*\n"
               f"⏱ Tempo médio: *{elapsed_str(mine.get('avg_min'))}*\n\n"
               f"*📈 Geral da equipe:*\n"
               f"✅ {geral.get('concluida',0)} concluídas | ⏳ {geral.get('pendente',0)} pendentes\n"
               f"⏱ Média global: {elapsed_str(geral.get('avg_minutes'))}")
        await q.edit_message_text(msg, parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return

    if data == "search":
        set_wait(chat_id, "search")
        await q.edit_message_text("🔍 *Buscar tarefa*\n\nDigite parte do título, solicitante ou descrição:",
            parse_mode="Markdown"); return

    if data.startswith("view:"):
        task = await aone("tasks", id=int(data.split(":")[1]))
        if not task: await q.edit_message_text("❌ Tarefa não encontrada."); return
        await q.edit_message_text(fmt_detail(task), parse_mode="Markdown", reply_markup=task_kb(task))
        await send_task_photos(ctx.bot, chat_id, task); return

    if data.startswith("start:"):
        tid  = int(data.split(":")[1])
        task = await aupdate_task(tid, chat_id, status="em_andamento")
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
        tid  = int(data.split(":")[1])
        task = await aupdate_task(tid, chat_id, status="concluida")
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
        await aupdate_task(tid, chat_id, status="cancelada")
        await q.edit_message_text(f"❌ Tarefa #{tid} cancelada.",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("🔙 Menu", callback_data="menu")]])); return

    if data.startswith("obs:"):
        tid = int(data.split(":")[1])
        set_wait(chat_id, "obs", task_id=tid)
        await q.edit_message_text(
            f"💬 *Observação — Tarefa #{tid}*\n\n"
            f"Digite sua observação. Ela ficará visível para o gestor no sistema web:",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ Cancelar", callback_data=f"view:{tid}")]])); return

    if data.startswith("photo:"):
        tid = int(data.split(":")[1])
        set_wait(chat_id, "photo", task_id=tid)
        await q.edit_message_text(
            f"📷 *Enviar Foto — Tarefa #{tid}*\n\n"
            f"Envie a foto agora. Você pode adicionar legenda junto com a foto.",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ Cancelar", callback_data=f"view:{tid}")]])); return

    if data.startswith("newdate:"):
        tid  = int(data.split(":")[1])
        task = await aone("tasks", id=tid)
        sla  = fmt_date(task.get("sla_deadline","")) if task else "–"
        set_wait(chat_id, "newdate", task_id=tid)
        await q.edit_message_text(
            f"📅 *Propor Nova Data — Tarefa #{tid}*\n\n"
            f"⏱ Data atual (SLA): *{sla}*\n\n"
            f"Digite a nova data proposta no formato:\n*DD/MM/AAAA*\n\n_Ex: 25/12/2025_",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("❌ Cancelar", callback_data=f"view:{tid}")]])); return

async def text_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.text: return
    chat_id = str(update.effective_chat.id)
    wait    = get_wait(chat_id)
    mode    = wait.get("mode")

    if mode == "name":
        saved_invite = wait.get("invite_code")
        clear_wait(chat_id)
        name = update.message.text.strip()
        if not sb: await update.message.reply_text("❌ Sem conexão com o banco."); return
        # Resolve company_id pelo invite_code salvo (se houver)
        invite_company_id = None
        if saved_invite:
            try:
                r = sb.table("companies").select("id").eq("invite_code", saved_invite).eq("active", True).limit(1).execute()
                if r.data: invite_company_id = r.data[0]["id"]
            except: pass
        try:
            q = sb.table("providers").select("*").ilike("name", f"%{name}%").eq("active", 1)
            if invite_company_id:
                q = q.eq("company_id", invite_company_id)
            r = q.limit(1).execute()
            p = r.data[0] if r.data else None
        except: p = None
        if p:
            await aupd("providers", {"chat_id": chat_id}, id=p["id"])
            invalidate_prov_cache(chat_id)
            await update.message.reply_text(
                f"✅ Vinculado como *{p['name']}*!\n\nEscolha uma opção:",
                parse_mode="Markdown", reply_markup=main_kb())
        else:
            set_wait(chat_id, "name", extra={"invite_code": saved_invite} if saved_invite else None)
            await update.message.reply_text(
                f"❌ *'{name}'* não encontrado no sistema.\nVerifique o nome e tente novamente:",
                parse_mode="Markdown")
        return

    if mode == "search":
        clear_wait(chat_id)
        prov  = await get_prov(chat_id)
        term  = update.message.text.strip()
        company_id = prov.get("company_id") if prov else None
        tasks = await aget_tasks(prov_id=prov["id"] if prov else None, company_id=company_id, search=term)
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
        task = await aone("tasks", id=tid) if tid else None
        if not task: await update.message.reply_text("❌ Tarefa não encontrada."); return
        prov = await get_prov(chat_id)
        name = prov["name"] if prov else "Prestador"
        now_str  = datetime.now().strftime("%d/%m %H:%M")
        nova_obs = f"[{now_str}] {name}: {update.message.text.strip()}"
        obs_ant  = task.get("provider_obs","") or ""
        obs_final = f"{obs_ant}\n{nova_obs}".strip() if obs_ant else nova_obs
        await asyncio.gather(
            aupd("tasks", {"provider_obs": obs_final}, id=tid),
            ains("task_history", {"task_id": tid, "action": "observacao_prestador",
                "old_value": "", "new_value": nova_obs, "changed_by": f"tg:{name}"})
        )
        await update.message.reply_text(
            f"💬 *Observação salva na tarefa #{tid}!*\n\n_{nova_obs}_",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👁 Ver tarefa", callback_data=f"view:{tid}"),
                InlineKeyboardButton("🏠 Menu",        callback_data="menu")]])); return

    if mode == "newdate":
        clear_wait(chat_id)
        tid  = wait.get("task_id")
        task = await aone("tasks", id=tid) if tid else None
        if not task: await update.message.reply_text("❌ Tarefa não encontrada."); return
        raw = update.message.text.strip()
        try:
            dt       = datetime.strptime(raw, "%d/%m/%Y")
            new_date = dt.strftime("%Y-%m-%d")
        except:
            set_wait(chat_id, "newdate", task_id=tid)
            await update.message.reply_text(
                f"❌ Formato inválido. Use *DD/MM/AAAA*\nEx: 25/12/2025",
                parse_mode="Markdown"); return
        prov = await get_prov(chat_id)
        name = prov["name"] if prov else "Prestador"
        await asyncio.gather(
            aupd("tasks", {"provider_new_date": new_date}, id=tid),
            ains("task_history", {"task_id": tid, "action": "proposta_nova_data",
                "old_value": str(task.get("due_date","") or ""), "new_value": new_date,
                "changed_by": f"tg:{name}"})
        )
        await update.message.reply_text(
            f"📅 *Nova data proposta para #{tid}!*\n\n"
            f"Data: *{raw}*\n\n"
            f"_O gestor verá no sistema e poderá aprovar ou recusar._",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👁 Ver tarefa", callback_data=f"view:{tid}"),
                InlineKeyboardButton("🏠 Menu",       callback_data="menu")]])); return

    await start(update, ctx)

async def photo_handler(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not update.message or not update.message.photo: return
    chat_id = str(update.effective_chat.id)
    wait    = get_wait(chat_id)
    if wait.get("mode") != "photo":
        await update.message.reply_text("Use /start e selecione uma tarefa para enviar fotos.")
        return
    clear_wait(chat_id)
    tid  = wait.get("task_id")
    task = await aone("tasks", id=tid) if tid else None
    if not task: await update.message.reply_text("❌ Tarefa não encontrada."); return

    await update.message.reply_text("⏳ Processando foto…")
    try:
        photo_obj = update.message.photo[-1]
        tg_file   = await ctx.bot.get_file(photo_obj.file_id)
        buf = io.BytesIO()
        await tg_file.download_to_memory(buf)
        img_bytes = await asyncio.to_thread(compress_photo, buf.getvalue())

        b64      = base64.b64encode(img_bytes).decode()
        data_url = f"data:image/jpeg;base64,{b64}"

        existing = []
        try:
            if task.get("photos"): existing = _json.loads(task["photos"])
        except: pass
        existing.append(data_url)

        updates = {"photos": _json.dumps(existing)}
        caption = update.message.caption
        if caption:
            prov = await get_prov(chat_id)
            name = prov["name"] if prov else "Prestador"
            now_str  = datetime.now().strftime("%d/%m %H:%M")
            nova_obs = f"[{now_str}] {name} (foto): {caption}"
            obs_ant  = task.get("provider_obs","") or ""
            updates["provider_obs"] = f"{obs_ant}\n{nova_obs}".strip() if obs_ant else nova_obs

        await asyncio.gather(
            aupd("tasks", updates, id=tid),
            ains("task_history", {"task_id": tid, "action": "foto_prestador",
                "old_value": "", "new_value": "Foto adicionada via Telegram",
                "changed_by": f"tg:{chat_id}"})
        )
        await update.message.reply_text(
            f"📷 *Foto adicionada à tarefa #{tid}!*",
            parse_mode="Markdown",
            reply_markup=InlineKeyboardMarkup([[
                InlineKeyboardButton("👁 Ver tarefa", callback_data=f"view:{tid}"),
                InlineKeyboardButton("🏠 Menu",       callback_data="menu")]]))
    except Exception as e:
        print(f"[photo_handler] erro: {e}")
        await update.message.reply_text(f"❌ Erro ao processar foto: {e}")

async def cancel(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    clear_wait(str(update.effective_chat.id))
    await update.effective_message.reply_text("Cancelado. Use /start para recomeçar.")

# ── Job: notifica prestadores sobre novas tarefas ─────────────────────────────
def _fetch_unnotified():
    if not sb: return []
    try:
        return sb.table("tasks").select("*").eq("provider_notified", False).not_.in_("status", ["cancelada"]).execute().data or []
    except: return []

async def notify_new_tasks(ctx: ContextTypes.DEFAULT_TYPE):
    tasks = await asyncio.to_thread(_fetch_unnotified)
    for task in tasks:
        await asyncio.to_thread(_sb_update, "tasks", {"provider_notified": True}, id=task["id"])
        if not task.get("assignee_id"): continue
        # Filtra prestador pela mesma company_id da tarefa (bot usa service_role — sem RLS)
        task_company_id = task.get("company_id")
        if task_company_id:
            prov = None
            if sb:
                try:
                    r = sb.table("providers").select("*").eq("id", task["assignee_id"]).eq("company_id", str(task_company_id)).limit(1).execute()
                    prov = r.data[0] if r.data else None
                except: prov = None
        else:
            prov = await aone("providers", id=task["assignee_id"])
        if not prov or not prov.get("chat_id"): continue
        urg = URG.get(task.get("urgency", ""), "")
        sla = fmt_date(task.get("sla_deadline", ""))
        msg = (
            f"🔔 *Nova tarefa atribuída a você!*\n\n"
            f"{urg} *#{task['id']}* — {task['title']}\n\n"
            f"📝 {task.get('description') or '–'}\n"
            f"👤 Solicitante: {task.get('requester', '')}\n"
            f"🏢 Setor: {task.get('sector') or '–'}\n"
            f"⏱ *Conclusão prevista (SLA):* {sla}\n\n"
            f"_Use o menu para ver detalhes e iniciar a tarefa._"
        )
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("👁 Ver Tarefa", callback_data=f"view:{task['id']}"),
            InlineKeyboardButton("🏠 Menu",       callback_data="menu"),
        ]])
        try:
            await ctx.bot.send_message(chat_id=int(prov["chat_id"]), text=msg, parse_mode="Markdown", reply_markup=kb)
            print(f"[notify] Tarefa #{task['id']} → {prov['name']}")
        except Exception as e:
            print(f"[notify] Erro ao notificar {prov.get('name')}: {e}")

# ── Run ───────────────────────────────────────────────────────────────────────
def run_bot():
    if not TELEGRAM_OK: print("[BOT] ERRO: python-telegram-bot não instalado"); return
    if not SUPABASE_OK: print("[BOT] ERRO: supabase não instalado"); return
    if not SUPABASE_URL: print("[BOT] ERRO: SUPABASE_URL não configurado"); return
    token = get_token()
    if not token or len(token) < 20: print("[BOT] ERRO: Token Telegram não configurado"); return
    print(f"[BOT] Iniciando... token: {token[:12]}...")
    app = (ApplicationBuilder()
           .token(token)
           .concurrent_updates(True)   # processa múltiplos updates em paralelo
           .read_timeout(30).write_timeout(30).connect_timeout(30).pool_timeout(30)
           .build())
    app.add_handler(CommandHandler("start",  start))
    app.add_handler(CommandHandler("menu",   start))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(CallbackQueryHandler(button))
    app.add_handler(MessageHandler(filters.PHOTO,                   photo_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, text_handler))
    app.job_queue.run_repeating(notify_new_tasks, interval=30, first=10)
    print("[BOT] Rodando.")
    app.run_polling(bootstrap_retries=-1, drop_pending_updates=True)

if __name__ == "__main__":
    run_bot()
