-- DengTa home：把最高优先级系统提示、普通补充提示和独立人设拆成三个字段。
-- 可重复执行；只新增空字段，不覆盖任何现有提示词或人设内容。

alter table if exists public.settings
    add column if not exists additional_prompt text not null default '';

comment on column public.settings.system_prompt is
    '最高优先级系统指令；由后端作为模型 system/instructions 层发送。';

comment on column public.settings.additional_prompt is
    '普通补充提示；独立保存，并在 system/instructions 层中置于最高优先级系统指令之后。';

comment on column public.settings.personality is
    '独立人设词；独立保存，并在 system/instructions 层发送，不作为用户消息。';
