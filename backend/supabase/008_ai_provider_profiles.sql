create table if not exists public.ai_provider_profiles (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text not null unique,
    protocol text not null check (
        protocol in ('openai-chat', 'openai-responses', 'anthropic', 'gemini')
    ),
    base_url text not null,
    auth_type text not null default 'bearer' check (auth_type in ('bearer', 'none')),
    secret_ciphertext text,
    default_model text not null default '',
    enabled boolean not null default false,
    is_default boolean not null default false,
    priority integer not null default 100 check (priority between 1 and 9999),
    billing_url text not null default '',
    expires_at timestamptz,
    notes text not null default '',
    discovered_models jsonb not null default '[]'::jsonb,
    last_status text not null default 'untested',
    last_error text,
    last_checked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists ai_provider_profiles_single_default
    on public.ai_provider_profiles (is_default)
    where is_default = true;

create index if not exists ai_provider_profiles_enabled_priority
    on public.ai_provider_profiles (enabled, priority, created_at);

alter table public.ai_provider_profiles enable row level security;

revoke all on table public.ai_provider_profiles from anon, authenticated;
grant all on table public.ai_provider_profiles to service_role;

comment on table public.ai_provider_profiles is
    'Encrypted upstream AI API and gateway profiles managed only by the DengTa backend service role.';

comment on column public.ai_provider_profiles.secret_ciphertext is
    'AES-256-GCM ciphertext. Never return this column to the browser.';
