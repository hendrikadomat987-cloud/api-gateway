-- =============================================================================
-- knowledge service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.knowledge (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  title       text        not null,
  content     text        not null,
  category    text,
  status      text        not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index if not exists idx_knowledge_tenant_id on public.knowledge (tenant_id);
create index if not exists idx_knowledge_status    on public.knowledge (tenant_id, status);
create index if not exists idx_knowledge_category  on public.knowledge (tenant_id, category);

-- Constraints
alter table public.knowledge
  drop constraint if exists chk_knowledge_status;
alter table public.knowledge
  add constraint chk_knowledge_status
  check (status in ('draft','published','archived'));

-- updated_at trigger
create or replace function public.set_knowledge_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_knowledge_updated_at on public.knowledge;
create trigger trg_knowledge_updated_at
  before update on public.knowledge
  for each row execute function public.set_knowledge_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.knowledge enable row level security;
alter table public.knowledge force row level security;

drop policy if exists knowledge_tenant_isolation on public.knowledge;

create policy knowledge_tenant_isolation on public.knowledge
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: knowledge_create
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_create(
  p_tenant_id uuid,
  p_title     text,
  p_content   text,
  p_category  text    default null,
  p_status    text    default 'draft'
)
returns table (
  id uuid, tenant_id uuid, title text, content text,
  category text, status text, created_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_statuses text[] := array['draft','published','archived'];
begin
  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of draft, published, archived';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.knowledge (tenant_id, title, content, category, status)
    values (p_tenant_id, p_title, p_content, p_category, p_status)
    returning
      public.knowledge.id,
      public.knowledge.tenant_id,
      public.knowledge.title,
      public.knowledge.content,
      public.knowledge.category,
      public.knowledge.status,
      public.knowledge.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: knowledge_list
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, title text, content text,
  category text, status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      k.id, k.tenant_id, k.title, k.content,
      k.category, k.status, k.created_at, k.updated_at
    from public.knowledge k
    where k.tenant_id = p_tenant_id
    order by k.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: knowledge_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid, tenant_id uuid, title text, content text,
  category text, status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      k.id, k.tenant_id, k.title, k.content,
      k.category, k.status, k.created_at, k.updated_at
    from public.knowledge k
    where k.tenant_id = p_tenant_id
      and k.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: knowledge_update
-- Partial update — only provided fields are changed (coalesce pattern).
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_update(
  p_tenant_id uuid,
  p_id        uuid,
  p_title     text    default null,
  p_content   text    default null,
  p_category  text    default null,
  p_status    text    default null
)
returns table (
  id uuid, tenant_id uuid, title text, content text,
  category text, status text, updated_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_statuses text[] := array['draft','published','archived'];
begin
  if p_status is not null and not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of draft, published, archived';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.knowledge as k
    set
      title      = coalesce(p_title,    k.title),
      content    = coalesce(p_content,  k.content),
      category   = coalesce(p_category, k.category),
      status     = coalesce(p_status,   k.status),
      updated_at = now()
    where k.id = p_id
      and k.tenant_id = p_tenant_id
    returning
      k.id,
      k.tenant_id,
      k.title,
      k.content,
      k.category,
      k.status,
      k.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: knowledge_delete
-- Idempotent: returns the requested id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.knowledge_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.knowledge as k
  where k.id = p_id
    and k.tenant_id = p_tenant_id
  returning k.id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant execute on function public.knowledge_create     to authenticated, service_role;
grant execute on function public.knowledge_list       to authenticated, service_role;
grant execute on function public.knowledge_get_by_id to authenticated, service_role;
grant execute on function public.knowledge_update     to authenticated, service_role;
grant execute on function public.knowledge_delete     to authenticated, service_role;
