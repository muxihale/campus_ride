import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import {
  departureFromInput,
  ekaterinburgInput,
  kopecksToRubles,
  rublesToKopecks,
} from "./ride-form"

import {
  allPages,
  rideStatusNames,
  type RideLocation as Location,
  type RideVehicle as Vehicle,
  type Ride,
} from "./ride-data"
type Data = { locations: Location[]; vehicles: Vehicle[]; ride: Ride | null }
const inputClass =
  "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"

export function RideEditor({
  rideId,
  onExpired,
}: {
  rideId?: string
  onExpired: () => void
}) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([
      allPages<Location>("locations"),
      allPages<Vehicle>("me/vehicles"),
      rideId ? apiRequest<Ride>(`me/rides/${rideId}`) : Promise.resolve(null),
    ])
      .then(([locations, vehicles, ride]) => {
        if (active) setData({ locations, vehicles, ride })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить данные поездки"
          )
      })
    return () => {
      active = false
    }
  }, [rideId, retry, onExpired])
  const title = rideId ? "Редактировать черновик" : "Создать поездку"
  return (
    <section
      aria-labelledby="ride-title"
      className="min-w-0 rounded-2xl border bg-card p-5 sm:p-8"
    >
      <h1 id="ride-title" className="text-2xl font-semibold">
        {title}
      </h1>
      {error ? (
        <div>
          <p role="alert" className="mt-5 text-sm text-destructive">
            {error}
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setError("")
              setRetry((value) => value + 1)
            }}
          >
            Повторить загрузку
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className="mt-5 text-sm">
          Загружаем маршрут и автомобили…
        </p>
      ) : data.ride && data.ride.status !== "DRAFT" ? (
        <p role="alert" className="mt-5 text-sm">
          Редактировать можно только черновик. Текущий статус:{" "}
          {rideStatusNames[data.ride.status] ?? data.ride.status}.
        </p>
      ) : !data.vehicles.length ? (
        <div className="mt-5">
          <p>Сначала добавьте автомобиль.</p>
          <a
            href="#/vehicles"
            className="mt-4 inline-block underline underline-offset-4"
          >
            Открыть мои автомобили
          </a>
        </div>
      ) : data.locations.length < 2 ? (
        <p className="mt-5 text-sm">
          Справочник точек пока не готов. Попробуйте позже.
        </p>
      ) : (
        <RideForm data={data} onExpired={onExpired} />
      )}
    </section>
  )
}

function RideForm({ data, onExpired }: { data: Data; onExpired: () => void }) {
  const original = data.ride
  const [saved, setSaved] = useState<Ride | null>(null)
  const [vehicleId, setVehicleId] = useState(original?.vehicleId ?? "")
  const [originId, setOriginId] = useState(original?.originId ?? "")
  const [destinationId, setDestinationId] = useState(
    original?.destinationId ?? ""
  )
  const [departure, setDeparture] = useState(
    original ? ekaterinburgInput(original.departureAt) : ""
  )
  const [seats, setSeats] = useState(String(original?.seatsTotal ?? 1))
  const [price, setPrice] = useState(
    original ? kopecksToRubles(original.priceKopecks) : "0"
  )
  const [conditions, setConditions] = useState(original?.conditions ?? "")
  const [music, setMusic] = useState(original?.musicAllowed ?? true)
  const [luggage, setLuggage] = useState(original?.luggageAllowed ?? false)
  const [smoking, setSmoking] = useState(original?.smokingAllowed ?? false)
  const [stops, setStops] = useState(() =>
    (original?.stops ?? []).map((stop) => ({
      key: crypto.randomUUID(),
      locationId: stop.locationId,
    }))
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const capacity =
    data.vehicles.find((vehicle) => vehicle.id === vehicleId)?.passengerSeats ??
    8
  function options() {
    return data.locations.map((location) => (
      <option key={location.id} value={location.id}>
        {location.name} — {location.address}
      </option>
    ))
  }
  function move(index: number, offset: number) {
    setStops((current) => {
      const next = [...current]
      ;[next[index], next[index + offset]] = [
        next[index + offset]!,
        next[index]!,
      ]
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    let body
    try {
      const route = [
        originId,
        ...stops.map((stop) => stop.locationId),
        destinationId,
      ]
      if (route.some((id) => !id) || new Set(route).size !== route.length)
        throw new Error("Выберите разные точки маршрута без повторов")
      if (!conditions.trim())
        throw new Error("Уточните место встречи и условия поездки")
      if (
        !Number.isInteger(Number(seats)) ||
        Number(seats) < 1 ||
        Number(seats) > Math.min(8, capacity)
      )
        throw new Error(
          "Число мест должно быть в пределах вместимости автомобиля"
        )
      body = {
        vehicleId,
        originId,
        destinationId,
        departureAt: departureFromInput(departure),
        seatsTotal: Number(seats),
        priceKopecks: rublesToKopecks(price),
        conditions: conditions.trim(),
        musicAllowed: music,
        luggageAllowed: luggage,
        smokingAllowed: smoking,
        stops: stops.map(({ locationId }) => ({ locationId })),
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Проверьте поля поездки"
      )
      return
    }
    setPending(true)
    try {
      setSaved(
        await apiRequest<Ride>(
          original ? `rides/${original.id}` : "rides",
          original ? "PATCH" : "POST",
          body
        )
      )
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сохранить черновик"
        )
    } finally {
      setPending(false)
    }
  }

  if (saved)
    return (
      <div className="mt-6 space-y-4">
        <h2 className="text-xl font-semibold" role="status">
          Черновик сохранён
        </h2>
        <p className="text-sm text-muted-foreground">
          Поездка ещё не опубликована. Проверьте её в списке своих поездок перед
          публикацией.
        </p>
        <p className="text-sm">
          Отправление: {ekaterinburgInput(saved.departureAt).replace("T", " ")}{" "}
          · Екатеринбург
        </p>
        <p className="text-sm">
          Цена за место: {kopecksToRubles(saved.priceKopecks)} ₽
        </p>
        <p className="text-sm break-all text-muted-foreground">
          {
            data.locations.find((location) => location.id === saved.originId)
              ?.name
          }{" "}
          →{" "}
          {
            data.locations.find(
              (location) => location.id === saved.destinationId
            )?.name
          }{" "}
          · Мест: {saved.seatsTotal}
        </p>
        <a
          href="#/rides"
          className="mr-5 inline-block text-sm font-medium underline underline-offset-4"
        >
          Открыть мои поездки
        </a>
        {original ? (
          <Button onClick={() => setSaved(null)}>
            Продолжить редактирование
          </Button>
        ) : (
          <a
            className="inline-block underline underline-offset-4"
            href={`#/rides/${saved.id}/edit`}
          >
            Редактировать черновик
          </a>
        )}
      </div>
    )

  return (
    <form
      onSubmit={(event) => void submit(event)}
      aria-busy={pending}
      className="mt-6 space-y-6"
    >
      <p className="text-sm text-muted-foreground">
        Сохраните маршрут как черновик. Время указывается по Екатеринбургу
        (UTC+5).
      </p>
      <fieldset disabled={pending} className="space-y-6">
        <label className="block text-sm font-medium">
          Автомобиль
          <select
            className={inputClass}
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
            required
          >
            <option value="">Выберите автомобиль</option>
            {data.vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.make} {vehicle.model} · {vehicle.registrationNumber} ·{" "}
                {vehicle.passengerSeats} мест
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-5 lg:grid-cols-2">
          <label className="block min-w-0 text-sm font-medium">
            Откуда
            <select
              value={originId}
              onChange={(event) => setOriginId(event.target.value)}
              className={inputClass}
              required
            >
              <option value="">Выберите точку отправления</option>
              {options()}
            </select>
          </label>
          <label className="block min-w-0 text-sm font-medium">
            Куда
            <select
              value={destinationId}
              onChange={(event) => setDestinationId(event.target.value)}
              className={inputClass}
              required
            >
              <option value="">Выберите точку назначения</option>
              {options()}
            </select>
          </label>
        </div>
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Промежуточные остановки</h2>
          {stops.map((stop, index) => (
            <div key={stop.key} className="space-y-3 rounded-xl border p-4">
              <label className="block min-w-0 text-sm font-medium">
                Остановка {index + 1}
                <select
                  className={inputClass}
                  value={stop.locationId}
                  onChange={(event) =>
                    setStops((current) =>
                      current.map((item) =>
                        item.key === stop.key
                          ? { ...item, locationId: event.target.value }
                          : item
                      )
                    )
                  }
                  required
                >
                  <option value="">Выберите точку</option>
                  {options()}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === 0}
                  aria-label={`Поднять остановку ${index + 1}`}
                  onClick={() => move(index, -1)}
                >
                  Выше
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={index === stops.length - 1}
                  aria-label={`Опустить остановку ${index + 1}`}
                  onClick={() => move(index, 1)}
                >
                  Ниже
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Удалить остановку ${index + 1}`}
                  onClick={() =>
                    setStops((current) =>
                      current.filter((item) => item.key !== stop.key)
                    )
                  }
                >
                  Удалить
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={stops.length >= 10}
            onClick={() =>
              setStops((current) => [
                ...current,
                { key: crypto.randomUUID(), locationId: "" },
              ])
            }
          >
            Добавить остановку
          </Button>
          <p className="text-xs text-muted-foreground">
            До 10 точек в порядке посещения. Начало, конец и остановки не должны
            повторяться.
          </p>
        </div>
        <label className="block text-sm font-medium">
          Отправление — Екатеринбург
          <input
            type="datetime-local"
            value={departure}
            onChange={(event) => setDeparture(event.target.value)}
            className={inputClass}
            required
            aria-describedby="ride-time-hint"
          />
        </label>
        <p id="ride-time-hint" className="text-xs text-muted-foreground">
          Часовой пояс вашего устройства не меняет введённое время. Отправление
          должно быть в будущем.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Пассажирских мест
            <input
              type="number"
              min={1}
              max={Math.min(8, capacity)}
              step={1}
              value={seats}
              onChange={(event) => setSeats(event.target.value)}
              className={inputClass}
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Цена за место, ₽
            <input
              type="text"
              inputMode="decimal"
              maxLength={16}
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className={inputClass}
              required
              aria-describedby="ride-price-hint"
            />
          </label>
        </div>
        <p id="ride-price-hint" className="text-xs text-muted-foreground">
          0 — бесплатно. Не более двух знаков после запятой. В автомобиле
          доступно {capacity} пассажирских мест.
        </p>
        <div className="flex flex-wrap gap-5">
          {[
            { label: "Музыка разрешена", value: music, change: setMusic },
            { label: "Можно с багажом", value: luggage, change: setLuggage },
            { label: "Курение разрешено", value: smoking, change: setSmoking },
          ].map((item) => (
            <label key={item.label} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.value}
                onChange={(event) => item.change(event.target.checked)}
                className="size-5 rounded border accent-primary focus-visible:outline-2 focus-visible:outline-ring"
              />
              {item.label}
            </label>
          ))}
        </div>
        <label className="block text-sm font-medium">
          Место встречи и условия
          <textarea
            rows={4}
            maxLength={1000}
            required
            value={conditions}
            onChange={(event) => setConditions(event.target.value)}
            className={`${inputClass} h-auto py-3`}
            placeholder="Где именно встретиться, как узнать автомобиль, что взять с собой…"
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit">
            {pending ? "Сохраняем…" : "Сохранить черновик"}
          </Button>
          <a href="#/driver" className="text-sm underline underline-offset-4">
            Вернуться в кабинет
          </a>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}
