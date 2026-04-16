-- DespachaApp — Schema Supabase (PostgreSQL)
-- Execute este arquivo no SQL Editor do Supabase

-- ── Extensões ───────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Tabelas ─────────────────────────────────────────────────────────

create table if not exists providers (
  id         serial primary key,
  name       text not null,
  telegram_token text default '',
  chat_id    text default '',
  sector     text default '',
  active     integer default 1,
  created_at timestamptz default now()
);

create table if not exists sectors (
  id     serial primary key,
  name   text not null unique,
  active integer default 1
);

create table if not exists sla_config (
  urgency text primary key,
  hours   integer not null,
  label   text
);

create table if not exists tasks (
  id               serial primary key,
  title            text not null,
  description      text default '',
  requester        text not null,
  requester_sector text default '',
  assignee_id      integer references providers(id),
  assignee         text not null,
  urgency          text default 'media' check(urgency in ('baixa','media','alta','critica')),
  status           text default 'pendente' check(status in ('pendente','em_andamento','concluida','cancelada')),
  category         text default '',
  sector           text default '',
  due_date         date,
  sla_deadline     timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  elapsed_minutes  integer,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  notes            text default '',
  photos           text
);

create table if not exists task_history (
  id          serial primary key,
  task_id     integer references tasks(id) on delete cascade,
  action      text,
  old_value   text,
  new_value   text,
  changed_by  text,
  changed_at  timestamptz default now()
);

create table if not exists config (
  key   text primary key,
  value text default ''
);

-- ── RLS (Row Level Security) ──────────────────────────────────────
-- Permite que qualquer usuário autenticado leia e escreva em todas as tabelas

alter table providers    enable row level security;
alter table sectors      enable row level security;
alter table sla_config   enable row level security;
alter table tasks        enable row level security;
alter table task_history enable row level security;
alter table config       enable row level security;

-- Policies: qualquer autenticado pode tudo
create policy "auth_all" on providers    for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth_all" on sectors      for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth_all" on sla_config   for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth_all" on tasks        for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth_all" on task_history for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "auth_all" on config       for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- ── Dados padrão ─────────────────────────────────────────────────

insert into sla_config values
  ('critica', 2,  'Crítica — 2h'),
  ('alta',    8,  'Alta — 8h'),
  ('media',   24, 'Média — 24h'),
  ('baixa',   72, 'Baixa — 72h')
on conflict (urgency) do nothing;

insert into sectors (name) values
  ('Administrativo'),('Financeiro'),('TI'),
  ('Operações'),('Manutenção'),('RH'),('Comercial'),('Logística')
on conflict (name) do nothing;

insert into config (key, value) values
  ('telegram_token', ''),
  ('bot_running', 'false')
on conflict (key) do nothing;

-- ── Trigger updated_at ────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger tasks_updated_at
  before update on tasks
  for each row execute function set_updated_at();
