import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { PublicRide } from "./SearchResults"
import { ekaterinburgInput, kopecksToRubles } from "./ride-form"
import { readSearch } from "./search-form"
export type PublicRideDetail = PublicRide & {
  status: "PUBLISHED"
  stops: { position: number; location: PublicRide["origin"] }[]
  driver: PublicRide["driver"] & {
    bio: string | null
    rating: number | null
    reviewCount: number
  }
  vehicle: PublicRide["vehicle"] & { passengerSeats: number }
}
export function searchBackLink(query: string) {
  const search = new URLSearchParams(query).get("search") ?? ""
  return !search || readSearch(search).error
    ? "#/search"
    : `#/search?${new URLSearchParams(search)}`
}
export function PublicRideScreen({ id, query }: { id: string; query: string }) {
  const [result, setResult] = useState<{
    ride?: PublicRideDetail
    error?: string
    unavailable?: boolean
  } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    apiRequest<PublicRideDetail>(`rides/${encodeURIComponent(id)}`)
      .then((ride) => {
        if (active) setResult({ ride })
      })
      .catch((cause: unknown) => {
        if (active)
          setResult(
            cause instanceof ApiError &&
              (cause.status === 404 || cause.status === 400)
              ? { unavailable: true }
              : {
                  error:
                    cause instanceof Error
                      ? cause.message
                      : "Не удалось загрузить поездку",
                }
          )
      })
    return () => {
      active = false
    }
  }, [id, retry])
  const ride = result?.ride
  return (
    <section
      aria-labelledby="ride-title"
      className="mx-auto max-w-4xl space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
    >
      <a
        href={searchBackLink(query)}
        className="inline-block text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
      >
        Вернуться к результатам
      </a>
      <h1 id="ride-title" className="text-2xl font-semibold sm:text-3xl">
        Карточка поездки
      </h1>
      {!result ? (
        <p role="status">Загружаем поездку…</p>
      ) : result.unavailable ? (
        <div role="status" className="space-y-2 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">Поездка недоступна</h2>
          <p className="text-muted-foreground">
            Поездка могла завершиться, быть отменена или заполнена. Вернитесь к
            поиску, чтобы выбрать другую.
          </p>
        </div>
      ) : result.error ? (
        <div className="space-y-3">
          <p role="alert">{result.error}</p>
          <Button
            variant="outline"
            onClick={() => {
              setResult(null)
              setRetry((value) => value + 1)
            }}
          >
            Повторить загрузку
          </Button>
        </div>
      ) : (
        ride && (
          <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <h2 className="min-w-0 text-xl font-semibold break-words">
                {ride.origin.name} → {ride.destination.name}
              </h2>
              <p className="rounded-full bg-primary/10 px-3 py-1 font-medium">
                {ride.priceKopecks === 0
                  ? "Бесплатно"
                  : `${kopecksToRubles(ride.priceKopecks).replace(".", ",")} ₽ за место`}
              </p>
            </div>
            <p className="font-medium">
              Отправление:{" "}
              {ekaterinburgInput(ride.departureAt).replace("T", " ")} ·
              Екатеринбург (UTC+5)
            </p>
            <p>
              Свободных мест: <strong>{ride.availableSeats}</strong> из{" "}
              {ride.seatsTotal}
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-3 rounded-xl border p-5">
                <h3 className="text-lg font-semibold">Маршрут</h3>
                <ol aria-label="Точки маршрута" className="space-y-4">
                  <li>
                    <p className="text-sm text-muted-foreground">Посадка</p>
                    <p className="font-medium">{ride.origin.name}</p>
                    <p className="text-sm break-words">{ride.origin.address}</p>
                  </li>
                  {[...ride.stops]
                    .sort((a, b) => a.position - b.position)
                    .map((stop) => (
                      <li key={stop.position}>
                        <p className="text-sm text-muted-foreground">
                          Промежуточная остановка
                        </p>
                        <p className="font-medium">{stop.location.name}</p>
                        <p className="text-sm break-words">
                          {stop.location.address}
                        </p>
                      </li>
                    ))}
                  <li>
                    <p className="text-sm text-muted-foreground">Высадка</p>
                    <p className="font-medium">{ride.destination.name}</p>
                    <p className="text-sm break-words">
                      {ride.destination.address}
                    </p>
                  </li>
                </ol>
                {ride.stops.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Без промежуточных остановок
                  </p>
                )}
              </section>
              <div className="space-y-6">
                <section className="space-y-2 rounded-xl border p-5">
                  <h3 className="text-lg font-semibold">Водитель</h3>
                  <p className="font-medium">{ride.driver.fullName}</p>
                  <p>
                    {ride.driver.rating === null
                      ? "Пока нет отзывов"
                      : `Рейтинг водителя: ${String(ride.driver.rating).replace(".", ",")} из 5 · Отзывов: ${ride.driver.reviewCount}`}
                  </p>
                  <p className="text-sm break-words whitespace-pre-wrap">
                    {ride.driver.bio || "Водитель пока не добавил описание."}
                  </p>
                </section>
                <section className="space-y-2 rounded-xl border p-5">
                  <h3 className="text-lg font-semibold">Автомобиль</h3>
                  <p>
                    {ride.vehicle.make} {ride.vehicle.model}
                  </p>
                  <p>Цвет: {ride.vehicle.color}</p>
                  <p>
                    Пассажирских мест в автомобиле:{" "}
                    {ride.vehicle.passengerSeats}
                  </p>
                </section>
              </div>
            </div>
            <section className="space-y-3 rounded-xl border p-5">
              <h3 className="text-lg font-semibold">Условия поездки</h3>
              <ul className="flex flex-wrap gap-2 text-sm">
                {[
                  ride.musicAllowed ? "Музыка разрешена" : "Без музыки",
                  ride.luggageAllowed ? "Можно с багажом" : "Без багажа",
                  ride.smokingAllowed ? "Курение разрешено" : "Без курения",
                ].map((text) => (
                  <li key={text} className="rounded-full bg-muted px-3 py-1">
                    {text}
                  </li>
                ))}
              </ul>
              <p className="break-words whitespace-pre-wrap">
                {ride.conditions || "Дополнительных условий нет."}
              </p>
            </section>
          </>
        )
      )}
    </section>
  )
}
