import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { preAppointmentInputValue, preAppointmentTimestamp } from '../src/lib/preAppointments.js'

const user = '11111111-1111-4111-8111-111111111111'
const pedro = '22222222-2222-4222-8222-222222222222'
const wesley = '33333333-3333-4333-8333-333333333333'

test('datetime input requires date AND time, uses Brasília and round-trips UTC timestamps', () => {
  assert.equal(preAppointmentTimestamp('2026-09-02'), null)
  assert.equal(preAppointmentTimestamp('2026-02-31T14:15'), null)
  assert.equal(preAppointmentTimestamp('2026-09-02T25:15'), null)
  assert.equal(preAppointmentTimestamp('2026-09-02T14:15'), '2026-09-02T14:15:00-03:00')
  assert.equal(preAppointmentInputValue('2026-09-02T17:15:00Z'), '2026-09-02T14:15')
  assert.equal(preAppointmentInputValue('2026-09-03T02:15:00Z'), '2026-09-02T23:15')
})

test('timed pre-appointments: combined chronological milestones and all chart granularities', async (t) => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth; create schema cron;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
      grant usage on schema auth to authenticated;
      create table public.sellers(id uuid primary key, name text, active boolean);
      create table public.orders(id text primary key, data timestamptz, seller_id uuid, cancelado boolean);
      insert into auth.users values ('${user}');
      insert into public.sellers values ('${pedro}', 'Pedro', true), ('${wesley}', 'Wesley', true);
      create function cron.schedule(text,text,text) returns bigint language sql as $$select 1::bigint$$;
    `)
    for (const filename of [
      '20260903200000_add_dashboard_seller_filter.sql',
      '20260903210000_add_seller_sales_comparison.sql',
      '20260913100000_create_pre_appointments.sql',
      '20260913110000_add_pre_appointment_times_and_milestones.sql',
    ]) {
      const sql = await readFile(
        new URL(`../supabase/migrations/${filename}`, import.meta.url),
        'utf8',
      )
      await db.exec(sql.replace('create extension if not exists pg_cron;', ''))
    }
    for (let index = 0; index < 12; index++) {
      const time = index < 4 ? `08:0${index}` : `09:0${index - 4}`
      await db.query('insert into public.orders values ($1,$2,$3,false)', [
        `order-${index}`,
        `2026-09-02T${time}:00-03:00`,
        pedro,
      ])
    }
    await db.exec(
      `insert into public.orders values ('canceled', '2026-09-02T10:00:00-03:00', '${pedro}', true)`,
    )
    await db.exec('set role authenticated')
    await db.query(
      'insert into public.pre_appointments(seller_id,appointment_at,quantity) values ($1,$2,3),($1,$3,25),($4,$5,10)',
      [
        pedro,
        '2026-09-02T08:15:00-03:00',
        '2026-09-02T09:15:00-03:00',
        wesley,
        '2026-09-02T11:30:00-03:00',
      ],
    )
    await db.exec('reset role')
    const timeline = async (start = '2026-09-02', end = start, seller = null, include = true) =>
      (
        await db.query('select * from public.get_orders_sales_timeline($1,$2,$3,$4)', [
          start,
          end,
          seller,
          include,
        ])
      ).rows
    const sellerTimeline = async (start, end, seller = null, include = true) =>
      (
        await db.query('select * from public.get_seller_sales_timeline($1,$2,$3,$4)', [
          start,
          end,
          seller,
          include,
        ])
      ).rows
    const total = (rows) => rows.reduce((sum, row) => sum + Number(row.sales), 0)

    await t.test('toggle off exactly preserves existing chart results', async () => {
      assert.deepEqual(
        await timeline('2026-09-02', '2026-09-02', null, false),
        (
          await db.query(
            "select * from public.get_orders_sales_timeline('2026-09-02','2026-09-02',null)",
          )
        ).rows,
      )
      assert.deepEqual(
        await sellerTimeline('2026-09-02', '2026-09-02', null, false),
        (
          await db.query(
            "select * from public.get_seller_sales_timeline('2026-09-02','2026-09-02',null)",
          )
        ).rows,
      )
      assert.equal(total(await timeline('2026-09-02', '2026-09-02', null, false)), 12)
    })
    await t.test('manual quantities appear in their actual hourly bucket', async () => {
      const rows = await timeline()
      assert.equal(total(rows), 50)
      assert.equal(Number(rows.find((row) => row.bucket_index === 8).sales), 7)
      assert.equal(Number(rows.find((row) => row.bucket_index === 9).sales), 33)
      assert.equal(Number(rows.find((row) => row.bucket_index === 11).sales), 10)
    })
    await t.test(
      'pre shifts milestones completed by real orders; batches can cross multiple thresholds',
      async () => {
        const milestones = (await timeline()).flatMap((row) => row.milestones)
        assert.deepEqual(
          milestones.map((marker) => marker.threshold),
          [10, 20, 30, 40, 50],
        )
        assert.deepEqual(
          milestones.map((marker) => preAppointmentInputValue(marker.reached_at)),
          [
            '2026-09-02T09:02',
            '2026-09-02T09:15',
            '2026-09-02T09:15',
            '2026-09-02T09:15',
            '2026-09-02T11:30',
          ],
        )
      },
    )
    await t.test(
      'seller filters scope both counts and milestones, including sellers without real orders',
      async () => {
        assert.equal(total(await timeline('2026-09-02', '2026-09-02', pedro)), 40)
        const wesleyRows = await timeline('2026-09-02', '2026-09-02', wesley)
        assert.equal(total(wesleyRows), 10)
        assert.deepEqual(
          wesleyRows.flatMap((row) => row.milestones).map((marker) => marker.threshold),
          [10],
        )
        const rows = await sellerTimeline('2026-09-02', '2026-09-02')
        assert.equal(total(rows), 50)
        assert.ok(rows.some((row) => row.seller_id === wesley && Number(row.sales) === 10))
      },
    )
    await t.test(
      'daily totals, weeks and calendar months preserve the combined totals',
      async () => {
        for (const [start, end, mode] of [
          ['2026-09-01', '2026-09-07', 'seller_days'],
          ['2026-08-30', '2026-09-10', 'seller_weeks'],
          ['2026-09-01', '2026-09-30', 'seller_months'],
        ]) {
          const rows = await sellerTimeline(start, end)
          assert.equal(total(rows), 50)
          assert.ok(rows.every((row) => row.comparison_mode === mode))
          assert.equal(total(await timeline(start, end)), 50)
        }
      },
    )
    await t.test(
      'Brasília midnight boundaries, daily resets and future hourly entries stay consistent',
      async () => {
        await db.query(
          'insert into public.pre_appointments(seller_id,appointment_at,quantity) values ($1,$2,10),($1,$3,10)',
          [pedro, '2026-09-03T02:59:00Z', '2026-09-03T03:00:00Z'],
        )
        assert.equal(total(await timeline()), 60)
        const day3 = await timeline('2026-09-03')
        assert.equal(total(day3), 10)
        assert.deepEqual(
          day3.flatMap((row) => row.milestones).map((marker) => marker.threshold),
          [10],
        )
        await db.query(
          'insert into public.pre_appointments(seller_id,appointment_at,quantity) values ($1,$2,20)',
          [pedro, '2030-01-02T14:15:00-03:00'],
        )
        const future = await timeline('2030-01-02')
        assert.equal(total(future), 20)
        assert.deepEqual(
          future.flatMap((row) => row.milestones).map((marker) => marker.threshold),
          [10, 20],
        )
        const { rows } = await db.query(
          "select public.get_pre_appointment_totals('2026-09-03','2026-09-03') as totals",
        )
        assert.equal(rows[0].totals[0].quantity, 10)
      },
    )
    await t.test(
      'editing retains expiration and expired batches no longer alter lines or markers',
      async () => {
        const { rows: before } = await db.query(
          'select id,expires_at from public.pre_appointments limit 1',
        )
        await db.query('update public.pre_appointments set appointment_at=$1 where id=$2', [
          '2026-09-02T08:16:00-03:00',
          before[0].id,
        ])
        const { rows: after } = await db.query(
          'select expires_at from public.pre_appointments where id=$1',
          [before[0].id],
        )
        assert.equal(Date.parse(after[0].expires_at), Date.parse(before[0].expires_at))
        await db.exec(
          "alter table public.pre_appointments disable trigger validate_pre_appointment; update public.pre_appointments set expires_at=now()-interval '1 second'; alter table public.pre_appointments enable trigger validate_pre_appointment;",
        )
        assert.deepEqual(await timeline(), await timeline('2026-09-02', '2026-09-02', null, false))
      },
    )
    await t.test('anonymous and direct private-source execution remain denied', async () => {
      await db.exec('set role anon')
      await assert.rejects(timeline(), /permission denied/)
      await db.exec('reset role; set role authenticated')
      await assert.rejects(
        db.query(
          "select * from public.dashboard_appointment_events('2026-09-02','2026-09-02',null,true)",
        ),
        /permission denied/,
      )
      await db.exec('reset role')
    })
  } finally {
    await db.close()
  }
})
