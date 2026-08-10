-- DengTa Home 2.0: tenant-private companion creative studio.
--
-- This migration is additive and repeatable. It keeps image credentials,
-- artwork metadata, generation attempts, and surprise state separate from the
-- chat provider and ordinary chat history.

create table if not exists public.companion_creative_settings (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    generation_mode text not null default 'confirm'
        check (generation_mode in ('confirm', 'autonomous', 'off')),
    daily_call_limit integer
        check (daily_call_limit is null or daily_call_limit between 1 and 1000),
    monthly_call_limit integer
        check (monthly_call_limit is null or monthly_call_limit between 1 and 10000),
    surprise_enabled boolean not null default false,
    max_surprise_days integer not null default 30
        check (max_surprise_days between 1 and 365),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id)
);

create table if not exists public.image_provider_profiles (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    name text not null default '我的图片接口'
        check (char_length(name) between 1 and 80),
    protocol text not null default 'openai-images'
        check (protocol = 'openai-images'),
    base_url text not null,
    auth_type text not null default 'bearer'
        check (auth_type in ('bearer', 'none')),
    secret_ciphertext text,
    model text not null default '',
    enabled boolean not null default false,
    last_status text not null default 'untested'
        check (last_status in ('untested', 'configuration_ok', 'connected', 'error')),
    last_error_code text,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (user_id, companion_id)
);

create table if not exists public.companion_artworks (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    source_job_id uuid references public.background_jobs(id) on delete set null,
    provider_profile_id uuid references public.image_provider_profiles(id)
        on delete set null,
    kind text not null default 'doodle'
        check (kind in ('avatar', 'doodle', 'gift')),
    visibility text not null default 'ordinary'
        check (visibility in ('ordinary', 'surprise')),
    state text not null default 'idea'
        check (state in (
            'idea',
            'awaiting_confirmation',
            'generating',
            'ready',
            'ready_hidden',
            'revealed',
            'failed',
            'cancelled',
            'deleted'
        )),
    title text not null default '',
    description_ciphertext text,
    prompt_ciphertext text,
    generation_reason_ciphertext text,
    alt_text text not null default '',
    storage_bucket text,
    storage_path text,
    mime_type text,
    byte_size bigint not null default 0 check (byte_size >= 0),
    model text not null default '',
    actual_call_count integer not null default 0
        check (actual_call_count between 0 and 100),
    reveal_at timestamptz,
    revealed_at timestamptz,
    failure_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade
);

create unique index if not exists companion_artworks_source_job_uidx
    on public.companion_artworks (source_job_id)
    where source_job_id is not null;

create index if not exists companion_artworks_visible_recent_idx
    on public.companion_artworks (
        user_id,
        companion_id,
        created_at desc
    )
    where deleted_at is null;

create table if not exists public.image_generation_calls (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    artwork_id uuid not null references public.companion_artworks(id)
        on delete cascade,
    provider_profile_id uuid references public.image_provider_profiles(id)
        on delete set null,
    attempt integer not null check (attempt between 1 and 100),
    status text not null default 'started'
        check (status in ('started', 'succeeded', 'failed', 'cancelled')),
    model text not null default '',
    error_code text,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    unique (artwork_id, attempt)
);

create index if not exists image_generation_calls_tenant_time_idx
    on public.image_generation_calls (
        user_id,
        companion_id,
        started_at desc
    );

alter table public.background_jobs
    drop constraint if exists background_jobs_job_type_check;
alter table public.background_jobs
    add constraint background_jobs_job_type_check check (
        job_type in (
            'proactive_message',
            'moment_post',
            'moment_interaction',
            'diary_update',
            'profile_refresh',
            'creative_check',
            'surprise_reveal'
        )
    );

create unique index if not exists background_jobs_creative_pending_uidx
    on public.background_jobs (user_id, companion_id, job_type)
    where status = 'pending'
      and job_type = 'creative_check';

insert into storage.buckets (id, name, public, file_size_limit)
values (
    'companion-artworks',
    'companion-artworks',
    false,
    12582912
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

alter table public.companion_creative_settings enable row level security;
alter table public.image_provider_profiles enable row level security;
alter table public.companion_artworks enable row level security;
alter table public.image_generation_calls enable row level security;

revoke all on table public.companion_creative_settings
    from anon, authenticated;
revoke all on table public.image_provider_profiles
    from anon, authenticated;
revoke all on table public.companion_artworks
    from anon, authenticated;
revoke all on table public.image_generation_calls
    from anon, authenticated;

grant all on table public.companion_creative_settings to service_role;
grant all on table public.image_provider_profiles to service_role;
grant all on table public.companion_artworks to service_role;
grant all on table public.image_generation_calls to service_role;

comment on table public.image_provider_profiles is
    'Tenant-private OpenAI Images compatible provider settings. Credentials are encrypted and never returned to clients.';
comment on table public.companion_artworks is
    'Tenant-private companion avatars, doodles and gifts. Surprise rows remain hidden until reveal.';
comment on table public.image_generation_calls is
    'Technical call ledger without prompts, image content, or credentials.';
