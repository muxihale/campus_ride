import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import {
  allPages,
  rideStatusNames,
  type Page,
  type Ride,
  type RideLocation,
  type RideVehicle,
} from "./ride-data"
import {
  ekaterinburgInput,
  ekaterinburgISO,
  kopecksToRubles,
  rublesToKopecks,
} from "./ride-form"

type Filters = {
  q: string
  status: string
  vehicleId: string
  originId: string
  destinationId: string
  maxPrice: string
  minSeats: string
  departureFrom: string
  departureTo: string
  sort: string
}
const empty: Filters = {
  q: "",
  status: "",
  vehicleId: "",
  originId: "",
  destinationId: "",
  maxPrice: "",
  minSeats: "",
  departureFrom: "",
  departureTo: "",
  sort: "departureAsc",
}
const inputClass =
  "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
const focusHeading = (element: HTMLHeadingElement | null) => {
  element?.focus()
}

export function RidesScreen({ onExpired }: { onExpired: () => void }) {
  const [draft, setDraft] = useState<Filters>(empty)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [command, setCommand] = useState<{
    kind: "publish" | "delete"
    ride: Ride
  } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [refs, setRefs] = useState<{
    revision: number
    locations: RideLocation[]
    vehicles: RideVehicle[]
    error?: string
  } | null>(null)
  const search = `${query}${query ? "&" : ""}page=${page}&pageSize=10`
  const hasFilters = [...new URLSearchParams(query).keys()].some(
    (field) => field !== "sort"
  )
  const key = `${search}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: Page<Ride>
    error?: string
  }>({ key: "" })
  const refsLoading = refs?.revision !== revision
  const loading = result.key !== key || refsLoading
  const data = loading ? undefined : result.data
  const loadError =
    (!refsLoading && refs?.error) ||
    (result.key === key ? result.error : undefined)
  const locations = refs?.locations ?? []
  const vehicles = refs?.vehicles ?? []
  const locationName = (id: string) =>
    locations.find((item) => item.id === id)?.name ?? "Точка недоступна"
  const routeName = (ride: Ride) =>
    `${locationName(ride.originId)} → ${locationName(ride.destinationId)}`

  useEffect(() => {
    let active = true
    Promise.all([
      allPages<RideLocation>("locations"),
      allPages<RideVehicle>("me/vehicles"),
    ])
      .then(([locations, vehicles]) => {
        if (active) setRefs({ revision, locations, vehicles })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setRefs({
            revision,
            locations: [],
            vehicles: [],
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить справочники",
          })
      })
    return () => {
      active = false
    }
  }, [revision, onExpired])

  useEffect(() => {
    let active = true
    apiRequest<Page<Ride>>(`me/rides?${search}`)
      .then((data) => {
        if (!active) return
        const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (data.page > lastPage) {
          setPage(lastPage)
          return
        }
        setResult({ key, data })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setResult({
            key,
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить поездки",
          })
      })
    return () => {
      active = false
    }
  }, [search, key, onExpired])

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      const params = new URLSearchParams()
      for (const field of [
        "q",
        "status",
        "vehicleId",
        "originId",
        "destinationId",
        "minSeats",
        "sort",
      ] as const)
        if (draft[field].trim()) params.set(field, draft[field].trim())
      if (draft.maxPrice.trim())
        params.set("maxPriceKopecks", String(rublesToKopecks(draft.maxPrice)))
      if (draft.departureFrom)
        params.set("departureFrom", ekaterinburgISO(draft.departureFrom))
      if (draft.departureTo)
        params.set("departureTo", ekaterinburgISO(draft.departureTo))
      if (
        draft.departureFrom &&
        draft.departureTo &&
        draft.departureFrom > draft.departureTo
      )
        throw new Error("Начало диапазона не может быть позже конца")
      setQuery(params.toString())
      setPage(1)
      setNotice("")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте фильтры")
    }
  }
  function reset() {
    setDraft(empty)
    setQuery("")
    setPage(1)
    setError("")
  }
  function open(kind: "publish" | "delete", ride: Ride) {
    setCommand({ kind, ride })
    setError("")
    setNotice("")
  }
  async function execute() {
    if (!command || pending) return
    setPending(true)
    setError("")
    try {
      await apiRequest(
        command.kind === "publish"
          ? `rides/${command.ride.id}/publish`
          : `rides/${command.ride.id}`,
        command.kind === "publish" ? "POST" : "DELETE",
        command.kind === "publish" ? {} : undefined
      )
      setNotice(
        command.kind === "publish"
          ? "Поездка опубликована."
          : "Черновик удалён."
      )
      setCommand(null)
      setRevision((value) => value + 1)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else {
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось выполнить действие"
        )
        setCommand(null)
        if (cause instanceof ApiError && [404, 409].includes(cause.status))
          setRevision((value) => value + 1)
      }
    } finally {
      setPending(false)
    }
  }
  function options() {
    return locations.map((item) => (
      <option key={item.id} value={item.id}>
        {item.name}
      </option>
    ))
  }

  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="rides-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="rides-title" className="text-2xl font-semibold">
            Мои поездки
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Черновики, опубликованные поездки и история. Время — по
            Екатеринбургу.
          </p>
        </div>
        <a
          href="#/rides/new"
          className="rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Создать поездку
        </a>
      </div>
      <form
        onSubmit={apply}
        aria-label="Поиск своих поездок"
        className="rounded-xl border p-4"
      >
        <fieldset
          disabled={refsLoading || pending || command !== null}
          className="space-y-4"
        >
          <label className="block text-sm font-medium">
            Поиск
            <input
              type="search"
              maxLength={100}
              value={draft.q}
              onChange={(event) =>
                setDraft({ ...draft, q: event.target.value })
              }
              placeholder="Район, адрес, автомобиль или условия"
              className={inputClass}
            />
          </label>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block min-w-0 text-sm font-medium">
              Статус
              <select
                className={inputClass}
                value={draft.status}
                onChange={(event) =>
                  setDraft({ ...draft, status: event.target.value })
                }
              >
                <option value="">Все статусы</option>
                {Object.entries(rideStatusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm font-medium">
              Автомобиль — фильтр
              <select
                className={inputClass}
                value={draft.vehicleId}
                onChange={(event) =>
                  setDraft({ ...draft, vehicleId: event.target.value })
                }
              >
                <option value="">Все автомобили</option>
                {vehicles.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.make} {item.model} · {item.registrationNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="block min-w-0 text-sm font-medium">
              Откуда — фильтр
              <select
                className={inputClass}
                value={draft.originId}
                onChange={(event) =>
                  setDraft({ ...draft, originId: event.target.value })
                }
              >
                <option value="">Любая точка</option>
                {options()}
              </select>
            </label>
            <label className="block min-w-0 text-sm font-medium">
              Куда — фильтр
              <select
                className={inputClass}
                value={draft.destinationId}
                onChange={(event) =>
                  setDraft({ ...draft, destinationId: event.target.value })
                }
              >
                <option value="">Любая точка</option>
                {options()}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Максимум за место, ₽
              <input
                inputMode="decimal"
                maxLength={16}
                value={draft.maxPrice}
                onChange={(event) =>
                  setDraft({ ...draft, maxPrice: event.target.value })
                }
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Минимум предложенных мест
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={draft.minSeats}
                onChange={(event) =>
                  setDraft({ ...draft, minSeats: event.target.value })
                }
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Отправление от — Екатеринбург
              <input
                type="datetime-local"
                value={draft.departureFrom}
                onChange={(event) =>
                  setDraft({ ...draft, departureFrom: event.target.value })
                }
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Отправление до — Екатеринбург
              <input
                type="datetime-local"
                value={draft.departureTo}
                onChange={(event) =>
                  setDraft({ ...draft, departureTo: event.target.value })
                }
                className={inputClass}
              />
            </label>
          </div>
          <label className="block text-sm font-medium">
            Сортировка
            <select
              value={draft.sort}
              onChange={(event) =>
                setDraft({ ...draft, sort: event.target.value })
              }
              className={inputClass}
            >
              <option value="departureAsc">Ближайшее отправление</option>
              <option value="departureDesc">Позднее отправление</option>
              <option value="createdDesc">Сначала новые</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Найти</Button>
            <Button type="button" variant="outline" onClick={reset}>
              Сбросить фильтры
            </Button>
          </div>
        </fieldset>
      </form>
      {command && (
        <section
          aria-labelledby="ride-command-title"
          className="space-y-4 rounded-xl border bg-muted/30 p-5"
        >
          <h2
            id="ride-command-title"
            tabIndex={-1}
            ref={focusHeading}
            className="text-lg font-semibold"
          >
            {command.kind === "publish"
              ? "Опубликовать поездку?"
              : "Удалить черновик?"}
          </h2>
          <p className="text-sm">
            {routeName(command.ride)} ·{" "}
            {ekaterinburgInput(command.ride.departureAt).replace("T", " ")}
          </p>
          <p className="text-sm text-muted-foreground">
            {command.kind === "publish"
              ? "После публикации редактирование и удаление черновика будут недоступны."
              : "Черновик будет удалён вместе с остановками."}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={pending} onClick={() => void execute()}>
              {pending
                ? "Подождите…"
                : command.kind === "publish"
                  ? "Подтвердить публикацию"
                  : "Удалить окончательно"}
            </Button>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setCommand(null)}
            >
              Отмена
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {loadError ? (
        <div>
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку
          </Button>
        </div>
      ) : loading ? (
        <p role="status" className="text-sm">
          Загружаем поездки…
        </p>
      ) : (
        data && (
          <>
            <p role="status" className="text-sm text-muted-foreground">
              Найдено поездок: {data.total}
            </p>
            {data.items.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6">
                <h2 className="text-lg font-semibold">
                  {hasFilters
                    ? "Нет поездок по этим условиям"
                    : "Пока нет поездок"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {hasFilters
                    ? "Измените поиск или сбросьте фильтры."
                    : "Создайте первый черновик, проверьте маршрут и опубликуйте поездку."}
                </p>
              </div>
            ) : (
              <ul className="space-y-4">
                {data.items.map((ride) => {
                  const car = vehicles.find(
                    (item) => item.id === ride.vehicleId
                  )
                  return (
                    <li
                      key={ride.id}
                      className="space-y-4 rounded-xl border p-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h2 className="min-w-0 text-lg font-semibold break-words">
                          {routeName(ride)}
                        </h2>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${ride.status === "PUBLISHED" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                        >
                          {rideStatusNames[ride.status] ?? ride.status}
                        </span>
                      </div>
                      <p className="text-sm">
                        {ekaterinburgInput(ride.departureAt).replace("T", " ")}{" "}
                        · Екатеринбург
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {car
                          ? `${car.make} ${car.model} · ${car.registrationNumber}`
                          : "Автомобиль недоступен"}
                      </p>
                      <p className="text-sm">
                        {kopecksToRubles(ride.priceKopecks).replace(".", ",")} ₽
                        за место · Предложено мест: {ride.seatsTotal}
                      </p>
                      <p className="text-sm whitespace-pre-wrap">
                        {ride.conditions}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ride.musicAllowed ? "Музыка разрешена" : "Без музыки"}{" "}
                        ·{" "}
                        {ride.luggageAllowed ? "Можно с багажом" : "Без багажа"}{" "}
                        ·{" "}
                        {ride.smokingAllowed
                          ? "Курение разрешено"
                          : "Без курения"}
                      </p>
                      {ride.stops.length > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Остановки:{" "}
                          {ride.stops
                            .map((stop) => locationName(stop.locationId))
                            .join(" → ")}
                        </p>
                      )}
                      {ride.status === "DRAFT" && (
                        <div className="flex flex-wrap items-center gap-3">
                          <a
                            href={`#/rides/${ride.id}/edit`}
                            className="text-sm font-medium underline underline-offset-4"
                          >
                            Редактировать черновик
                          </a>
                          <Button
                            disabled={pending || command !== null}
                            aria-label={`Опубликовать поездку ${routeName(ride)}`}
                            onClick={() => open("publish", ride)}
                          >
                            Опубликовать
                          </Button>
                          <Button
                            variant="outline"
                            disabled={pending || command !== null}
                            aria-label={`Удалить черновик ${routeName(ride)}`}
                            onClick={() => open("delete", ride)}
                          >
                            Удалить
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <nav
              aria-label="Страницы своих поездок"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={page <= 1 || pending}
                onClick={() => setPage((value) => value - 1)}
              >
                Назад
              </Button>
              <span className="text-sm text-muted-foreground">
                Страница {page} из {Math.max(1, Math.ceil(data.total / 10))}
              </span>
              <Button
                variant="outline"
                disabled={page * 10 >= data.total || pending}
                onClick={() => setPage((value) => value + 1)}
              >
                Далее
              </Button>
            </nav>
          </>
        )
      )}
    </section>
  )
}
