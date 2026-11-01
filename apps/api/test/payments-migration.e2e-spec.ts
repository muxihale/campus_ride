import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { config } from "dotenv"
import { Client } from "pg"
import { expect, it } from "vitest"
config({ path: [".env", "../../.env"], quiet: true })
it("миграция сохраняет прежние платежи, заполняет историю и поддерживает большие суммы", async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query("BEGIN")
    const schema = `payment_migration_${randomUUID().replaceAll("-", "")}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query("SELECT set_config('search_path', $1, true)", [schema])
    await client.query(
      await readFile(
        new URL(
          "../prisma/migrations/20261019000100_initial/migration.sql",
          import.meta.url
        ),
        "utf8"
      )
    )
    const [driver, passenger, vehicle, district, origin, destination] =
      Array.from({ length: 6 }, () => randomUUID())
    await client.query(
      "INSERT INTO \"User\" (\"id\",\"email\",\"fullName\",\"passwordHash\",\"updatedAt\") VALUES ($1,'driver@migration.test','Михаил Кузнецов','test',now()),($2,'passenger@migration.test','Анна Соколова','test',now())",
      [driver, passenger]
    )
    await client.query('INSERT INTO "DriverProfile" ("userId") VALUES ($1)', [
      driver,
    ])
    await client.query(
      'INSERT INTO "Vehicle" ("id","driverId","make","model","color","registrationNumber","passengerSeats") VALUES ($1,$2,\'Kia\',\'Rio\',\'Белый\',\'A123BC196\',8)',
      [vehicle, driver]
    )
    await client.query(
      'INSERT INTO "District" ("id","name") VALUES ($1,\'Уралмаш\')',
      [district]
    )
    await client.query(
      'INSERT INTO "Location" ("id","districtId","name","address") VALUES ($1,$3,\'Метро\',\'Космонавтов\'),($2,$3,\'УрФУ\',\'Мира, 19\')',
      [origin, destination, district]
    )
    const states = [
      "PENDING",
      "CONFIRMED",
      "COMPLETED",
      "REJECTED",
      "CANCELLED",
      "CANCELLED",
    ]
    const bookingIds: string[] = []
    for (const [index, status] of states.entries()) {
      const rideId = randomUUID(),
        bookingId = randomUUID()
      bookingIds.push(bookingId)
      await client.query(
        'INSERT INTO "Ride" ("id","driverId","vehicleId","originId","destinationId","departureAt","seatsTotal","priceKopecks","updatedAt") VALUES ($1,$2,$3,$4,$5,\'2099-11-09\',8,$6,now())',
        [
          rideId,
          driver,
          vehicle,
          origin,
          destination,
          index === 1 ? 2147483647 : 15015,
        ]
      )
      await client.query(
        'INSERT INTO "Booking" ("id","rideId","passengerId","requestKey","seats","unitPriceKopecks","status","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
        [
          bookingId,
          rideId,
          passenger,
          randomUUID(),
          index === 1 ? 8 : 2,
          index === 1 ? 2147483647 : 15015,
          status,
        ]
      )
      if (index === 4)
        await client.query(
          'INSERT INTO "BookingStatusEvent" ("id","bookingId","actorId","toStatus") VALUES ($1,$2,$3,\'CONFIRMED\')',
          [randomUUID(), bookingId, driver]
        )
    }
    const existingId = randomUUID()
    await client.query(
      'INSERT INTO "Payment" ("id","bookingId","amountKopecks","updatedAt") VALUES ($1,$2,30030,now())',
      [existingId, bookingIds[0]]
    )
    const sql = await readFile(
      new URL(
        "../prisma/migrations/20261101000100_demo_payments/migration.sql",
        import.meta.url
      ),
      "utf8"
    )
    await client.query(sql)
    const { rows } = await client.query('SELECT * FROM "Payment"')
    expect(rows).toHaveLength(6)
    expect(rows.find((row) => row.bookingId === bookingIds[0])).toMatchObject({
      id: existingId,
      amountKopecks: "30030",
      status: "PENDING",
      isDemo: true,
    })
    expect(rows.find((row) => row.bookingId === bookingIds[1])).toMatchObject({
      amountKopecks: "17179869176",
      status: "SUCCEEDED",
      paidAt: expect.any(Date),
    })
    expect(rows.find((row) => row.bookingId === bookingIds[2]).status).toBe(
      "SUCCEEDED"
    )
    expect(rows.find((row) => row.bookingId === bookingIds[3]).status).toBe(
      "CANCELLED"
    )
    expect(rows.find((row) => row.bookingId === bookingIds[4])).toMatchObject({
      status: "REFUNDED",
      paidAt: expect.any(Date),
      refundedAt: expect.any(Date),
    })
    expect(rows.find((row) => row.bookingId === bookingIds[5])).toMatchObject({
      status: "CANCELLED",
      paidAt: null,
      refundedAt: null,
    })
    // Повтор заполнения не создаёт новые платежи или уведомления.
    await client.query(sql)
    expect(
      (await client.query('SELECT count(*) FROM "Payment"')).rows[0].count
    ).toBe("6")
    expect(
      (await client.query('SELECT count(*) FROM "Notification"')).rows[0].count
    ).toBe("0")
  } finally {
    await client.query("ROLLBACK")
    await client.end()
  }
}, 15000)
