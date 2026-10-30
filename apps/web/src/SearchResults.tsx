import { Button } from "@workspace/ui/components/button"
import type { Page } from "./ride-data"
import { ekaterinburgInput, kopecksToRubles } from "./ride-form"
import { readSearch } from "./search-form"
export type PublicRide = {
  id: string
  origin: { id: string; name: string; address: string }
  destination: { id: string; name: string; address: string }
  departureAt: string
  seatsTotal: number
  availableSeats: number
  priceKopecks: number
  conditions: string | null
  musicAllowed: boolean
  luggageAllowed: boolean
  smokingAllowed: boolean
  driver: { id: string; fullName: string }
  vehicle: { make: string; model: string; color: string }
}
export function SearchResults({
  data,
  query,
}: {
  data: Page<PublicRide>
  query: string
}) {
  const params = new URLSearchParams(query)
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
  function navigate(page: number, sort = params.get("sort") ?? "departureAsc") {
    const next = new URLSearchParams(query)
    next.set("page", String(page))
    next.set("sort", sort)
    window.location.assign(`#/search?${next}`)
  }
  return (
    <section aria-labelledby="results-title" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="results-title" className="text-xl font-semibold">
            Результаты поиска
          </h2>
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            Найдено поездок: {data.total}
          </p>
        </div>
        <label className="block text-sm font-medium">
          Сортировка результатов
          <select
            value={params.get("sort") ?? "departureAsc"}
            onChange={(event) => navigate(1, event.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
          >
            <option value="departureAsc">Ближайшее отправление</option>
            <option value="departureDesc">Позднее отправление</option>
            <option value="priceAsc">Сначала дешевле</option>
            <option value="priceDesc">Сначала дороже</option>
          </select>
        </label>
      </div>
      {data.total === 0 ? (
        <div className="rounded-xl border border-dashed p-6">
          <h3 className="text-lg font-semibold">Поездки не найдены</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Попробуйте другую дату, время или измените дополнительные условия.
          </p>
        </div>
      ) : data.items.length === 0 ? (
        <div className="rounded-xl border p-5">
          <p>На этой странице поездок нет.</p>
          <Button
            className="mt-3"
            variant="outline"
            onClick={() => navigate(1)}
          >
            К первой странице
          </Button>
        </div>
      ) : (
        <ul aria-label="Найденные поездки" className="space-y-4">
          {data.items.map((ride) => {
            const route = `${ride.origin.name} → ${ride.destination.name}`
            const time = ekaterinburgInput(ride.departureAt).replace("T", " ")
            return (
              <li key={ride.id}>
                <article
                  aria-label={`${route}, ${time}`}
                  className="space-y-4 rounded-xl border bg-background p-5 sm:p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="min-w-0 text-lg font-semibold break-words">
                      {route}
                    </h3>
                    <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-sm font-medium">
                      {ride.priceKopecks === 0
                        ? "Бесплатно"
                        : `${kopecksToRubles(ride.priceKopecks).replace(".", ",")} ₽ за место`}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{time} · Екатеринбург</p>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>Посадка: {ride.origin.address}</p>
                    <p>Высадка: {ride.destination.address}</p>
                  </div>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
                    <p>Водитель: {ride.driver.fullName}</p>
                    <p>
                      Свободных мест: <strong>{ride.availableSeats}</strong> из{" "}
                      {ride.seatsTotal}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {ride.vehicle.make} {ride.vehicle.model} ·{" "}
                    {ride.vehicle.color}
                  </p>
                  {ride.conditions && (
                    <p className="line-clamp-3 text-sm whitespace-pre-wrap">
                      {ride.conditions}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {ride.musicAllowed ? "Музыка разрешена" : "Без музыки"} ·{" "}
                    {ride.luggageAllowed ? "Можно с багажом" : "Без багажа"} ·{" "}
                    {ride.smokingAllowed ? "Курение разрешено" : "Без курения"}
                  </p>
                  <a
                    href={`#/ride/${ride.id}?search=${encodeURIComponent(query)}`}
                    aria-label={`Подробнее: ${route}, ${time}`}
                    className="inline-block text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Подробнее
                  </a>
                </article>
              </li>
            )
          })}
        </ul>
      )}
      <nav
        aria-label="Страницы результатов поиска"
        className="flex flex-wrap items-center gap-3"
      >
        <Button
          variant="outline"
          disabled={data.page <= 1}
          onClick={() => navigate(data.page - 1)}
        >
          Назад
        </Button>
        <span className="text-sm text-muted-foreground">
          Страница {data.page} · Всего страниц: {lastPage}
        </span>
        <Button
          variant="outline"
          disabled={data.page >= lastPage}
          onClick={() => navigate(data.page + 1)}
        >
          Далее
        </Button>
      </nav>
    </section>
  )
}
// Маршрут перехода готов; содержимое публичной карточки добавляется на этапе 30.6.
export function RideDetailsPending({ query }: { query: string }) {
  const search = new URLSearchParams(query).get("search") ?? ""
  const back =
    readSearch(search).error || !search
      ? "#/search"
      : `#/search?${new URLSearchParams(search)}`
  return (
    <section className="mx-auto max-w-3xl space-y-5 rounded-2xl border bg-card p-6 sm:p-8">
      <h1 className="text-2xl font-semibold">Карточка поездки</h1>
      <p className="text-muted-foreground">
        Подробная карточка будет доступна в следующем обновлении.
      </p>
      <a
        href={back}
        className="inline-block text-sm font-medium underline underline-offset-4"
      >
        Вернуться к результатам
      </a>
    </section>
  )
}
