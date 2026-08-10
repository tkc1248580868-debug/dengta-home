-- DengTa Home 2.0: tenant-private chat skin and composer hint state.
-- Additive and repeatable. Hint text is current-session UI state, not memory.

create table if not exists public.companion_chat_preferences (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    skin text not null default 'classic-glass'
        check (skin in ('classic-glass', 'taotao-cream')),
    ornament_activity text not null default 'natural'
        check (ornament_activity in ('quiet', 'natural', 'lively')),
    dynamic_composer_hint boolean not null default true,
    reduce_motion boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id)
);

create unique index if not exists conversations_tenant_id_uidx
    on public.conversations (user_id, companion_id, id);

create table if not exists public.conversation_composer_hints (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    conversation_id uuid not null,
    hint text not null default '' check (char_length(hint) between 0 and 22),
    mood_revision text not null default '' check (char_length(mood_revision) <= 160),
    generated_at timestamptz,
    daily_generation_date date,
    daily_generation_count integer not null default 0
        check (daily_generation_count between 0 and 12),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    foreign key (user_id, companion_id, conversation_id)
        references public.conversations(user_id, companion_id, id)
        on delete cascade,
    unique (user_id, companion_id, conversation_id)
);

create index if not exists conversation_composer_hints_recent_idx
    on public.conversation_composer_hints (user_id, companion_id, updated_at desc);

alter table public.companion_chat_preferences enable row level security;
alter table public.conversation_composer_hints enable row level security;

revoke all on table public.companion_chat_preferences from anon, authenticated;
revoke all on table public.conversation_composer_hints from anon, authenticated;
grant all on table public.companion_chat_preferences to service_role;
grant all on table public.conversation_composer_hints to service_role;

comment on table public.companion_chat_preferences is
    'Tenant-private chat skin controls. Does not contain prompt or message content.';
comment on table public.conversation_composer_hints is
    'One current composer hint per session; old hints are overwritten and never used as memory.';
