-- =============================================================================
-- availability-engine — SQL migration
-- Apply to Supabase AFTER availability.sql and appointments.sql.
-- This file does NOT modify existing tables; it only adds new ones.
--
-- V1 design note:
--   The engine reads working hours from the existing `availability` table
--   (customer_id → day_of_week → start_time/end_time) and busy periods from
--   `appointments` (customer_id → scheduled_at + duration_minutes).
--   New tables (resource_working_hours, availability_exceptions, availability_blocks)
--   are created empty and extend the engine in future versions.
-- =============================================================================


-- =============================================================================
-- TABLE: resource_working_hours
-- Extended working-hours config with timezone, buffers, and resource/service FKs.
-- V1 fallback: when empty for a customer, the engine uses `availability` instead.
-- =============================================================================

create table if not exists public.resource_working_hours (
  id                    uuid        primary key default gen_random_uuid(),
  tenant_id             uuid        not null,
  resource_id           uuid        null,      -- optional future resource concept
  service_id            uuid        null,      -- optional service concept
  customer_id           uuid        null,      -- primary V1 anchor
  day_of_week           smallint    not null,  -- 0 = Sunday … 6 = Saturday
  start_time            time        not null,  -- local time in `timezone`
  end_time              time        not null,  -- local time in `timezone`
  timezone              text        not null   default 'Europe/Berlin',
  slot_granularity_min  integer     null,      -- override global granularity
  buffer_before_min     integer     not null   default 0,
  buffer_after_min      integer     not null   default 0,
  min_notice_min        integer     not null   default 0,
  booking_horizon_days  integer     null,
  capacity              integer     not null   default 1,
  status                text        not null   default 'active',
  valid_from            date        null,
  valid_to              date        null,
  created_at            timestamptz not null   default now(),
  updated_at            timestamptz not null   default now()
);

alter table public.resource_working_hours
  drop constraint if exists chk_rwh_day_of_week;
alter table public.resource_working_hours
  add  constraint chk_rwh_day_of_week
  check (day_of_week between 0 and 6);

alter table public.resource_working_hours
  drop constraint if exists chk_rwh_status;
alter table public.resource_working_hours
  add  constraint chk_rwh_status
  check (status in ('active', 'inactive'));

alter table public.resource_working_hours
  drop constraint if exists chk_rwh_capacity;
alter table public.resource_working_hours
  add  constraint chk_rwh_capacity
  check (capacity >= 1);

alter table public.resource_working_hours
  drop constraint if exists chk_rwh_times;
alter table public.resource_working_hours
  add  constraint chk_rwh_times
  check (start_time < end_time);

create index if not exists idx_rwh_tenant_id    on public.resource_working_hours (tenant_id);
create index if not exists idx_rwh_customer_id  on public.resource_working_hours (tenant_id, customer_id);
create index if not exists idx_rwh_resource_id  on public.resource_working_hours (tenant_id, resource_id);
create index if not exists idx_rwh_day          on public.resource_working_hours (tenant_id, day_of_week);

create or replace function public.set_rwh_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_rwh_updated_at on public.resource_working_hours;
create trigger trg_rwh_updated_at
  before update on public.resource_working_hours
  for each row execute function public.set_rwh_updated_at();

alter table public.resource_working_hours enable row level security;
alter table public.resource_working_hours force row level security;

drop policy if exists rwh_tenant_isolation on public.resource_working_hours;
create policy rwh_tenant_isolation on public.resource_working_hours
  using      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- =============================================================================
-- TABLE: availability_exceptions
-- Day-level or partial-time exceptions that override working hours.
-- is_closed = TRUE  → entire day unavailable.
-- is_closed = FALSE + start_time/end_time → partial window blocked.
-- =============================================================================

create table if not exists public.availability_exceptions (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null,
  resource_id    uuid        null,
  service_id     uuid        null,
  customer_id    uuid        null,
  date           date        not null,
  start_time     text        null,  -- HH:MM, null when is_closed = TRUE
  end_time       text        null,  -- HH:MM, null when is_closed = TRUE
  exception_type text        not null default 'closure',
  reason         text        null,
  is_closed      boolean     not null default false,
  priority       integer     not null default 100,
  status         text        not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.availability_exceptions
  drop constraint if exists chk_avex_status;
alter table public.availability_exceptions
  add  constraint chk_avex_status
  check (status in ('active', 'inactive'));

alter table public.availability_exceptions
  drop constraint if exists chk_avex_exception_type;
alter table public.availability_exceptions
  add  constraint chk_avex_exception_type
  check (exception_type in ('closure', 'holiday', 'maintenance', 'custom'));

alter table public.availability_exceptions
  drop constraint if exists chk_avex_times;
alter table public.availability_exceptions
  add  constraint chk_avex_times
  check (
    is_closed = true
    or (start_time is not null and end_time is not null)
  );

create index if not exists idx_avex_tenant_id   on public.availability_exceptions (tenant_id);
create index if not exists idx_avex_customer_id on public.availability_exceptions (tenant_id, customer_id);
create index if not exists idx_avex_date        on public.availability_exceptions (tenant_id, date);

create or replace function public.set_avex_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_avex_updated_at on public.availability_exceptions;
create trigger trg_avex_updated_at
  before update on public.availability_exceptions
  for each row execute function public.set_avex_updated_at();

alter table public.availability_exceptions enable row level security;
alter table public.availability_exceptions force row level security;

drop policy if exists avex_tenant_isolation on public.availability_exceptions;
create policy avex_tenant_isolation on public.availability_exceptions
  using      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- =============================================================================
-- TABLE: availability_blocks
-- Manual time-range blocks (absolute TIMESTAMPTZ windows).
-- Unlike exceptions (which are day/time-of-day based), blocks are point-in-time.
-- =============================================================================

create table if not exists public.availability_blocks (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  resource_id uuid        null,
  service_id  uuid        null,
  customer_id uuid        null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  block_type  text        not null default 'manual',
  source      text        not null default 'manual',
  reason      text        null,
  status      text        not null default 'active',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.availability_blocks
  drop constraint if exists chk_avbl_times;
alter table public.availability_blocks
  add  constraint chk_avbl_times
  check (start_at < end_at);

alter table public.availability_blocks
  drop constraint if exists chk_avbl_status;
alter table public.availability_blocks
  add  constraint chk_avbl_status
  check (status in ('active', 'inactive'));

alter table public.availability_blocks
  drop constraint if exists chk_avbl_block_type;
alter table public.availability_blocks
  add  constraint chk_avbl_block_type
  check (block_type in ('manual', 'buffer', 'external', 'system'));

create index if not exists idx_avbl_tenant_id   on public.availability_blocks (tenant_id);
create index if not exists idx_avbl_customer_id on public.availability_blocks (tenant_id, customer_id);
create index if not exists idx_avbl_start_at    on public.availability_blocks (tenant_id, start_at);
create index if not exists idx_avbl_range       on public.availability_blocks (tenant_id, start_at, end_at);

create or replace function public.set_avbl_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_avbl_updated_at on public.availability_blocks;
create trigger trg_avbl_updated_at
  before update on public.availability_blocks
  for each row execute function public.set_avbl_updated_at();

alter table public.availability_blocks enable row level security;
alter table public.availability_blocks force row level security;

drop policy if exists avbl_tenant_isolation on public.availability_blocks;
create policy avbl_tenant_isolation on public.availability_blocks
  using      (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);


-- =============================================================================
-- GRANTS
-- =============================================================================
grant select, insert, update, delete
  on public.resource_working_hours    to authenticated, service_role;
grant select, insert, update, delete
  on public.availability_exceptions   to authenticated, service_role;
grant select, insert, update, delete
  on public.availability_blocks       to authenticated, service_role;


-- =============================================================================
-- RPC HELPERS — data retrieval for availability-engine
-- These are called by n8n Code nodes to fetch tenant-scoped data.
-- Calculation logic lives in the n8n Code nodes (JavaScript).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- RPC: ae_get_working_hours
-- Returns effective working hours for a customer on a given weekday.
-- Priority: resource_working_hours > availability (legacy).
-- When resource_working_hours is empty for this customer, falls back to availability.
-- -----------------------------------------------------------------------------
create or replace function public.ae_get_working_hours(
  p_tenant_id   uuid,
  p_customer_id uuid
)
returns table (
  day_of_week          smallint,
  start_time_text      text,   -- HH:MM
  end_time_text        text,   -- HH:MM
  timezone             text,
  buffer_before_min    integer,
  buffer_after_min     integer,
  source               text    -- 'resource_working_hours' | 'availability'
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  -- Try resource_working_hours first
  if exists (
    select 1 from public.resource_working_hours
    where tenant_id   = p_tenant_id
      and customer_id = p_customer_id
      and status      = 'active'
  ) then
    return query
      select
        rwh.day_of_week,
        to_char(rwh.start_time, 'HH24:MI') as start_time_text,
        to_char(rwh.end_time,   'HH24:MI') as end_time_text,
        rwh.timezone,
        rwh.buffer_before_min,
        rwh.buffer_after_min,
        'resource_working_hours'::text as source
      from public.resource_working_hours rwh
      where rwh.tenant_id   = p_tenant_id
        and rwh.customer_id = p_customer_id
        and rwh.status      = 'active'
        and (rwh.valid_from is null or rwh.valid_from <= current_date)
        and (rwh.valid_to   is null or rwh.valid_to   >= current_date)
      order by rwh.day_of_week, rwh.start_time;
  else
    -- Fallback to existing availability table
    return query
      select
        a.day_of_week::smallint,
        a.start_time  as start_time_text,
        a.end_time    as end_time_text,
        'Europe/Berlin'::text as timezone,
        0::integer    as buffer_before_min,
        0::integer    as buffer_after_min,
        'availability'::text as source
      from public.availability a
      where a.tenant_id   = p_tenant_id
        and a.customer_id = p_customer_id
        and a.status      = 'active'
      order by a.day_of_week, a.start_time;
  end if;
end;
$$;


-- -----------------------------------------------------------------------------
-- RPC: ae_get_busy_periods
-- Returns all busy time windows in a range: appointments + active blocks.
-- -----------------------------------------------------------------------------
create or replace function public.ae_get_busy_periods(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
)
returns table (
  start_at    timestamptz,
  end_at      timestamptz,
  source      text    -- 'appointment' | 'block'
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    -- Appointments (not cancelled/completed if engine treats completed as busy)
    select
      a.scheduled_at                                                  as start_at,
      a.scheduled_at + (a.duration_minutes || ' minutes')::interval  as end_at,
      'appointment'::text                                             as source
    from public.appointments a
    where a.tenant_id   = p_tenant_id
      and a.customer_id = p_customer_id
      and a.status      not in ('cancelled')
      and a.scheduled_at < p_to
      and a.scheduled_at + (a.duration_minutes || ' minutes')::interval > p_from

    union all

    -- Manual blocks
    select
      bl.start_at,
      bl.end_at,
      'block'::text as source
    from public.availability_blocks bl
    where bl.tenant_id   = p_tenant_id
      and bl.customer_id = p_customer_id
      and bl.status      = 'active'
      and bl.start_at    < p_to
      and bl.end_at      > p_from

    order by start_at;
end;
$$;


-- -----------------------------------------------------------------------------
-- RPC: ae_get_day_exceptions
-- Returns exceptions for a date range (sorted by date + priority).
-- -----------------------------------------------------------------------------
create or replace function public.ae_get_day_exceptions(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_from_date   date,
  p_to_date     date
)
returns table (
  date           date,
  is_closed      boolean,
  start_time_txt text,
  end_time_txt   text,
  priority       integer
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      ex.date,
      ex.is_closed,
      ex.start_time,
      ex.end_time,
      ex.priority
    from public.availability_exceptions ex
    where ex.tenant_id   = p_tenant_id
      and ex.customer_id = p_customer_id
      and ex.status      = 'active'
      and ex.date        between p_from_date and p_to_date
    order by ex.date, ex.priority desc, ex.is_closed desc;
end;
$$;


-- -----------------------------------------------------------------------------
-- GRANTS for RPC functions
-- -----------------------------------------------------------------------------
grant execute on function public.ae_get_working_hours    to authenticated, service_role;
grant execute on function public.ae_get_busy_periods     to authenticated, service_role;
grant execute on function public.ae_get_day_exceptions   to authenticated, service_role;
