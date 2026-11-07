begin;

create table public.workspace_versions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0)
);

create table public.monthly_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date and month between date '1000-01-01' and date '9999-12-01'),
  hours integer not null check (hours between 0 and 1000000),
  rate integer not null check (rate between 0 and 1000000000),
  tax integer not null check (tax between 0 and 10000),
  accounting integer not null check (accounting between 0 and 1000000000),
  card integer not null check (card between 0 and 1000000000),
  zus integer not null check (zus between 0 and 1000000000),
  primary key (user_id, month)
);

create table public.setting_defaults (
  user_id uuid not null references auth.users(id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date and month between date '1000-01-01' and date '9999-12-01'),
  rate integer not null check (rate between 0 and 1000000000),
  tax integer not null check (tax between 0 and 10000),
  accounting integer not null check (accounting between 0 and 1000000000),
  card integer not null check (card between 0 and 1000000000),
  zus integer not null check (zus between 0 and 1000000000),
  primary key (user_id, month)
);

alter table public.workspace_versions enable row level security;
alter table public.monthly_records enable row level security;
alter table public.setting_defaults enable row level security;

create policy own_workspace on public.workspace_versions for select to authenticated using ((select auth.uid()) = user_id);
create policy own_months on public.monthly_records for select to authenticated using ((select auth.uid()) = user_id);
create policy own_defaults on public.setting_defaults for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.workspace_versions, public.monthly_records, public.setting_defaults from anon, authenticated;
grant select on public.workspace_versions, public.monthly_records, public.setting_defaults to authenticated;

create function public.load_workspace()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null then
    raise exception 'Sign in to access your records.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'revision', coalesce((select revision from public.workspace_versions where user_id = v_user), 0),
    'records', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(month, 'YYYY-MM'), 'hours', hours, 'rate', rate,
        'tax', tax, 'accounting', accounting, 'card', card, 'zus', zus
      ) order by month desc) from public.monthly_records where user_id = v_user
    ), '[]'::jsonb),
    'defaults', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', to_char(month, 'YYYY-MM'), 'rate', rate, 'tax', tax,
        'accounting', accounting, 'card', card, 'zus', zus
      ) order by month) from public.setting_defaults where user_id = v_user
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create function public.save_month(
  p_month date, p_hours integer, p_rate integer, p_tax integer,
  p_accounting integer, p_card integer, p_zus integer, p_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_revision integer;
  v_previous jsonb;
  v_settings jsonb := jsonb_build_array(p_rate, p_tax, p_accounting, p_card, p_zus);
begin
  if v_user is null then
    raise exception 'Sign in to save your records.' using errcode = '42501';
  end if;
  if p_revision is null or p_revision < 0 then
    raise exception 'Invalid workspace revision.' using errcode = '22023';
  end if;

  insert into public.workspace_versions (user_id) values (v_user) on conflict do nothing;
  select revision into v_revision from public.workspace_versions where user_id = v_user for update;
  if v_revision <> p_revision then
    raise exception 'Your records changed on another device. Refresh before saving again.' using errcode = '40001';
  end if;

  select jsonb_build_array(rate, tax, accounting, card, zus) into v_previous
    from public.monthly_records where user_id = v_user and month = p_month;
  if v_previous is null then
    select jsonb_build_array(rate, tax, accounting, card, zus) into v_previous
      from public.setting_defaults where user_id = v_user and month <= p_month order by month desc limit 1;
  end if;

  insert into public.monthly_records (user_id, month, hours, rate, tax, accounting, card, zus)
    values (v_user, p_month, p_hours, p_rate, p_tax, p_accounting, p_card, p_zus)
    on conflict (user_id, month) do update set
      hours = excluded.hours, rate = excluded.rate, tax = excluded.tax,
      accounting = excluded.accounting, card = excluded.card, zus = excluded.zus;

  if v_previous is distinct from v_settings then
    insert into public.setting_defaults (user_id, month, rate, tax, accounting, card, zus)
      values (v_user, p_month, p_rate, p_tax, p_accounting, p_card, p_zus)
      on conflict (user_id, month) do update set
        rate = excluded.rate, tax = excluded.tax, accounting = excluded.accounting,
        card = excluded.card, zus = excluded.zus;
  end if;

  update public.workspace_versions set revision = revision + 1 where user_id = v_user;
  return public.load_workspace();
end;
$$;

revoke all on function public.load_workspace() from public, anon;
revoke all on function public.save_month(date, integer, integer, integer, integer, integer, integer, integer) from public, anon;
grant execute on function public.load_workspace() to authenticated;
grant execute on function public.save_month(date, integer, integer, integer, integer, integer, integer, integer) to authenticated;

commit;
