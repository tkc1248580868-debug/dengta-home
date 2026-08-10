-- DengTa home 0.15.0: allow validated chat video attachments in Storage.
-- The bucket remains private; this migration only extends its MIME allowlist.

update storage.buckets
set allowed_mime_types = (
    select array_agg(distinct mime_type order by mime_type)
    from unnest(
        coalesce(allowed_mime_types, array[]::text[]) ||
        array['video/mp4', 'video/webm', 'video/quicktime']::text[]
    ) as allowed(mime_type)
)
where id = 'chat-attachments';
