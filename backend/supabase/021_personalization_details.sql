alter table if exists public.settings
    add column if not exists user_details text not null default '';

comment on column public.settings.user_details is
    'User-edited persistent details. DengTa delivers this text verbatim in the same highest application-level instruction field as unified_system_prompt.';
