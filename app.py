from fastapi import FastAPI, HTTPException, Request, Cookie
from fastapi.responses import JSONResponse
import hashlib, secrets as _secrets
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Optional
import sqlite3, os
from datetime import datetime, date, timedelta

app = FastAPI(title="DespachaApp")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
DB_PATH = "tasks.db"

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.execute("CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute("""CREATE TABLE IF NOT EXISTS providers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, telegram_token TEXT DEFAULT '', chat_id TEXT DEFAULT '',
        sector TEXT DEFAULT '', active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sla_config (
        urgency TEXT PRIMARY KEY, hours INTEGER NOT NULL, label TEXT)""")
    conn.execute("""CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL, description TEXT DEFAULT '',
        requester TEXT NOT NULL, requester_sector TEXT DEFAULT '',
        assignee_id INTEGER, assignee TEXT NOT NULL,
        urgency TEXT DEFAULT 'media' CHECK(urgency IN ('baixa','media','alta','critica')),
        status TEXT DEFAULT 'pendente' CHECK(status IN ('pendente','em_andamento','concluida','cancelada')),
        category TEXT DEFAULT '', sector TEXT DEFAULT '',
        due_date TEXT, sla_deadline TEXT,
        started_at TEXT, completed_at TEXT, elapsed_minutes INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        updated_at TEXT DEFAULT (datetime('now','localtime')),
        notes TEXT DEFAULT '',
        FOREIGN KEY(assignee_id) REFERENCES providers(id))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER,
        action TEXT, old_value TEXT, new_value TEXT, changed_by TEXT,
        changed_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(task_id) REFERENCES tasks(id))""")

    # Defaults
    if not conn.execute("SELECT COUNT(*) FROM sla_config").fetchone()[0]:
        conn.executemany("INSERT OR IGNORE INTO sla_config VALUES (?,?,?)", [
            ("critica",2,"Crítica — 2h"),("alta",8,"Alta — 8h"),
            ("media",24,"Média — 24h"),("baixa",72,"Baixa — 72h")])
    if not conn.execute("SELECT COUNT(*) FROM sectors").fetchone()[0]:
        for s in ["Administrativo","Financeiro","TI","Operações","Manutenção","RH","Comercial","Logística"]:
            conn.execute("INSERT OR IGNORE INTO sectors (name) VALUES (?)",(s,))
    conn.execute("INSERT OR IGNORE INTO config VALUES ('telegram_token','')")
    conn.execute("INSERT OR IGNORE INTO config VALUES ('api_url','http://localhost:8000')")
    try:
        conn.execute("ALTER TABLE tasks ADD COLUMN photos TEXT DEFAULT NULL")
        conn.commit()
    except: pass
    conn.execute("""CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'viewer' CHECK(role IN ('admin','manager','operator','viewer')),
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')))""")
    conn.execute("""CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(user_id) REFERENCES app_users(id))""")
    # Cria admin padrão se não existir
    if not conn.execute("SELECT COUNT(*) FROM app_users").fetchone()[0]:
        import hashlib as _hl, secrets as _sc
        salt = _sc.token_hex(16)
        h = _hl.sha256((salt + "admin123").encode()).hexdigest()
        conn.execute("INSERT INTO app_users (name,username,password,role) VALUES (?,?,?,?)",
                     ("Administrador","admin",f"{salt}:{h}","admin"))
    conn.commit()
    if not conn.execute("SELECT COUNT(*) FROM providers").fetchone()[0]:
        conn.executemany("INSERT INTO providers (name,sector) VALUES (?,?)",
                         [("João Santos","Manutenção"),("Pedro Alves","Elétrica")])
    if not conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]:
        for d in [
            ("Trocar lâmpadas corredor B","Lâmpadas queimadas no corredor B","Maria Silva","Administrativo",1,"João Santos","media","pendente","Manutenção","Administrativo","2026-04-10"),
            ("Conserto torneira banheiro","Torneira com vazamento","Carlos Lima","Operações",1,"João Santos","alta","em_andamento","Hidráulica","Operações","2026-04-08"),
            ("Ar condicionado sala 3","AC não liga","Direção","Administrativo",1,"João Santos","critica","pendente","Elétrica","Administrativo","2026-04-07"),
            ("Instalação tomada extra","Nova impressora","TI","TI",2,"Pedro Alves","baixa","pendente","Elétrica","TI","2026-04-15"),
            ("Pintura sala reuniões","Infiltração nas paredes","Ana Paula","Comercial",2,"Pedro Alves","baixa","concluida","Pintura","Comercial","2026-04-05"),
        ]:
            conn.execute("INSERT INTO tasks (title,description,requester,requester_sector,assignee_id,assignee,urgency,status,category,sector,due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)",d)
    conn.commit(); conn.close()

init_db()

def _autostart_bot():
    import threading, time as _t
    def _go():
        _t.sleep(2)
        try:
            conn = get_db()
            row = conn.execute("SELECT value FROM config WHERE key='telegram_token'").fetchone()
            conn.close()
            token = (row[0] if row else "").strip()
            if not token or len(token) < 20:
                return
            import subprocess, sys as _sys, platform as _plat
            bot_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.py")
            if not os.path.exists(bot_script):
                return
            pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.pid")
            if os.path.exists(pid_path):
                try:
                    with open(pid_path) as f: pid = int(f.read().strip())
                    os.kill(pid, 0)
                    print("[DespachaApp] Bot ja rodando.")
                    return
                except: pass
            env = os.environ.copy()
            env["TELEGRAM_TOKEN"] = token
            for v in ("HTTP_PROXY","HTTPS_PROXY","http_proxy","https_proxy","ALL_PROXY","all_proxy"):
                env.pop(v, None)
            log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.log")
            kw = {"env": env, "cwd": os.path.dirname(bot_script)}
            if _plat.system() == "Windows":
                kw["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
            with open(log_path, "w", encoding="utf-8") as lf:
                proc = subprocess.Popen([_sys.executable, "-u", bot_script], stdout=lf, stderr=lf, **kw)
            with open(pid_path, "w") as f:
                f.write(str(proc.pid))
            print(f"[DespachaApp] Bot iniciado automaticamente (PID {proc.pid})")
        except Exception as e:
            print(f"[DespachaApp] Autostart falhou: {e}")
    threading.Thread(target=_go, daemon=True).start()

_autostart_bot()

def row_to_dict(r): return dict(r)

def get_sla_deadline(urgency, from_dt=None):
    conn = get_db()
    row = conn.execute("SELECT hours FROM sla_config WHERE urgency=?",(urgency,)).fetchone()
    conn.close()
    if not row: return None
    base = from_dt or datetime.now()
    return (base + timedelta(hours=row[0])).strftime("%Y-%m-%d %H:%M:%S")

# ── Auth ─────────────────────────────────────────────
def _hash_pw(password: str) -> str:
    salt = _secrets.token_hex(16)
    h = hashlib.sha256((salt + password).encode()).hexdigest()
    return f"{salt}:{h}"

def _check_pw(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split(":", 1)
        return hashlib.sha256((salt + password).encode()).hexdigest() == h
    except: return False

def _get_user_from_token(token: str | None):
    if not token: return None
    conn = get_db()
    row = conn.execute(
        "SELECT u.* FROM app_users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND u.active=1",
        (token,)).fetchone()
    conn.close()
    return row_to_dict(row) if row else None

def require_auth(request: Request):
    token = request.cookies.get("dsession")
    user = _get_user_from_token(token)
    if not user: raise HTTPException(401, "Não autenticado")
    return user

def require_admin(request: Request):
    user = require_auth(request)
    if user["role"] != "admin": raise HTTPException(403, "Acesso negado")
    return user

@app.post("/api/auth/login")
async def login(request: Request):
    data = await request.json()
    username = data.get("username","").strip().lower()
    password = data.get("password","")
    conn = get_db()
    row = conn.execute("SELECT * FROM app_users WHERE LOWER(username)=? AND active=1",(username,)).fetchone()
    conn.close()
    if not row or not _check_pw(password, row["password"]):
        raise HTTPException(401, "Usuário ou senha incorretos")
    user = row_to_dict(row)
    token = _secrets.token_hex(32)
    conn = get_db()
    conn.execute("INSERT INTO sessions (token,user_id) VALUES (?,?)",(token,user["id"]))
    conn.commit(); conn.close()
    resp = JSONResponse({"ok":True,"user":{"id":user["id"],"name":user["name"],
                         "username":user["username"],"role":user["role"]}})
    resp.set_cookie("dsession", token, httponly=True, samesite="lax", max_age=86400*7)
    return resp

@app.post("/api/auth/logout")
def logout(request: Request):
    token = request.cookies.get("dsession")
    if token:
        conn = get_db(); conn.execute("DELETE FROM sessions WHERE token=?",(token,)); conn.commit(); conn.close()
    resp = JSONResponse({"ok":True})
    resp.delete_cookie("dsession")
    return resp

@app.get("/api/auth/me")
def me(request: Request):
    token = request.cookies.get("dsession")
    user = _get_user_from_token(token)
    if not user: raise HTTPException(401,"Não autenticado")
    return {"id":user["id"],"name":user["name"],"username":user["username"],"role":user["role"]}

# ── Users (CRUD — apenas admin) ──────────────────────
@app.get("/api/users")
def list_users(request: Request):
    require_auth(request)
    conn=get_db(); rows=conn.execute("SELECT id,name,username,role,active,created_at FROM app_users ORDER BY name").fetchall(); conn.close()
    return [row_to_dict(r) for r in rows]

class UserCreate(BaseModel):
    name: str; username: str; password: str; role: str = "viewer"

class UserUpdate(BaseModel):
    name: Optional[str]=None; username: Optional[str]=None
    password: Optional[str]=None; role: Optional[str]=None; active: Optional[int]=None

@app.post("/api/users", status_code=201)
async def create_user(request: Request, u: UserCreate):
    require_admin(request)
    conn=get_db()
    try:
        conn.execute("INSERT INTO app_users (name,username,password,role) VALUES (?,?,?,?)",
                     (u.name, u.username.lower(), _hash_pw(u.password), u.role))
        conn.commit()
        row=conn.execute("SELECT id,name,username,role,active FROM app_users WHERE username=?",(u.username.lower(),)).fetchone()
        conn.close(); return row_to_dict(row)
    except Exception as e:
        conn.close(); raise HTTPException(400, f"Usuário já existe: {e}")

@app.put("/api/users/{uid}")
async def update_user(uid: int, request: Request, u: UserUpdate):
    require_admin(request)
    conn=get_db()
    fields, params = [], []
    if u.name:     fields.append("name=?");     params.append(u.name)
    if u.username: fields.append("username=?"); params.append(u.username.lower())
    if u.password: fields.append("password=?"); params.append(_hash_pw(u.password))
    if u.role:     fields.append("role=?");     params.append(u.role)
    if u.active is not None: fields.append("active=?"); params.append(u.active)
    if fields:
        params.append(uid)
        conn.execute(f"UPDATE app_users SET {','.join(fields)} WHERE id=?", params)
        conn.commit()
    row=conn.execute("SELECT id,name,username,role,active FROM app_users WHERE id=?",(uid,)).fetchone()
    conn.close()
    return row_to_dict(row) if row else {}

@app.delete("/api/users/{uid}")
def delete_user(uid: int, request: Request):
    require_admin(request)
    conn=get_db(); conn.execute("UPDATE app_users SET active=0 WHERE id=?",(uid,)); conn.commit(); conn.close()
    return {"ok":True}

# ── Config ──────────────────────────────────────────
@app.get("/api/config")
def get_config():
    conn=get_db(); rows=conn.execute("SELECT key,value FROM config").fetchall(); conn.close()
    return {r["key"]:r["value"] for r in rows}

@app.put("/api/config")
async def update_config(request: Request):
    data = await request.json()
    conn=get_db()
    for k,v in data.items(): conn.execute("INSERT OR REPLACE INTO config VALUES (?,?)",(k,str(v)))
    conn.commit(); conn.close(); return {"ok":True}

# ── SLA ─────────────────────────────────────────────
@app.get("/api/sla")
def get_sla():
    conn=get_db(); rows=conn.execute("SELECT * FROM sla_config").fetchall(); conn.close()
    return [row_to_dict(r) for r in rows]

@app.put("/api/sla/{urgency}")
async def update_sla(urgency:str, request: Request):
    data = await request.json()
    conn=get_db()
    conn.execute("UPDATE sla_config SET hours=?,label=? WHERE urgency=?",(data["hours"],data.get("label",""),urgency))
    conn.commit(); conn.close(); return {"ok":True}

# ── Providers ───────────────────────────────────────
@app.get("/api/providers")
def list_providers():
    conn=get_db(); rows=conn.execute("SELECT * FROM providers ORDER BY name").fetchall(); conn.close()
    return [row_to_dict(r) for r in rows]

class ProviderModel(BaseModel):
    name:str; telegram_token:Optional[str]=""; chat_id:Optional[str]=""
    sector:Optional[str]=""; active:Optional[int]=1

@app.post("/api/providers",status_code=201)
def create_provider(p:ProviderModel):
    conn=get_db()
    cur=conn.execute("INSERT INTO providers (name,telegram_token,chat_id,sector,active) VALUES (?,?,?,?,?)",
                     (p.name,p.telegram_token,p.chat_id,p.sector,p.active))
    conn.commit(); row=conn.execute("SELECT * FROM providers WHERE id=?",(cur.lastrowid,)).fetchone(); conn.close()
    return row_to_dict(row)

@app.put("/api/providers/{pid}")
def update_provider(pid:int, p:ProviderModel):
    conn=get_db()
    conn.execute("UPDATE providers SET name=?,telegram_token=?,chat_id=?,sector=?,active=? WHERE id=?",
                 (p.name,p.telegram_token,p.chat_id,p.sector,p.active,pid))
    conn.commit(); row=conn.execute("SELECT * FROM providers WHERE id=?",(pid,)).fetchone(); conn.close()
    return row_to_dict(row)

@app.delete("/api/providers/{pid}")
def delete_provider(pid:int):
    conn=get_db(); conn.execute("DELETE FROM providers WHERE id=?",(pid,)); conn.commit(); conn.close()
    return {"ok":True}

@app.post("/api/providers/register_chat")
async def register_chat(request: Request):
    data = await request.json()
    conn=get_db()
    name=data.get("name","").strip(); chat_id=str(data.get("chat_id",""))
    row=conn.execute("SELECT id,name FROM providers WHERE LOWER(name) LIKE LOWER(?)",(f"%{name}%",)).fetchone()
    if row:
        conn.execute("UPDATE providers SET chat_id=? WHERE id=?",(chat_id,row["id"]))
        conn.commit(); conn.close()
        return {"ok":True,"provider_id":row["id"],"provider_name":row["name"]}
    conn.close(); return {"ok":False,"msg":"Prestador não encontrado"}

# ── Sectors ─────────────────────────────────────────
@app.get("/api/sectors")
def list_sectors():
    conn=get_db(); rows=conn.execute("SELECT * FROM sectors WHERE active=1 ORDER BY name").fetchall(); conn.close()
    return [row_to_dict(r) for r in rows]

@app.post("/api/sectors",status_code=201)
async def create_sector(request: Request):
    data = await request.json()
    conn=get_db()
    try:
        cur=conn.execute("INSERT INTO sectors (name) VALUES (?)",(data["name"],))
        conn.commit(); row=conn.execute("SELECT * FROM sectors WHERE id=?",(cur.lastrowid,)).fetchone(); conn.close()
        return row_to_dict(row)
    except: conn.close(); raise HTTPException(400,"Setor já existe")

@app.delete("/api/sectors/{sid}")
def delete_sector(sid:int):
    conn=get_db(); conn.execute("UPDATE sectors SET active=0 WHERE id=?",(sid,)); conn.commit(); conn.close()
    return {"ok":True}

# ── Tasks ───────────────────────────────────────────
class TaskCreate(BaseModel):
    title:str; description:Optional[str]=""; requester:str; requester_sector:Optional[str]=""
    assignee_id:Optional[int]=None; assignee:str; urgency:str="media"
    category:Optional[str]=""; sector:Optional[str]=""; due_date:Optional[str]=None; notes:Optional[str]=""
    photos:Optional[str]=None

class TaskUpdate(BaseModel):
    title:Optional[str]=None; description:Optional[str]=None; status:Optional[str]=None
    urgency:Optional[str]=None; assignee_id:Optional[int]=None; assignee:Optional[str]=None
    category:Optional[str]=None; sector:Optional[str]=None; requester_sector:Optional[str]=None
    due_date:Optional[str]=None; notes:Optional[str]=None; photos:Optional[str]=None; changed_by:Optional[str]="sistema"

@app.get("/api/tasks")
def list_tasks(status:Optional[str]=None,assignee:Optional[str]=None,assignee_id:Optional[int]=None,
               urgency:Optional[str]=None,sector:Optional[str]=None,search:Optional[str]=None,
               overdue:Optional[bool]=None,chat_id:Optional[str]=None):
    conn=get_db()
    if chat_id:
        p=conn.execute("SELECT id FROM providers WHERE chat_id=?",(chat_id,)).fetchone()
        if p: assignee_id=p["id"]
    q="SELECT * FROM tasks WHERE 1=1"; params=[]
    if status: q+=" AND status=?"; params.append(status)
    if assignee_id: q+=" AND assignee_id=?"; params.append(assignee_id)
    elif assignee: q+=" AND assignee LIKE ?"; params.append(f"%{assignee}%")
    if urgency: q+=" AND urgency=?"; params.append(urgency)
    if sector: q+=" AND (sector=? OR requester_sector=?)"; params+=[sector,sector]
    if search:
        q+=" AND (title LIKE ? OR description LIKE ? OR requester LIKE ? OR sector LIKE ?)"; params+=[f"%{search}%"]*4
    if overdue:
        now=datetime.now().strftime("%Y-%m-%d %H:%M:%S"); today=date.today().isoformat()
        q+=" AND ((due_date<? OR (sla_deadline IS NOT NULL AND sla_deadline<?)) AND status NOT IN ('concluida','cancelada'))"
        params+=[today,now]
    q+=" ORDER BY CASE urgency WHEN 'critica' THEN 1 WHEN 'alta' THEN 2 WHEN 'media' THEN 3 ELSE 4 END, id DESC"
    rows=conn.execute(q,params).fetchall(); conn.close()
    return [row_to_dict(r) for r in rows]

@app.get("/api/tasks/{task_id}")
def get_task(task_id:int):
    conn=get_db(); row=conn.execute("SELECT * FROM tasks WHERE id=?",(task_id,)).fetchone(); conn.close()
    if not row: raise HTTPException(404,"Não encontrada")
    return row_to_dict(row)

@app.post("/api/tasks",status_code=201)
def create_task(task:TaskCreate):
    conn=get_db()
    sla=get_sla_deadline(task.urgency)
    cur=conn.execute("""INSERT INTO tasks (title,description,requester,requester_sector,assignee_id,assignee,
        urgency,category,sector,due_date,sla_deadline,notes,photos) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (task.title,task.description,task.requester,task.requester_sector,task.assignee_id,
         task.assignee,task.urgency,task.category,task.sector,task.due_date,sla,task.notes,task.photos))
    conn.commit(); row=conn.execute("SELECT * FROM tasks WHERE id=?",(cur.lastrowid,)).fetchone(); conn.close()
    return row_to_dict(row)

@app.put("/api/tasks/{task_id}")
def update_task(task_id:int, update:TaskUpdate):
    conn=get_db()
    row=conn.execute("SELECT * FROM tasks WHERE id=?",(task_id,)).fetchone()
    if not row: conn.close(); raise HTTPException(404,"Não encontrada")
    old=row_to_dict(row)
    changes=update.dict(exclude_none=True,exclude={"changed_by"})
    fields,params=[],[]
    for k,v in changes.items(): fields.append(f"{k}=?"); params.append(v)
    now_str=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if "status" in changes:
        ns=changes["status"]
        if ns=="em_andamento" and not old.get("started_at"):
            fields.append("started_at=?"); params.append(now_str)
        if ns=="concluida":
            fields.append("completed_at=?"); params.append(now_str)
            if old.get("started_at"):
                try:
                    elapsed=int((datetime.now()-datetime.strptime(old["started_at"],"%Y-%m-%d %H:%M:%S")).total_seconds()/60)
                    fields.append("elapsed_minutes=?"); params.append(elapsed)
                except: pass
    if "urgency" in changes:
        try: base_dt=datetime.strptime(old.get("started_at") or now_str,"%Y-%m-%d %H:%M:%S")
        except: base_dt=datetime.now()
        fields.append("sla_deadline=?"); params.append(get_sla_deadline(changes["urgency"],base_dt))
    if fields:
        fields.append("updated_at=datetime('now','localtime')")
        params.append(task_id)
        conn.execute(f"UPDATE tasks SET {','.join(fields)} WHERE id=?",params)
        for k,v in changes.items():
            if str(old.get(k))!=str(v):
                conn.execute("INSERT INTO task_history (task_id,action,old_value,new_value,changed_by) VALUES (?,?,?,?,?)",
                             (task_id,k,old.get(k),v,update.changed_by or "sistema"))
        conn.commit()
    row=conn.execute("SELECT * FROM tasks WHERE id=?",(task_id,)).fetchone(); conn.close()
    return row_to_dict(row)

@app.delete("/api/tasks/{task_id}")
def delete_task(task_id:int):
    conn=get_db(); conn.execute("DELETE FROM tasks WHERE id=?",(task_id,)); conn.commit(); conn.close()
    return {"ok":True}

@app.get("/api/history/{task_id}")
def get_history(task_id:int):
    conn=get_db(); rows=conn.execute("SELECT * FROM task_history WHERE task_id=? ORDER BY changed_at DESC",(task_id,)).fetchall(); conn.close()
    return [row_to_dict(r) for r in rows]

@app.get("/api/stats")
def get_stats():
    conn=get_db(); today=date.today().isoformat(); now=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    s={}
    s["total"]=conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
    s["pendente"]=conn.execute("SELECT COUNT(*) FROM tasks WHERE status='pendente'").fetchone()[0]
    s["em_andamento"]=conn.execute("SELECT COUNT(*) FROM tasks WHERE status='em_andamento'").fetchone()[0]
    s["concluida"]=conn.execute("SELECT COUNT(*) FROM tasks WHERE status='concluida'").fetchone()[0]
    s["cancelada"]=conn.execute("SELECT COUNT(*) FROM tasks WHERE status='cancelada'").fetchone()[0]
    s["atrasadas"]=conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE (due_date<? OR (sla_deadline IS NOT NULL AND sla_deadline<?)) AND status NOT IN ('concluida','cancelada')",
        (today,now)).fetchone()[0]
    s["criticas"]=conn.execute("SELECT COUNT(*) FROM tasks WHERE urgency='critica' AND status NOT IN ('concluida','cancelada')").fetchone()[0]
    avg=conn.execute("SELECT AVG(elapsed_minutes) FROM tasks WHERE elapsed_minutes IS NOT NULL").fetchone()[0]
    s["avg_minutes"]=round(avg or 0)
    s["por_prestador"]=[dict(r) for r in conn.execute("""
        SELECT p.name as assignee, p.chat_id, COUNT(t.id) as total,
               SUM(CASE WHEN t.status='concluida' THEN 1 ELSE 0 END) as concluidas,
               SUM(CASE WHEN t.status='em_andamento' THEN 1 ELSE 0 END) as andamento,
               SUM(CASE WHEN t.status NOT IN ('concluida','cancelada') AND t.due_date<? THEN 1 ELSE 0 END) as atrasadas,
               CAST(AVG(CASE WHEN t.elapsed_minutes IS NOT NULL THEN t.elapsed_minutes END) AS INTEGER) as avg_min
        FROM providers p LEFT JOIN tasks t ON t.assignee_id=p.id GROUP BY p.id ORDER BY p.name""",(today,)).fetchall()]
    s["por_setor"]=[dict(r) for r in conn.execute("""
        SELECT sector, COUNT(*) as total,
               SUM(CASE WHEN status='concluida' THEN 1 ELSE 0 END) as concluidas,
               SUM(CASE WHEN status NOT IN ('concluida','cancelada') THEN 1 ELSE 0 END) as abertas
        FROM tasks WHERE sector IS NOT NULL AND sector!='' GROUP BY sector ORDER BY total DESC""").fetchall()]
    conn.close(); return s

@app.get("/")
def index():
    with open("index.html","r",encoding="utf-8") as f: return HTMLResponse(f.read())

# ── Bot Control ─────────────────────────────────────────────────────────────
@app.get("/api/bot/status")
def bot_status():
    conn = get_db()
    row = conn.execute("SELECT value FROM config WHERE key='telegram_token'").fetchone()
    conn.close()
    has_token = bool(row and row[0] and len((row[0] or "").strip()) > 20)
    running = False
    pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.pid")
    if os.path.exists(pid_path):
        try:
            with open(pid_path) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)  # sinal 0 = apenas verifica existência
            running = True
        except (ValueError, OSError):
            try: os.remove(pid_path)
            except: pass
    return {"running": running, "has_token": has_token}

@app.post("/api/bot/start")
def bot_start():
    import subprocess, sys as _sys, time as _time, platform as _plat
    conn = get_db()
    row  = conn.execute("SELECT value FROM config WHERE key='telegram_token'").fetchone()
    api_row = conn.execute("SELECT value FROM config WHERE key='api_url'").fetchone()
    conn.close()

    token = (row[0] if row else "").strip()
    if not token or len(token) < 20:
        raise HTTPException(400, "Token não configurado")

    api_url = (api_row[0] if api_row else "http://localhost:8000").strip() or "http://localhost:8000"

    # ── Para instância anterior ──────────────────────────────────────────
    _kill_bot()
    _time.sleep(0.8)

    # ── Monta ambiente ────────────────────────────────────────────────────
    env = os.environ.copy()
    env["TELEGRAM_TOKEN"] = token
    env["API_URL"]        = api_url
    # Remove vars de proxy que podem bloquear a conexão ao Telegram
    for var in ("HTTP_PROXY","HTTPS_PROXY","http_proxy","https_proxy","ALL_PROXY","all_proxy"):
        env.pop(var, None)

    # ── Localiza bot.py relativo ao app.py ───────────────────────────────
    bot_script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.py")
    if not os.path.exists(bot_script):
        raise HTTPException(500, f"bot.py não encontrado em: {bot_script}")

    # ── Inicia processo ──────────────────────────────────────────────────
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.log")

    # Windows: usa DETACHED_PROCESS para não herdar console do uvicorn
    kwargs = {"env": env, "cwd": os.path.dirname(bot_script)}
    if _plat.system() == "Windows":
        kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP

    with open(log_path, "w", encoding="utf-8") as log_f:
        proc = subprocess.Popen(
            [_sys.executable, "-u", bot_script],
            stdout=log_f, stderr=log_f,
            **kwargs
        )

    # ── Aguarda e verifica sobrevivência ─────────────────────────────────
    _time.sleep(3.0)

    if proc.poll() is not None:
        # Processo já morreu — lê log para diagnóstico
        _time.sleep(0.2)  # garante flush do OS
        try:
            with open(log_path, encoding="utf-8", errors="replace") as lf:
                detail = lf.read().strip()[-800:] or "(log vazio)"
        except Exception as e:
            detail = f"Erro ao ler log: {e}"
        raise HTTPException(500, "Bot encerrou imediatamente.\nLog:\n" + detail)

    # Salva PID
    pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.pid")
    with open(pid_path, "w") as f:
        f.write(str(proc.pid))

    return {"ok": True, "pid": proc.pid}


def _kill_bot():
    """Para o processo do bot se estiver rodando."""
    pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.pid")
    if not os.path.exists(pid_path):
        return
    try:
        with open(pid_path) as f:
            pid = int(f.read().strip())
        import platform
        if platform.system() == "Windows":
            import subprocess as _sp
            _sp.run(["taskkill", "/F", "/PID", str(pid)], capture_output=True)
        else:
            os.kill(pid, 15)
    except Exception:
        pass
    try:
        os.remove(pid_path)
    except Exception:
        pass

@app.post("/api/bot/stop")
def bot_stop():
    pid_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.pid")
    running_before = os.path.exists(pid_path)
    _kill_bot()
    return {"ok": True, "stopped": running_before}

@app.get("/api/bot/log")
def bot_log():
    """Retorna as últimas linhas do log do bot."""
    log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bot.log")
    try:
        with open(log_path, encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {"log": content[-3000:]}
    except FileNotFoundError:
        return {"log": ""}

@app.post("/api/bot/validate_token")
async def validate_token_endpoint(request: Request):
    import urllib.request as _ur, json as _j
    data = await request.json()
    token = data.get("token","").strip()
    if not token or len(token) < 20:
        return {"valid": False, "error": "Token muito curto"}
    try:
        with _ur.urlopen(f"https://api.telegram.org/bot{token}/getMe", timeout=5) as r:
            result = _j.loads(r.read())
        if result.get("ok"):
            bot = result["result"]
            return {"valid": True, "bot_name": bot.get("first_name"), "username": bot.get("username")}
        return {"valid": False, "error": result.get("description","Token inválido")}
    except Exception as e:
        return {"valid": False, "error": str(e)}
