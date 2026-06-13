-- Phase 3: ארגז הזיכרון (Memory Vault). Files attach to memory bubbles; OCR
-- and PDF extraction happen at upload time, and semantic search is enabled
-- via a pgvector RPC function on the existing memory_bubbles.embedding column.

-- 1. Private storage bucket. Files are owned via the `files.owner_id` row
--    (we use service-role to access them; the bucket itself is closed).
insert into storage.buckets (id, name, public, file_size_limit)
values ('memory-trunk', 'memory-trunk', false, 52428800) -- 50 MB hard cap per object
on conflict (id) do nothing;

-- 2. Link a file to the bubble that captured it. Multi-attach not modeled yet.
alter table memory_bubbles
  add column if not exists attached_file_id uuid references files(id) on delete set null;

create index if not exists memory_bubbles_file_idx
  on memory_bubbles (attached_file_id) where attached_file_id is not null;

-- 3. Semantic search RPC. Returns the nearest neighbors by cosine distance,
--    restricted to one owner. Threshold lets callers reject weak matches.
create or replace function match_bubbles(
  query_embedding vector(1536),
  owner uuid,
  match_count int default 10,
  similarity_threshold float default 0.0
) returns table (
  id uuid,
  type text,
  title text,
  content text,
  tags text[],
  attached_file_id uuid,
  similarity float
) language sql stable as $$
  select
    b.id,
    b.type,
    b.title,
    b.content,
    b.tags,
    b.attached_file_id,
    1 - (b.embedding <=> query_embedding) as similarity
  from memory_bubbles b
  where b.owner_id = owner
    and b.embedding is not null
    and 1 - (b.embedding <=> query_embedding) >= similarity_threshold
  order by b.embedding <=> query_embedding
  limit match_count;
$$;

-- 4. ANN index for fast similarity search. ivfflat with cosine is the default
--    for OpenAI-style embeddings. lists=100 is a reasonable single-user count;
--    rebuild later if the vault grows past ~10k rows per user.
create index if not exists memory_bubbles_embedding_idx
  on memory_bubbles using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);
