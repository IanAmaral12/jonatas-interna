import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const userId = '11111111-1111-4111-8111-111111111111'
const sellerId = '22222222-2222-4222-8222-222222222222'
const inactiveId = '33333333-3333-4333-8333-333333333333'

test('pre-appointment migration: CRUD, RLS, validation, expiration and aggregation', async (t) => {
  const db = new PGlite()
  try {
    // Minimal Supabase context. Only pg_cron's external scheduler is stubbed;
    // the exact migration's tables, triggers, grants, policies and RPC run in Postgres.
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema cron;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql as
        $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.sellers (id uuid primary key, name text, active boolean);
      alter table public.sellers enable row level security;
      revoke all on public.sellers from public, anon, authenticated;
      insert into auth.users values ('${userId}');
      insert into public.sellers values ('${sellerId}', 'Pedro', true), ('${inactiveId}', 'Inativo', false);
      select set_config('request.jwt.claim.sub', '${userId}', false);
      create table cron.job (name text, schedule text, command text);
      create function cron.schedule(text, text, text) returns bigint language plpgsql as
        $$begin insert into cron.job values ($1, $2, $3); return 1; end$$;
    `)
    const migration = await readFile(
      new URL('../supabase/migrations/20260913100000_create_pre_appointments.sql', import.meta.url),
      'utf8',
    )
    await db.exec(migration.replace('create extension if not exists pg_cron;', ''))
    const asRole = async (role, action) => {
      await db.exec(`set role ${role}`)
      try {
        return await action()
      } finally {
        await db.exec('reset role')
      }
    }
    let id
    let expiresAt

    await t.test(
      'authenticated user creates a record using active seller without access to sellers table',
      async () => {
        const { rows } = await asRole('authenticated', () =>
          db.query(
            'insert into public.pre_appointments (seller_id, appointment_date, quantity) values ($1, $2, $3) returning *',
            [sellerId, '2026-09-13', 10],
          ),
        )
        id = rows[0].id
        expiresAt = rows[0].expires_at
        assert.equal(rows[0].created_by, userId)
        assert.equal(Date.parse(expiresAt) - Date.parse(rows[0].created_at), 15 * 86400000)
      },
    )

    await t.test(
      'invalid quantities, inactive sellers and forged system columns are rejected',
      async () => {
        for (const quantity of [0, -1, 1000001]) {
          await assert.rejects(
            asRole('authenticated', () =>
              db.query(
                'insert into public.pre_appointments (seller_id, appointment_date, quantity) values ($1, $2, $3)',
                [sellerId, '2026-09-13', quantity],
              ),
            ),
            /check constraint/,
          )
        }
        await assert.rejects(
          asRole('authenticated', () =>
            db.query(
              'insert into public.pre_appointments (seller_id, appointment_date, quantity) values ($1, $2, 1)',
              [inactiveId, '2026-09-13'],
            ),
          ),
          /vendedor ativo/,
        )
        await assert.rejects(
          asRole('authenticated', () =>
            db.query(
              "update public.pre_appointments set expires_at = now() + interval '30 days' where id = $1",
              [id],
            ),
          ),
          /permission denied/,
        )
      },
    )

    await t.test('editing quantity and date does not renew expiry', async () => {
      const { rows } = await asRole('authenticated', () =>
        db.query(
          'update public.pre_appointments set quantity = 12, appointment_date = $1 where id = $2 returning *',
          ['2026-09-12', id],
        ),
      )
      assert.equal(rows[0].quantity, 12)
      assert.equal(Date.parse(rows[0].expires_at), Date.parse(expiresAt))
    })

    await t.test(
      'aggregate sums multiple entries per seller/day and respects period boundaries',
      async () => {
        await asRole('authenticated', () =>
          db.query(
            'insert into public.pre_appointments (seller_id, appointment_date, quantity) values ($1, $2, 3), ($1, $3, 5)',
            [sellerId, '2026-09-12', '2026-09-13'],
          ),
        )
        const { rows } = await asRole('authenticated', () =>
          db.query('select public.get_pre_appointment_totals($1, $2) as totals', [
            '2026-09-12',
            '2026-09-12',
          ]),
        )
        assert.deepEqual(rows[0].totals, [
          {
            seller_id: sellerId,
            seller_name: 'Pedro',
            appointment_date: '2026-09-12',
            quantity: 15,
          },
        ])
      },
    )

    await t.test('anonymous access to table and totals is denied', async () => {
      await assert.rejects(
        asRole('anon', () => db.query('select * from public.pre_appointments')),
        /permission denied/,
      )
      await assert.rejects(
        asRole('anon', () =>
          db.query("select public.get_pre_appointment_totals('2026-09-12', '2026-09-13')"),
        ),
        /permission denied/,
      )
    })

    await t.test('expired data cannot be read, edited or counted before cleanup', async () => {
      await db.exec(`alter table public.pre_appointments disable trigger validate_pre_appointment;
        update public.pre_appointments set expires_at = now() - interval '1 second';
        alter table public.pre_appointments enable trigger validate_pre_appointment;`)
      const { rows } = await asRole('authenticated', () =>
        db.query('select * from public.pre_appointments'),
      )
      assert.equal(rows.length, 0)
      const updated = await asRole('authenticated', () =>
        db.query('update public.pre_appointments set quantity = 50 where id = $1 returning id', [
          id,
        ]),
      )
      assert.equal(updated.rows.length, 0)
      const totals = await asRole('authenticated', () =>
        db.query("select public.get_pre_appointment_totals('2026-09-01', '2026-09-30') as totals"),
      )
      assert.deepEqual(totals.rows[0].totals, [])
      const { rows: jobs } = await db.query('select * from cron.job')
      assert.equal(jobs[0].schedule, '0 * * * *')
      await db.exec(jobs[0].command)
      assert.equal((await db.query('select * from public.pre_appointments')).rows.length, 0)
    })

    await t.test('authenticated user can delete active records', async () => {
      const { rows } = await asRole('authenticated', () =>
        db.query(
          'insert into public.pre_appointments (seller_id, appointment_date, quantity) values ($1, $2, 1) returning id',
          [sellerId, '2026-09-13'],
        ),
      )
      await asRole('authenticated', () =>
        db.query('delete from public.pre_appointments where id = $1', [rows[0].id]),
      )
      assert.equal((await db.query('select * from public.pre_appointments')).rows.length, 0)
    })
  } finally {
    await db.close()
  }
})
