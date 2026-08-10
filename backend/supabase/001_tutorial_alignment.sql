-- DengTa home：把现有数据库补齐到教程第一篇 + 朋友圈篇需要的结构。
-- 此脚本可以重复运行，不会删除已有聊天数据。

alter table if exists public.messages
    add column if not exists visible boolean not null default true;

alter table if exists public.messages
    add column if not exists tool_calls jsonb not null default '{}'::jsonb;

alter table if exists public.settings
    add column if not exists compression_threshold integer not null default 12000;

alter table if exists public.settings
    alter column compression_threshold set default 12000;

update public.settings
set compression_threshold = 12000
where compression_threshold = 40;

alter table if exists public.settings
    add column if not exists compression_keep integer not null default 20;

alter table if exists public.settings
    add column if not exists timezone text not null default 'Asia/Shanghai';

alter table if exists public.settings
    add column if not exists push_enabled boolean not null default false;

alter table if exists public.settings
    add column if not exists max_push_per_day integer not null default 7;

do $$
begin
    if exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'memories'
          and column_name = 'conversation_id'
    ) then
        alter table public.memories alter column conversation_id drop not null;
    end if;
end $$;

create table if not exists public.moments (
    id uuid default gen_random_uuid() primary key,
    author text not null default 'user'
        check (author in ('user', 'assistant')),
    content text not null default '',
    context_note text,
    image_description text,
    images jsonb not null default '[]'::jsonb,
    reply_due_at timestamptz not null default now(),
    reply_status text not null default 'pending'
        check (reply_status in ('pending', 'done')),
    liked boolean not null default false,
    reply_content text,
    replied_at timestamptz,
    reply_seen_at timestamptz,
    user_liked boolean not null default false,
    created_at timestamptz not null default now()
);

create table if not exists public.moment_comments (
    id uuid default gen_random_uuid() primary key,
    moment_id uuid not null references public.moments(id) on delete cascade,
    author text not null check (author in ('user', 'assistant')),
    content text not null,
    reply_due_at timestamptz,
    reply_status text not null default 'none'
        check (reply_status in ('none', 'pending', 'done')),
    seen_at timestamptz,
    created_at timestamptz not null default now()
);

create index if not exists moments_created_at_idx
    on public.moments (created_at desc);

create index if not exists moments_pending_idx
    on public.moments (reply_status, reply_due_at);

create index if not exists moment_comments_moment_id_idx
    on public.moment_comments (moment_id, created_at);

alter table public.moments enable row level security;
alter table public.moment_comments enable row level security;

insert into storage.buckets (id, name, public)
values ('moments', 'moments', true)
on conflict (id) do update set public = excluded.public;
