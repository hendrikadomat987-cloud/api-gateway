-- =============================================================================
-- appointments service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  customer_id      uuid not null,
  scheduled_at     timestamptz not null,
  duration_minutes integer not null default 60,
  status           text not null default 'scheduled',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Indexes
create index if not exists idx_appointments_tenant_id    on public.appointments (tenant_id);
create index if not exists idx_appointments_customer_id  on public.appointments (tenant_id, customer_id);
create index if not exists idx_appointments_scheduled_at on public.appointments (tenant_id, scheduled_at);
create index if not exists idx_appointments_status       on public.appointments (tenant_id, status);

-- updated_at trigger
create or replace function public.set_appointments_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_appointments_updated_at on public.appointments;
create trigger trg_appointments_updated_at
  before update on public.appointments
  for each row execute function public.set_appointments_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.appointments enable row level security;
alter table public.appointments force row level security;

drop policy if exists appointments_tenant_isolation on public.appointments;

create policy appointments_tenant_isolation on public.appointments
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: appointment_create
-- -----------------------------------------------------------------------------
create or replace function public.appointment_create(
  p_tenant_id        uuid,
  p_customer_id      uuid,
  p_scheduled_at     timestamptz,
  p_duration_minutes integer default 60,
  p_status           text default 'scheduled',
  p_notes            text default null
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  scheduled_at timestamptz, duration_minutes integer,
  status text, notes text, created_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_statuses text[] := array['scheduled','confirmed','cancelled','completed'];
begin
  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of scheduled, confirmed, cancelled, completed';
  end if;

  if p_duration_minutes < 1 or p_duration_minutes > 1440 then
    raise exception 'INVALID_DURATION: duration_minutes must be between 1 and 1440';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.appointments
      (tenant_id, customer_id, scheduled_at, duration_minutes, status, notes)
    values
      (p_tenant_id, p_customer_id, p_scheduled_at, p_duration_minutes, p_status, p_notes)
    returning
      public.appointments.id,
      public.appointments.tenant_id,
      public.appointments.customer_id,
      public.appointments.scheduled_at,
      public.appointments.duration_minutes,
      public.appointments.status,
      public.appointments.notes,
      public.appointments.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: appointment_list
-- -----------------------------------------------------------------------------
create or replace function public.appointment_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  scheduled_at timestamptz, duration_minutes integer,
  status text, notes text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      a.id, a.tenant_id, a.customer_id,
      a.scheduled_at, a.duration_minutes,
      a.status, a.notes,
      a.created_at, a.updated_at
    from public.appointments a
    where a.tenant_id = p_tenant_id
    order by a.scheduled_at asc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: appointment_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.appointment_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  scheduled_at timestamptz, duration_minutes integer,
  status text, notes text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      a.id, a.tenant_id, a.customer_id,
      a.scheduled_at, a.duration_minutes,
      a.status, a.notes,
      a.created_at, a.updated_at
    from public.appointments a
    where a.tenant_id = p_tenant_id
      and a.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: appointment_update
-- -----------------------------------------------------------------------------
create or replace function public.appointment_update(
  p_tenant_id        uuid,
  p_id               uuid,
  p_scheduled_at     timestamptz default null,
  p_duration_minutes integer default null,
  p_status           text default null,
  p_notes            text default null
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  scheduled_at timestamptz, duration_minutes integer,
  status text, notes text, updated_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_statuses text[] := array['scheduled','confirmed','cancelled','completed'];
begin
  if p_status is not null and not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of scheduled, confirmed, cancelled, completed';
  end if;

  if p_duration_minutes is not null and (p_duration_minutes < 1 or p_duration_minutes > 1440) then
    raise exception 'INVALID_DURATION: duration_minutes must be between 1 and 1440';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.appointments
    set
      scheduled_at     = coalesce(p_scheduled_at,     scheduled_at),
      duration_minutes = coalesce(p_duration_minutes, duration_minutes),
      status           = coalesce(p_status,           status),
      notes            = coalesce(p_notes,            notes),
      updated_at       = now()
    where id = p_id
      and tenant_id = p_tenant_id
    returning
      public.appointments.id,
      public.appointments.tenant_id,
      public.appointments.customer_id,
      public.appointments.scheduled_at,
      public.appointments.duration_minutes,
      public.appointments.status,
      public.appointments.notes,
      public.appointments.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: appointment_delete
-- Idempotent: returns id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.appointment_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.appointments
  where id = p_id
    and tenant_id = p_tenant_id
  returning id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants (adjust role names to match your Supabase setup)
-- -----------------------------------------------------------------------------
grant execute on function public.appointment_create      to authenticated, service_role;
grant execute on function public.appointment_list        to authenticated, service_role;
grant execute on function public.appointment_get_by_id  to authenticated, service_role;
grant execute on function public.appointment_update      to authenticated, service_role;
grant execute on function public.appointment_delete      to authenticated, service_role;
