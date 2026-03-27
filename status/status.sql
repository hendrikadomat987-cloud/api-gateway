-- =============================================================================
-- status service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.status (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  name        text        not null,
  type        text        not null,
  value       text        not null default 'unknown',
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index if not exists idx_status_tenant_id on public.status (tenant_id);
create index if not exists idx_status_type      on public.status (tenant_id, type);
create index if not exists idx_status_value     on public.status (tenant_id, value);

-- Constraints
alter table public.status
  drop constraint if exists chk_status_type;
alter table public.status
  add constraint chk_status_type
  check (type in ('agent','service','system','resource'));

alter table public.status
  drop constraint if exists chk_status_value;
alter table public.status
  add constraint chk_status_value
  check (value in ('online','offline','busy','available','unknown'));

-- updated_at trigger
create or replace function public.set_status_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_status_updated_at on public.status;
create trigger trg_status_updated_at
  before update on public.status
  for each row execute function public.set_status_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.status enable row level security;
alter table public.status force row level security;

drop policy if exists status_tenant_isolation on public.status;

create policy status_tenant_isolation on public.status
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: status_create
-- -----------------------------------------------------------------------------
create or replace function public.status_create(
  p_tenant_id   uuid,
  p_name        text,
  p_type        text,
  p_value       text    default 'unknown',
  p_description text    default null
)
returns table (
  id uuid, tenant_id uuid, name text, type text,
  value text, description text, created_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_types  text[] := array['agent','service','system','resource'];
  valid_values text[] := array['online','offline','busy','available','unknown'];
begin
  if not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of agent, service, system, resource';
  end if;

  if not (p_value = any(valid_values)) then
    raise exception 'INVALID_VALUE: value must be one of online, offline, busy, available, unknown';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.status (tenant_id, name, type, value, description)
    values (p_tenant_id, p_name, p_type, p_value, p_description)
    returning
      public.status.id,
      public.status.tenant_id,
      public.status.name,
      public.status.type,
      public.status.value,
      public.status.description,
      public.status.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: status_list
-- -----------------------------------------------------------------------------
create or replace function public.status_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, name text, type text,
  value text, description text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      s.id, s.tenant_id, s.name, s.type,
      s.value, s.description, s.created_at, s.updated_at
    from public.status s
    where s.tenant_id = p_tenant_id
    order by s.type asc, s.name asc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: status_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.status_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid, tenant_id uuid, name text, type text,
  value text, description text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      s.id, s.tenant_id, s.name, s.type,
      s.value, s.description, s.created_at, s.updated_at
    from public.status s
    where s.tenant_id = p_tenant_id
      and s.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: status_update
-- Partial update — only provided fields are changed (coalesce pattern).
-- -----------------------------------------------------------------------------
create or replace function public.status_update(
  p_tenant_id   uuid,
  p_id          uuid,
  p_name        text    default null,
  p_type        text    default null,
  p_value       text    default null,
  p_description text    default null
)
returns table (
  id uuid, tenant_id uuid, name text, type text,
  value text, description text, updated_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_types  text[] := array['agent','service','system','resource'];
  valid_values text[] := array['online','offline','busy','available','unknown'];
begin
  if p_type is not null and not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of agent, service, system, resource';
  end if;

  if p_value is not null and not (p_value = any(valid_values)) then
    raise exception 'INVALID_VALUE: value must be one of online, offline, busy, available, unknown';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.status as s
    set
      name        = coalesce(p_name,        s.name),
      type        = coalesce(p_type,        s.type),
      value       = coalesce(p_value,       s.value),
      description = coalesce(p_description, s.description),
      updated_at  = now()
    where s.id = p_id
      and s.tenant_id = p_tenant_id
    returning
      s.id,
      s.tenant_id,
      s.name,
      s.type,
      s.value,
      s.description,
      s.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: status_delete
-- Idempotent: returns the requested id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.status_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.status as s
  where s.id = p_id
    and s.tenant_id = p_tenant_id
  returning s.id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant execute on function public.status_create     to authenticated, service_role;
grant execute on function public.status_list       to authenticated, service_role;
grant execute on function public.status_get_by_id to authenticated, service_role;
grant execute on function public.status_update     to authenticated, service_role;
grant execute on function public.status_delete     to authenticated, service_role;
