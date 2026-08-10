-- DengTa home：补齐 Moments 完整功能所需字段与索引。
-- 可重复执行，不会删除现有动态或评论。

alter table if exists public.moments
    add column if not exists context_note text;

alter table if exists public.moments
    add column if not exists image_description text;

alter table if exists public.moments
    add column if not exists images jsonb not null default '[]'::jsonb;

alter table if exists public.moments
    add column if not exists reply_due_at timestamptz not null default now();

alter table if exists public.moments
    add column if not exists reply_status text not null default 'pending';

alter table if exists public.moments
    add column if not exists liked boolean not null default false;

alter table if exists public.moments
    add column if not exists reply_content text;

alter table if exists public.moments
    add column if not exists replied_at timestamptz;

alter table if exists public.moments
    add column if not exists reply_seen_at timestamptz;

alter table if exists public.moments
    add column if not exists user_liked boolean not null default false;

alter table if exists public.moment_comments
    add column if not exists reply_due_at timestamptz;

alter table if exists public.moment_comments
    add column if not exists reply_status text not null default 'none';

alter table if exists public.moment_comments
    add column if not exists seen_at timestamptz;

create index if not exists moments_due_reply_idx
    on public.moments (reply_status, reply_due_at)
    where reply_status = 'pending';

create index if not exists moment_comments_due_reply_idx
    on public.moment_comments (reply_status, reply_due_at)
    where reply_status = 'pending';
