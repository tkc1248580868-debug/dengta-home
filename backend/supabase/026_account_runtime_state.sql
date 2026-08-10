-- Account-scoped companion UI state and neutral defaults for new accounts.

create table if not exists public.companion_runtime_states (
    user_id uuid not null,
    companion_id uuid not null,
    status jsonb not null default '{}'::jsonb,
    interaction_stats jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, companion_id),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

alter table public.companion_runtime_states enable row level security;

revoke all on table public.companion_runtime_states
    from public, anon, authenticated;
grant all on table public.companion_runtime_states to service_role;

alter table public.settings alter column ai_name set default '伴侣';
alter table public.companions alter column name set default '我的伴侣';

comment on table public.companion_runtime_states is
    'Last companion status and interaction counters, isolated by authenticated account and companion.';

notify pgrst, 'reload schema';
