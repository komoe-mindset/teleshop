create table public.products (
 id uuid primary key default gen_random_uuid(),
 merchant_id uuid not null references auth.users(id) on delete cascade,
 name text not null check (char_length(trim(name)) between 1 and 120),
 description text not null default '' check (char_length(description) <= 2000),
 price_minor bigint not null check (price_minor between 0 and 1000000000),
 currency text not null check (currency ~ '^[A-Z]{3}$'),
 stock integer not null default 0 check (stock between 0 and 1000000),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create index products_merchant_idx on public.products(merchant_id);
alter table public.products enable row level security;
create policy "merchant owns products" on public.products for all to authenticated using (merchant_id = auth.uid()) with check (merchant_id = auth.uid());
create table public.bots (
 merchant_id uuid primary key references auth.users(id) on delete cascade,
 telegram_bot_id bigint not null unique,
 username text not null,
 created_at timestamptz not null default now()
);
alter table public.bots enable row level security;
create policy "merchant reads own bot" on public.bots for select to authenticated using (merchant_id = auth.uid());
-- No client policy: only the server-side service role can read or write secrets.
create table public.bot_secrets (
 merchant_id uuid primary key references public.bots(merchant_id) on delete cascade,
 token_ciphertext text not null,
 token_iv text not null,
 webhook_secret text not null
);
alter table public.bot_secrets enable row level security;
revoke all on public.bot_secrets from anon, authenticated;
