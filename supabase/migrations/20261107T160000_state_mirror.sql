-- حالة المكنة (الذاكرة الطويلة) ليها صف واحد في القاعدة — الجدول كان موجود في
-- القاعدة بس مافيش migration بتعمله: يعني أي حد يعمل مشروع جديد هيلاقي الكود
-- بيفتكر إن فيه تخزين ولاء مافيش. القاعدة دي idempotent ومقيسة 2026-11-07:
--   select count(*) from public.nova_memory  → 0 (المكنة ما كانتش موصولة)
-- الصلاحيات: anon/authenticated ما يشيلوش حاجة (RLS شغال وبلا سياسات)،
-- والكتابة لسيد service_role — وهي بتعدي من دالة ops-api اللي مفتاحها جوه
-- Supabase نفسها، فالمكنة والحزمة المنشورة ما يشيلوش سر خالص.
create table if not exists public.nova_memory (
  id          text primary key,
  doc         jsonb not null,
  updated_at  timestamptz not null default now()
);

comment on table public.nova_memory is
  'آخر نسخة معروفة من ذاكرة نوفا الطويلة (صف واحد: main). الملف على المكنة هو المسار السريع؛ ده النسخة اللي تعيش بعدها.';

alter table public.nova_memory enable row level security;
revoke all on public.nova_memory from anon, authenticated;
grant select, insert, update on public.nova_memory to service_role;
