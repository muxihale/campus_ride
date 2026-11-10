// Подготовка через публичный HTTP API: права и бизнес-проверки не обходятся.
const base = process.env.DEMO_BASE_URL ?? "http://localhost:5173"
const date =
  process.env.DEMO_DATE ??
  new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
const calendar = new Date(`${date}T00:00:00Z`)
if (
  !Number.isFinite(calendar.getTime()) ||
  calendar.toISOString().slice(0, 10) !== date ||
  !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
  new Date(`${date}T08:30:00+05:00`).getTime() <= Date.now()
)
  throw new Error("DEMO_DATE должна быть будущей датой YYYY-MM-DD")
let cookie = ""
async function api(path, body) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(base).origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const session = response.headers.get("set-cookie")
  if (session) cookie = session.split(";")[0]
  const value = await response.json()
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${JSON.stringify(value)}`)
  return value
}
await api("auth/login", {
  email: "driver@campusride.test",
  password: "CampusRide-demo-2026",
})
try {
  const points = (await api("locations?pageSize=100")).items
  const origin = points.find(
    (point) => point.id === "29300000-0000-4000-8000-000000000006"
  )
  const destination = points.find(
    (point) => point.id === "29300000-0000-4000-8000-000000000001"
  )
  if (!origin || !destination)
    throw new Error(
      "Сначала выполните db:seed: нужны исходные точки Уралмаш и Мира, 19"
    )
  let vehicle = (await api("me/vehicles?pageSize=100")).items.find(
    (car) => car.passengerSeats >= 3
  )
  if (!vehicle)
    vehicle = await api("me/vehicles", {
      make: "Kia",
      model: "Rio",
      color: "Белый",
      registrationNumber: "А966ВС196",
      passengerSeats: 3,
    })
  for (const [scenario, time] of [
    ["Основная поездка", "08:30"],
    ["Отмена и возврат", "09:00"],
  ]) {
    const departureAt = `${date}T${time}:00+05:00`
    const target = new Date(departureAt).toISOString()
    const existing = (await api("me/rides?pageSize=100")).items
    let ride = existing.find(
      (item) =>
        ["PUBLISHED", "DRAFT"].includes(item.status) &&
        new Date(item.departureAt).toISOString() === target
    )
    if (!ride)
      ride = await api("rides", {
        vehicleId: vehicle.id,
        originId: origin.id,
        destinationId: destination.id,
        departureAt,
        seatsTotal: 3,
        priceKopecks: 15000,
        musicAllowed: true,
        luggageAllowed: true,
        smokingAllowed: false,
        conditions: "Встречаемся у выхода метро за 5 минут.",
      })
    if (ride.status === "DRAFT")
      ride = await api(`rides/${ride.id}/publish`, {})
    console.log(
      `${scenario}: ${date} ${time} Екатеринбург; ${base}/#/ride/${ride.id}`
    )
  }
} finally {
  await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { Origin: new URL(base).origin, Cookie: cookie },
  })
}
