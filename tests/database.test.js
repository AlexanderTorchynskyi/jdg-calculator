import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { selectMonth } from '../src/workspace.js';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const migration = await readFile(new URL('../supabase/migrations/001_monthline.sql', import.meta.url), 'utf8');

test('PostgreSQL schema: persistence, effective settings, RLS, atomic validation and stale saves', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${userA}'), ('${userB}');
  `);
  await db.exec(migration);
  const asUser = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    await db.exec('set role authenticated');
  };
  const load = async () => (await db.query('select public.load_workspace() as data')).rows[0].data;
  const save = async (month, revision, overrides = {}) => {
    const v = { hours: 16000, rate: 10000, tax: 1050, accounting: 29900, card: 900, zus: 261900, ...overrides };
    return (await db.query('select public.save_month($1::date,$2::integer,$3::integer,$4::integer,$5::integer,$6::integer,$7::integer,$8::integer) as data',
      [`${month}-01`, v.hours, v.rate, v.tax, v.accounting, v.card, v.zus, revision])).rows[0].data;
  };

  await asUser(userA);
  assert.deepEqual(await load(), { revision: 0, records: [], defaults: [] });
  let state = await save('2026-01', 0);
  assert.equal(state.revision, 1);
  assert.equal(state.defaults.length, 1);
  state = await save('2026-03', 1);
  assert.equal(state.defaults.length, 1, 'hours-only/new snapshot with same settings does not add defaults');
  state = await save('2026-03', 2, { hours: 15000 });
  assert.equal(state.defaults.length, 1);
  state = await save('2026-02', 3, { rate: 20000, zus: 300000 });
  assert.equal(state.defaults.length, 2);
  assert.equal(selectMonth(state, '2026-03').values.rate, '100.00', 'saved future snapshot is unchanged');
  assert.equal(selectMonth(state, '2026-04').values.rate, '200.00');
  state = await save('2026-05', 4, { rate: 25000, zus: 300000 });
  state = await save('2026-02', 5, { rate: 22000, zus: 310000 });
  assert.equal(selectMonth(state, '2026-04').values.rate, '220.00');
  assert.equal(selectMonth(state, '2026-06').values.rate, '250.00', 'later effective changes are preserved');

  await assert.rejects(save('2026-06', 5), /another device/);
  assert.deepEqual(await load(), state, 'stale save has no side effects');
  await assert.rejects(save('2026-06', 6, { tax: 10001 }), /check constraint/);
  assert.deepEqual(await load(), state, 'invalid save rolls back all writes');
  await assert.rejects(save('2026-06', 6, { rate: null }), /not-null constraint/);
  await assert.rejects(db.query('select public.save_month($1::date,0,0,0,0,0,0,6)', ['2026-06-02']), /check constraint/);
  await assert.rejects(db.exec("update public.monthly_records set hours=0"), /permission denied/);
  await assert.rejects(db.exec("insert into public.setting_defaults values ('11111111-1111-4111-8111-111111111111','2026-08-01',0,0,0,0,0)"), /permission denied/);

  await asUser(userB);
  assert.deepEqual(await load(), { revision: 0, records: [], defaults: [] });
  assert.equal((await db.query('select * from public.monthly_records')).rows.length, 0, 'RLS hides user A');
  assert.equal((await db.query('select * from public.setting_defaults')).rows.length, 0);
  assert.equal((await db.query('select * from public.workspace_versions')).rows.length, 0);
  const second = await save('2026-01', 0, { rate: 5000 });
  assert.equal(second.records.length, 1);
  await asUser(userA);
  assert.deepEqual(await load(), state, 'user B cannot change user A data');
  await asUser('');
  await assert.rejects(load(), /Sign in/);
  await assert.rejects(save('2026-01', 0), /Sign in/);
  await db.exec('reset role; set role anon');
  await assert.rejects(load(), /permission denied/);
  await assert.rejects(db.query('select * from public.monthly_records'), /permission denied/);
});
