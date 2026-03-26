-- =============================================================================
-- requests service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null,
  customer_id  uuid not null,
  type         text not null,
  status       text not null default 'pending',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Indexes
create index if not exists idx_requests_tenant_id    on public.requests (tenant_id);
create index if not exists idx_requests_customer_id  on public.requests (tenant_id, customer_id);
create index if not exists idx_requests_status       on public.requests (tenant_id, status);

-- updated_at trigger
create or replace function public.set_requests_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_requests_updated_at on public.requests;
create trigger trg_requests_updated_at
  before update on public.requests
  for each row execute function public.set_requests_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.requests enable row level security;
alter table public.requests force row level security;

-- Drop existing policies before recreating
drop policy if exists requests_tenant_isolation on public.requests;

create policy requests_tenant_isolation on public.requests
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
returns table (id uuid, tenant_id uuid, customer_id uuid, type text, status text, notes text, created_at timestamptz)
language plpgsql security definer as $$
declare
  valid_types   text[] := array['callback','support','quote','info'];
  valid_statuses text[] := array['pending','in_progress','resolved','closed'];
begin
  -- Enforce allowed type values
  if not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of callback, support, quote, info';
  end if;

  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of pending, in_progress, resolved, closed';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.requests (tenant_id, customer_id, type, status, notes)
    values (p_tenant_id, p_customer_id, p_type, p_status, p_notes)
    returning
      public.requests.id,
      public.requests.tenant_id,
      public.requests.customer_id,
      public.requests.type,
      public.requests.status,
      public.requests.notes,
      public.requests.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_list
-- -----------------------------------------------------------------------------
create or replace function public.request_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  type text, status text, notes text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      r.id, r.tenant_id, r.customer_id,
      r.type, r.status, r.notes,
      r.created_at, r.updated_at
    from public.requests r
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
  id uuid, tenant_id uuid, customer_id uuid,
  type text, status text, notes text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      r.id, r.tenant_id, r.customer_id,
      r.type, r.status, r.notes,
      r.created_at, r.updated_at
    from public.requests r
    where r.tenant_id = p_tenant_id
      and r.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_update
-- -----------------------------------------------------------------------------
create or replace function public.request_update(
  p_tenant_id uuid,
  p_id        uuid,
  p_type      text default null,
  p_status    text default null,
  p_notes     text default null
)
returns table (id uuid, tenant_id uuid, customer_id uuid, type text, status text, notes text, updated_at timestamptz)
language plpgsql security definer as $$
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
    update public.requests
    set
      type      = coalesce(p_type,   type),
      status    = coalesce(p_status, status),
      notes     = coalesce(p_notes,  notes),
      updated_at = now()
    where id = p_id
      and tenant_id = p_tenant_id
    returning
      public.requests.id,
      public.requests.tenant_id,
      public.requests.customer_id,
      public.requests.type,
      public.requests.status,
      public.requests.notes,
      public.requests.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: request_delete
-- Idempotent: returns id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.request_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.requests
  where id = p_id
    and tenant_id = p_tenant_id
  returning id into v_deleted_id;

  -- Idempotent: return the requested id regardless
  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants (adjust role names to match your Supabase setup)
-- -----------------------------------------------------------------------------
grant execute on function public.request_create      to authenticated, service_role;
grant execute on function public.request_list        to authenticated, service_role;
grant execute on function public.request_get_by_id  to authenticated, service_role;
grant execute on function public.request_update      to authenticated, service_role;
grant execute on function public.request_delete      to authenticated, service_role;
