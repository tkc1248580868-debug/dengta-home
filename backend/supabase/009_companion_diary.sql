-- DengTa home companion diary.
-- Safe to run repeatedly. Existing diary entries are preserved.

create table if not exists public.companion_diary_entries (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    content text not null,
    mood text not null default '',
    happened_on date,
    source_message_ids jsonb not null default '[]'::jsonb,
    source_window_start timestamptz not null,
    source_window_end timestamptz not null,
    created_at timestamptz not null default now()
);

create index if not exists companion_diary_source_window_idx
    on public.companion_diary_entries (source_window_end);

create index if not exists companion_diary_created_at_idx
    on public.companion_diary_entries (created_at desc);

alter table public.companion_diary_entries enable row level security;
