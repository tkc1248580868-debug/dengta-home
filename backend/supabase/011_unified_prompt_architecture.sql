-- DengTa home: unified prompt architecture.
-- Existing three-field prompts are copied into the unified field once.
-- Legacy fields remain unchanged for rollback, and an existing unified prompt
-- is never overwritten.

alter table if exists public.settings
    add column if not exists prompt_mode text not null default 'legacy'
        check (prompt_mode in ('legacy', 'unified'));

alter table if exists public.settings
    add column if not exists unified_system_prompt text not null default '';

alter table if exists public.settings
    add column if not exists intimate_expression_enabled boolean not null default false;

update public.settings
set
    unified_system_prompt = concat_ws(
        E'\n\n',
        case
            when coalesce(system_prompt, '') <> ''
            then '【原最高优先级系统提示词】' || E'\n' || system_prompt
        end,
        case
            when coalesce(additional_prompt, '') <> ''
            then '【原普通补充提示词】' || E'\n' || additional_prompt
        end,
        case
            when coalesce(personality, '') <> ''
            then '【原独立人设词】' || E'\n' || personality
        end
    ),
    prompt_mode = 'unified'
where
    coalesce(unified_system_prompt, '') = ''
    and (
        coalesce(system_prompt, '') <> ''
        or coalesce(additional_prompt, '') <> ''
        or coalesce(personality, '') <> ''
    );

comment on column public.settings.prompt_mode is
    'legacy is retained for rollback; unified uses unified_system_prompt when it is non-empty.';

comment on column public.settings.unified_system_prompt is
    'Unified main-chat system prompt. Migration 011 copies legacy fields here only when this field is empty.';

comment on column public.settings.intimate_expression_enabled is
    'Allows warmer in-character expression without changing safety, capability, or tool boundaries.';
