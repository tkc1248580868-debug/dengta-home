-- DengTa home：影子推送所需字段与索引。
-- 可重复执行，不会删除或覆盖现有聊天数据。

alter table if exists public.messages
    add column if not exists tool_calls jsonb not null default '{}'::jsonb;

alter table if exists public.settings
    add column if not exists timezone text not null default 'Asia/Shanghai';

alter table if exists public.settings
    add column if not exists push_enabled boolean not null default false;

alter table if exists public.settings
    add column if not exists max_push_per_day integer not null default 7;

create index if not exists messages_shadow_push_lookup_idx
    on public.messages (conversation_id, created_at desc)
    where role = 'assistant'
      and tool_calls @> '{"is_push": true}'::jsonb;

create index if not exists messages_shadow_push_daily_idx
    on public.messages (created_at desc)
    where role = 'assistant'
      and tool_calls @> '{"is_push": true}'::jsonb;
