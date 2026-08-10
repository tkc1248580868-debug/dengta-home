-- Provider-neutral creative advice for companion artwork planning.

create table if not exists public.companion_creative_inspirations (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null,
    companion_id uuid not null,
    source text not null check (char_length(source) between 1 and 80),
    source_label text not null default ''
        check (char_length(source_label) <= 120),
    external_id text check (external_id is null or char_length(external_id) <= 240),
    title text not null check (char_length(title) between 1 and 240),
    summary text not null default '' check (char_length(summary) <= 4000),
    craft_notes text not null default '' check (char_length(craft_notes) <= 4000),
    tags text[] not null default '{}',
    source_url text check (source_url is null or char_length(source_url) <= 1200),
    published_at timestamptz,
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (user_id, companion_id)
        references public.companions(user_id, id) on delete cascade,
    check (summary <> '' or craft_notes <> '')
);

create unique index if not exists companion_creative_inspiration_external_uidx
    on public.companion_creative_inspirations (
        user_id,
        companion_id,
        source,
        external_id
    )
    where external_id is not null;

create index if not exists companion_creative_inspiration_recent_idx
    on public.companion_creative_inspirations (
        user_id,
        companion_id,
        enabled,
        updated_at desc
    );

alter table if exists public.companion_artworks
    add column if not exists inspiration_ids uuid[] not null default '{}';

alter table public.companion_creative_inspirations enable row level security;

revoke all on table public.companion_creative_inspirations
    from anon, authenticated;
grant all on table public.companion_creative_inspirations
    to service_role;

comment on table public.companion_creative_inspirations is
    'Tenant-scoped, provider-neutral creative advice summaries imported by current or future forum adapters.';
comment on column public.companion_artworks.inspiration_ids is
    'Creative inspiration entries selected by the companion while refining the image prompt.';

notify pgrst, 'reload schema';
