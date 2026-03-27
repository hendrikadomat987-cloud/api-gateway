-- =============================================================================
-- notifications service — SQL migration
-- Apply to Supabase before importing n8n workflows or deploying the gateway.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TABLE
-- -----------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null,
  customer_id uuid        not null,
  channel     text        not null,
  type        text        not null,
  message     text,
  status      text        not null default 'pending',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Indexes
create index if not exists idx_notifications_tenant_id   on public.notifications (tenant_id);
create index if not exists idx_notifications_customer_id on public.notifications (tenant_id, customer_id);
create index if not exists idx_notifications_status      on public.notifications (tenant_id, status);

-- updated_at trigger
create or replace function public.set_notifications_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_notifications_updated_at on public.notifications;
create trigger trg_notifications_updated_at
  before update on public.notifications
  for each row execute function public.set_notifications_updated_at();

-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

drop policy if exists notifications_tenant_isolation on public.notifications;

create policy notifications_tenant_isolation on public.notifications
  using (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  with check (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- -----------------------------------------------------------------------------
-- RPC: notification_create
-- -----------------------------------------------------------------------------
create or replace function public.notification_create(
  p_tenant_id   uuid,
  p_customer_id uuid,
  p_channel     text,
  p_type        text,
  p_message     text    default null,
  p_status      text    default 'pending'
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  channel text, type text, message text,
  status text, created_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_channels text[] := array['email','sms','push'];
  valid_types    text[] := array['reminder','confirmation','cancellation','update'];
  valid_statuses text[] := array['pending','sent','failed'];
begin
  if not (p_channel = any(valid_channels)) then
    raise exception 'INVALID_CHANNEL: channel must be one of email, sms, push';
  end if;

  if not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of reminder, confirmation, cancellation, update';
  end if;

  if not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of pending, sent, failed';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    insert into public.notifications (tenant_id, customer_id, channel, type, message, status)
    values (p_tenant_id, p_customer_id, p_channel, p_type, p_message, p_status)
    returning
      public.notifications.id,
      public.notifications.tenant_id,
      public.notifications.customer_id,
      public.notifications.channel,
      public.notifications.type,
      public.notifications.message,
      public.notifications.status,
      public.notifications.created_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: notification_list
-- -----------------------------------------------------------------------------
create or replace function public.notification_list(
  p_tenant_id uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  channel text, type text, message text,
  status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      n.id, n.tenant_id, n.customer_id,
      n.channel, n.type, n.message,
      n.status, n.created_at, n.updated_at
    from public.notifications n
    where n.tenant_id = p_tenant_id
    order by n.created_at desc;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: notification_get_by_id
-- -----------------------------------------------------------------------------
create or replace function public.notification_get_by_id(
  p_tenant_id uuid,
  p_id        uuid
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  channel text, type text, message text,
  status text, created_at timestamptz, updated_at timestamptz
)
language plpgsql security definer as $$
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    select
      n.id, n.tenant_id, n.customer_id,
      n.channel, n.type, n.message,
      n.status, n.created_at, n.updated_at
    from public.notifications n
    where n.tenant_id = p_tenant_id
      and n.id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: notification_update
-- Partial update — only provided fields are changed (coalesce pattern).
-- -----------------------------------------------------------------------------
create or replace function public.notification_update(
  p_tenant_id uuid,
  p_id        uuid,
  p_channel   text default null,
  p_type      text default null,
  p_message   text default null,
  p_status    text default null
)
returns table (
  id uuid, tenant_id uuid, customer_id uuid,
  channel text, type text, message text,
  status text, updated_at timestamptz
)
language plpgsql security definer as $$
declare
  valid_channels text[] := array['email','sms','push'];
  valid_types    text[] := array['reminder','confirmation','cancellation','update'];
  valid_statuses text[] := array['pending','sent','failed'];
begin
  if p_channel is not null and not (p_channel = any(valid_channels)) then
    raise exception 'INVALID_CHANNEL: channel must be one of email, sms, push';
  end if;

  if p_type is not null and not (p_type = any(valid_types)) then
    raise exception 'INVALID_TYPE: type must be one of reminder, confirmation, cancellation, update';
  end if;

  if p_status is not null and not (p_status = any(valid_statuses)) then
    raise exception 'INVALID_STATUS: status must be one of pending, sent, failed';
  end if;

  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  return query
    update public.notifications as n
    set
      channel    = coalesce(p_channel, n.channel),
      type       = coalesce(p_type,    n.type),
      message    = coalesce(p_message, n.message),
      status     = coalesce(p_status,  n.status),
      updated_at = now()
    where n.id = p_id
      and n.tenant_id = p_tenant_id
    returning
      n.id,
      n.tenant_id,
      n.customer_id,
      n.channel,
      n.type,
      n.message,
      n.status,
      n.updated_at;
end;
$$;

-- -----------------------------------------------------------------------------
-- RPC: notification_delete
-- Idempotent: returns the requested id even when the row does not exist.
-- -----------------------------------------------------------------------------
create or replace function public.notification_delete(
  p_tenant_id uuid,
  p_id        uuid
)
returns uuid
language plpgsql security definer as $$
declare
  v_deleted_id uuid;
begin
  perform set_config('app.current_tenant_id', p_tenant_id::text, true);

  delete from public.notifications as n
  where n.id = p_id
    and n.tenant_id = p_tenant_id
  returning n.id into v_deleted_id;

  return coalesce(v_deleted_id, p_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
grant execute on function public.notification_create     to authenticated, service_role;
grant execute on function public.notification_list       to authenticated, service_role;
grant execute on function public.notification_get_by_id to authenticated, service_role;
grant execute on function public.notification_update     to authenticated, service_role;
grant execute on function public.notification_delete     to authenticated, service_role;
