-- DengTa home 0.9.0: private chat attachments.
-- Run once in Supabase SQL Editor. The service-role backend is the only reader.

alter table if exists public.messages
    add column if not exists tool_calls jsonb not null default '{}'::jsonb;

insert into storage.buckets (
    id,
    name,
    public,
    file_size_limit,
    allowed_mime_types
)
values (
    'chat-attachments',
    'chat-attachments',
    false,
    12582912,
    array[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'text/plain', 'text/markdown', 'application/json', 'text/json',
        'text/csv', 'application/csv', 'application/xml', 'text/xml',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a',
        'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/aac',
        'audio/flac', 'audio/3gpp', 'audio/amr'
    ]::text[]
)
on conflict (id) do update
set
    name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Intentionally no public storage policies: access goes through the backend's
-- controlled /attachments/:messageId/:attachmentId endpoint.
