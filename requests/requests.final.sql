-- =============================================================================
-- requests service — FINAL CLEAN SQL
-- Idempotent Supabase migration derived from the working implementation.
-- Covers:
--   - final table shape
--   - legacy schema normalization
--   - indexes
--   - updated_at trigger
--   - RLS + FORCE RLS
--   - RPC CRUD functions
--   - grants
--
-- Notes:
--   - Uses app.current_tenant_id for RLS / tenant context.
--   - Keeps any legacy "description" column untouched, but the service uses "notes".
--   - Adds the customer FK if missing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE (fresh install shape)
-- -----------------------------------------------------------------------------
create table if not exists public.requests (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  customer_id uuid        not null,
  type        text        not null,
  status      text        not null default 'pending',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- LEGACY NORMALIZATION
-- Makes older request tables compatible with the final service contract.
-- -----------------------------------------------------------------------------
alter table public.requests
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

-- If an older schema still has "description", copy values into "notes" where empty.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'requests'
      and column_name = 'description'
  ) then
    execute $sql$
      update public.requests
      set notes = coalesce(notes, description)
      where coalesce(notes, '') = ''
    $sql$;
  end if;
end $$;

-- Normalize timestamps to timestamptz if older schema used timestamp without time zone.
do $$
declare
  v_created_at_type text;
  v_updated_at_type text;
begin
  select data_type
    into v_created_at_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'requests'
    and column_name = 'created_at';

  if v_created_at_type = 'timestamp without time zone' then
    execute $sql$
      alter table public.requests
        alter column created_at type timestamptz
        using created_at at time zone 'UTC'
    $sql$;
  end if;

  select data_type
    into v_updated_at_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'requests'
    and column_name = 'updated_at';

  if v_updated_at_type = 'timestamp without time zone' then
    execute $sql$
      alter table public.requests
        alter column updated_at type timestamptz
        using updated_at at time zone 'UTC'
    $sql$;
  end if;
end $$;

alter table public.requests
  alter column created_at set default now(),
  alter column updated_at set default now();

-- Optional but recommended checks
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'requests_type_check'
  ) then
    alter table public.requests
      add constraint requests_type_check
      check (type in ('callback', 'support', 'quote', 'info'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'requests_status_check'
  ) then
    alter table public.requests
      add constraint requests_status_check
      check (status in ('pending', 'in_progress', 'resolved', 'closed'));
  end if;
end $$;

-- Add FK to customers if missing.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'requests_customer_id_fkey'
  ) then
    alter table public.requests
      add constraint requests_customer_id_fkey
      foreign key (customer_id)
      references public.customers(id)
      on update cascade
      on delete restrict;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- INDEXES
-- -----------------------------------------------------------------------------
create index if not exists idx_requests_tenant_id
  on public.requests (tenant_id);

create index if not exists idx_requests_customer_id
  on public.requests (tenant_id, customer_id);

create index if not exists idx_requests_status
  on public.requests (tenant_id, status);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
create or replace function public.set_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_requests_updated_at on public.requests;

create trigger trg_requests_updated_at
  before update on public.requests
  for each row
  execute function public.set_requests_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.requests enable row level security;
alter table public.requests force row level security;

drop policy if exists requests_tenant_isolation on public.requests;

create policy requests_tenant_isolation
on public.requests
using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: request_create
-- -----------------------------------------------------------------------------
create or replace function public.request_create(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_type        text,
  p_status      text default 'pending',
  p_notes       text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  customer_id uuid,
  type text,
  status text,
  notes text,
  created_at timestamptz
)
language plpgsql
security definer
as $$
declare
  valid_types    text[] := array['callback','support','quote','info'];
  valid_statuses text[] := array['pending','in_progress','resolved','closed'];
begin
  if not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of callback, support, quote, info';
  end if;

  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of pending, in_progress, resolved, closed';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.requests as r (
      tenant_id,
      customer_id,
      type,
      status,
      notes
    )
    values (
      p_tenant_id,
      p_customer_id,
      p_type,
      p_status,
      p_notes
    )
    returning
      r.id,
      r.tenant_id,
      r.customer_id,
      r.type,
      r.status,
      r.notes,
      r.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_list
-- -----------------------------------------------------------------------------
create or replace function public.request_list(
  p_tenant_id uuid
)
returns table (
  id uuid,
  tenant_id uuid,
  customer_id uuid,
  type text,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      r.id,
      r.tenant_id,
      r.customer_id,
      r.type,
      r.status,
      r.notes,
      r.created_at,
      r.updated_at
    from public.requests as r
    where r.tenant_id = p_tenant_id
    order by r.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.request_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid,
  tenant_id uuid,
  customer_id uuid,
  type text,
  status text,
  notes text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      r.id,
      r.tenant_id,
      r.customer_id,
      r.type,
      r.status,
      r.notes,
      r.created_at,
      r.updated_at
    from public.requests as r
    where r.tenant_id = p_tenant_id
      and r.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_update
-- Partial update — only provided fields are changed.
-- -----------------------------------------------------------------------------
create or replace function public.request_update(
  p_tenant_id uuid,
  p_id        uuid,
  p_type      text default null,
  p_status    text default null,
  p_notes     text default null
)
returns table (
  id uuid,
  tenant_id uuid,
  customer_id uuid,
  type text,
  status text,
  notes text,
  updated_at timestamptz
)
language plpgsql
security definer
as $$
declare
  valid_types    text[] := array['callback','support','quote','info'];
  valid_statuses text[] := array['pending','in_progress','resolved','closed'];
begin
  if p_type is not null and not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of callback, support, quote, info';
  end if;

  if p_status is not null and not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of pending, in_progress, resolved, closed';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.requests as r
    set
      type       = coalesce(p_type,   r.type),
      status     = coalesce(p_status, r.status),
      notes      = coalesce(p_notes,  r.notes),
      updated_at = now()
    where r.id = p_id
      and r.tenant_id = p_tenant_id
    returning
      r.id,
      r.tenant_id,
      r.customer_id,
      r.type,
      r.status,
      r.notes,
      r.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_delete
-- Idempotent: returns the requested id even if no row was deleted.
-- -----------------------------------------------------------------------------
create or replace function public.request_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.requests as r
  where r.id = p_id
    and r.tenant_id = p_tenant_id
  returning r.id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- GRANTS
-- -----------------------------------------------------------------------------
grant execute on function public.request_create(uuid, uuid, text, text, text)
  to authenticated, service_role;

grant execute on function public.request_list(uuid)
  to authenticated, service_role;

grant execute on function public.request_get_by_id(uuid, uuid)
  to authenticated, service_role;

grant execute on function public.request_update(uuid, uuid, text, text, text)
  to authenticated, service_role;

grant execute on function public.request_delete(uuid, uuid)
  to authenticated, service_role;
