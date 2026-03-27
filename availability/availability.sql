-- =============================================================================
-- availability service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.availability (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  customer_id uuid        not null,
  day_of_week integer     not null,
  start_time  text        not null,
  end_time    text        not null,
  status      text        not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index if not exists idx_availability_tenant_id   on public.availability (tenant_id);
create index if not exists idx_availability_customer_id on public.availability (tenant_id, customer_id);
create index if not exists idx_availability_day         on public.availability (tenant_id, day_of_week);

-- Constraints
alter table public.availability
  drop constraint if exists chk_availability_day_of_week;
alter table public.availability
  add constraint chk_availability_day_of_week
  check (day_of_week >= 0 and day_of_week <= 6);

alter table public.availability
  drop constraint if exists chk_availability_status;
alter table public.availability
  add constraint chk_availability_status
  check (status in ('active','inactive','blocked'));

-- updated_at trigger
create or replace function public.set_availability_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_availability_updated_at on public.availability;
create trigger trg_availability_updated_at
  before update on public.availability
  for each row execute function public.set_availability_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.availability enable row level security;
alter table public.availability force row level security;

drop policy if exists availability_tenant_isolation on public.availability;

create policy availability_tenant_isolation on public.availability
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: availability_create
-- -----------------------------------------------------------------------------
create or replace function public.availability_create(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_day_of_week integer,
  p_start_time  text,
  p_end_time    text,
  p_status      text default 'active'
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  day_of_week integer, start_time text, end_time text,
  status text, created_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_statuses text[] := array['active','inactive','blocked'];
begin
  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'INVALID_DAY_OF_WEEK: day_of_week must be an integer between 0 and 6';
  end if;

  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of active, inactive, blocked';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.availability (tenant_id, customer_id, day_of_week, start_time, end_time, status)
    values (p_tenant_id, p_customer_id, p_day_of_week, p_start_time, p_end_time, p_status)
    returning
      public.availability.id,
      public.availability.tenant_id,
      public.availability.customer_id,
      public.availability.day_of_week,
      public.availability.start_time,
      public.availability.end_time,
      public.availability.status,
      public.availability.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: availability_list
-- -----------------------------------------------------------------------------
create or replace function public.availability_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  day_of_week integer, start_time text, end_time text,
  status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      a.id, a.tenant_id, a.customer_id,
      a.day_of_week, a.start_time, a.end_time,
      a.status, a.created_at, a.updated_at
    from public.availability a
    where a.tenant_id = p_tenant_id
    order by a.day_of_week asc, a.start_time asc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: availability_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.availability_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  day_of_week integer, start_time text, end_time text,
  status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      a.id, a.tenant_id, a.customer_id,
      a.day_of_week, a.start_time, a.end_time,
      a.status, a.created_at, a.updated_at
    from public.availability a
    where a.tenant_id = p_tenant_id
      and a.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: availability_update
-- Partial update — only provided fields are changed (coalesce pattern).
-- -----------------------------------------------------------------------------
create or replace function public.availability_update(
  p_tenant_id   uuid,
  p_id          uuid,
  p_day_of_week integer default null,
  p_start_time  text    default null,
  p_end_time    text    default null,
  p_status      text    default null
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  day_of_week integer, start_time text, end_time text,
  status text, updated_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_statuses text[] := array['active','inactive','blocked'];
begin
  if p_day_of_week is not null and (p_day_of_week < 0 or p_day_of_week > 6) then
    raise exception 'INVALID_DAY_OF_WEEK: day_of_week must be an integer between 0 and 6';
  end if;

  if p_status is not null and not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of active, inactive, blocked';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.availability as a
    set
      day_of_week = coalesce(p_day_of_week, a.day_of_week),
      start_time  = coalesce(p_start_time,  a.start_time),
      end_time    = coalesce(p_end_time,    a.end_time),
      status      = coalesce(p_status,      a.status),
      updated_at  = now()
    where a.id = p_id
      and a.tenant_id = p_tenant_id
    returning
      a.id,
      a.tenant_id,
      a.customer_id,
      a.day_of_week,
      a.start_time,
      a.end_time,
      a.status,
      a.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: availability_delete
-- Idempotent: returns the requested id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.availability_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.availability as a
  where a.id = p_id
    and a.tenant_id = p_tenant_id
  returning a.id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant execute on function public.availability_create     to authenticated, service_role;
grant execute on function public.availability_list       to authenticated, service_role;
grant execute on function public.availability_get_by_id to authenticated, service_role;
grant execute on function public.availability_update     to authenticated, service_role;
grant execute on function public.availability_delete     to authenticated, service_role;
