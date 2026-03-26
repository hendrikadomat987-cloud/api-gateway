-- =============================================================================
-- resources service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.resources (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null,
  name       text        not null,
  type       text        not null,
  content    text,
  status     text        not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_resources_tenant_id on public.resources (tenant_id);
create index if not exists idx_resources_type      on public.resources (tenant_id, type);
create index if not exists idx_resources_status    on public.resources (tenant_id, status);

-- updated_at trigger
create or replace function public.set_resources_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_resources_updated_at on public.resources;
create trigger trg_resources_updated_at
  before update on public.resources
  for each row execute function public.set_resources_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.resources enable row level security;
alter table public.resources force row level security;

drop policy if exists resources_tenant_isolation on public.resources;

create policy resources_tenant_isolation on public.resources
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: resource_create
-- -----------------------------------------------------------------------------
create or replace function public.resource_create(
  p_tenant_id uuid,
  p_name      text,
  p_type      text,
  p_content   text default null,
  p_status    text default 'active'
)
returns table (id uuid, tenant_id uuid, name text, type text, content text, status text, created_at timestamptz)
language plpgsql security definer as $$
declare
  valid_types    text[] := array['document','template','script','faq'];
  valid_statuses text[] := array['active','draft','archived'];
begin
  if not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of document, template, script, faq';
  end if;

  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of active, draft, archived';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.resources (tenant_id, name, type, content, status)
    values (p_tenant_id, p_name, p_type, p_content, p_status)
    returning
      public.resources.id,
      public.resources.tenant_id,
      public.resources.name,
      public.resources.type,
      public.resources.content,
      public.resources.status,
      public.resources.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: resource_list
-- -----------------------------------------------------------------------------
create or replace function public.resource_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, name text, type text,
  content text, status text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      res.id, res.tenant_id, res.name, res.type,
      res.content, res.status,
      res.created_at, res.updated_at
    from public.resources res
    where res.tenant_id = p_tenant_id
    order by res.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: resource_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.resource_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid, tenant_id uuid, name text, type text,
  content text, status text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      res.id, res.tenant_id, res.name, res.type,
      res.content, res.status,
      res.created_at, res.updated_at
    from public.resources res
    where res.tenant_id = p_tenant_id
      and res.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: resource_update
-- Partial update — only provided fields are changed (coalesce pattern).
-- -----------------------------------------------------------------------------
create or replace function public.resource_update(
  p_tenant_id uuid,
  p_id        uuid,
  p_name      text default null,
  p_type      text default null,
  p_content   text default null,
  p_status    text default null
)
returns table (id uuid, tenant_id uuid, name text, type text, content text, status text, updated_at timestamptz)
language plpgsql security definer as $$
declare
  valid_types    text[] := array['document','template','script','faq'];
  valid_statuses text[] := array['active','draft','archived'];
begin
  if p_type is not null and not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of document, template, script, faq';
  end if;

  if p_status is not null and not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of active, draft, archived';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.resources as res
    set
      name       = coalesce(p_name,    res.name),
      type       = coalesce(p_type,    res.type),
      content    = coalesce(p_content, res.content),
      status     = coalesce(p_status,  res.status),
      updated_at = now()
    where res.id = p_id
      and res.tenant_id = p_tenant_id
    returning
      res.id,
      res.tenant_id,
      res.name,
      res.type,
      res.content,
      res.status,
      res.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: resource_delete
-- Idempotent: returns the requested id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.resource_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.resources as res
  where res.id = p_id
    and res.tenant_id = p_tenant_id
  returning res.id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants (adjust role names to match your Supabase setup)
-- -----------------------------------------------------------------------------
grant execute on function public.resource_create     to authenticated, service_role;
grant execute on function public.resource_list       to authenticated, service_role;
grant execute on function public.resource_get_by_id to authenticated, service_role;
grant execute on function public.resource_update     to authenticated, service_role;
grant execute on function public.resource_delete     to authenticated, service_role;
