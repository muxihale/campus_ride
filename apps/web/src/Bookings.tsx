import { BookingReview } from "./BookingReview"
import { PaymentInfo, type DemoPayment } from "./PaymentInfo"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { Page, RideLocation } from "./ride-data"
import { rideStatusNames } from "./ride-data"
import {
  ekaterinburgInput,
  ekaterinburgISO,
  kopecksToRubles,
  rublesToKopecks,
} from "./ride-form"
export const bookingStatusNames: Record<string, string> = {
  PENDING: "Ожидает подтверждения",
  CONFIRMED: "Подтверждена",
  REJECTED: "Отклонена",
  CANCELLED: "Отменена",
  COMPLETED: "Завершена",
}
export type OwnBooking = {
  id: string
  rideId: string
  status: string
  seats: number
  unitPriceKopecks: number
  cancellationReason: string | null
  payment?: DemoPayment | null
  createdAt: string
  passenger?: { id: string; fullName: string; affiliation: string | null }
  ride: {
    id: string
    availableSeats?: number
    status: string
    departureAt: string
    origin: RideLocation
    destination: RideLocation
    driver: { id: string; fullName: string }
    vehicle: { make: string; model: string; color: string }
  }
}
const empty = {
  q: "",
  period: "all",
  status: "",
  rideStatus: "",
  minSeats: "",
  maxPrice: "",
  departureFrom: "",
  departureTo: "",
  sort: "departureAsc",
}
const input =
  "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
const money = (n: number) => `${kopecksToRubles(n).replace(".", ",")} ₽`
export function BookingsScreen({
  onExpired,
  driver = false,
}: {
  onExpired: () => void
  driver?: boolean
}) {
  const [command, setCommand] = useState<{
    item: OwnBooking
    kind: "confirm" | "reject" | "cancel"
  } | null>(null)
  const [reason, setReason] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState("")
  const [commandError, setCommandError] = useState("")
  const busy = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const [draft, setDraft] = useState(empty)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const key = `${query}&page=${page}&pageSize=10|${revision}`
  const [result, setResult] = useState<{
    key: string
    loadedAt?: number
    data?: Page<OwnBooking>
    error?: string
  }>({ key: "" })
  const hasFilters = [...new URLSearchParams(query)].some(
    ([name, value]) =>
      name !== "sort" && !(name === "period" && value === "all")
  )
  const loading = result.key !== key
  const data = !loading ? result.data : undefined
  useEffect(() => {
    let active = true
    apiRequest<Page<OwnBooking>>(
      `${driver ? "me/ride-bookings" : "me/bookings"}?${query}${query ? "&" : ""}page=${page}&pageSize=10`
    )
      .then((data) => {
        if (!active) return
        const last = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (page > last) setPage(last)
        else setResult({ key, data, loadedAt: Date.now() })
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
                : "Не удалось загрузить заявки",
          })
      })
    return () => {
      active = false
    }
  }, [query, page, revision, key, onExpired, driver])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    setCommand(null)
    try {
      const params = new URLSearchParams()
      for (const name of [
        "q",
        "period",
        "status",
        "rideStatus",
        "sort",
      ] as const)
        if (draft[name].trim()) params.set(name, draft[name].trim())
      if (draft.q.trim().length > 100)
        throw new Error("Поиск — не более 100 символов")
      if (draft.minSeats) {
        if (!/^[1-8]$/.test(draft.minSeats))
          throw new Error("Количество мест — от 1 до 8")
        params.set("minSeats", draft.minSeats)
      }
      if (draft.maxPrice)
        params.set("maxPriceKopecks", String(rublesToKopecks(draft.maxPrice)))
      for (const name of ["departureFrom", "departureTo"] as const)
        if (draft[name]) params.set(name, ekaterinburgISO(draft[name]))
      if (
        draft.departureFrom &&
        draft.departureTo &&
        draft.departureFrom > draft.departureTo
      )
        throw new Error("Начало диапазона позже конца")
      setQuery(String(params))
      setPage(1)
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте фильтры")
    }
  }
  async function decide(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command || busy.current) return
    if (
      command.kind === "reject" &&
      (!reason.trim() || reason.trim().length > 500)
    ) {
      setCommandError("Укажите причину от 1 до 500 символов")
      return
    }
    if (command.kind === "cancel" && reason.trim().length > 500) {
      setCommandError("Причина — не более 500 символов")
      return
    }
    busy.current = true
    setPending(true)
    setCommandError("")
    setNotice("")
    try {
      await apiRequest(
        `bookings/${command.item.id}/${command.kind}`,
        "POST",
        command.kind !== "confirm" && reason.trim()
          ? { reason: reason.trim() }
          : {}
      )
      if (!active.current) return
      setNotice(
        command.kind === "confirm"
          ? "Заявка подтверждена."
          : command.kind === "cancel"
            ? "Заявка отменена. Демонстрационный платёж отменён или полностью возвращён."
            : "Заявка отклонена."
      )
      setCommand(null)
      setRevision((value) => value + 1)
    } catch (cause) {
      if (!active.current) return
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else {
        setCommandError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сохранить решение"
        )
        if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
          setCommand(null)
          setRevision((value) => value + 1)
        }
      }
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }
  const change = (name: keyof typeof empty, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }))
    setError("")
  }
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="bookings-title"
    >
      <h1 id="bookings-title" className="text-2xl font-semibold">
        {driver ? "Заявки пассажиров" : "Мои заявки"}
      </h1>
      <p className="text-sm text-muted-foreground">
        Предстоящие поездки и история бронирований. Время — Екатеринбург
        (UTC+5).
      </p>
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              {driver
                ? "Поиск по пассажиру, маршруту или автомобилю"
                : "Поиск по маршруту, водителю или автомобилю"}
              <input
                className={input}
                value={draft.q}
                maxLength={100}
                onChange={(event) => change("q", event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Раздел
              <select
                className={input}
                value={draft.period}
                onChange={(event) => change("period", event.target.value)}
              >
                <option value="all">Все заявки</option>
                <option value="upcoming">Предстоящие поездки</option>
                <option value="history">История</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Статус заявки
              <select
                className={input}
                value={draft.status}
                onChange={(event) => change("status", event.target.value)}
              >
                <option value="">Любой</option>
                {Object.entries(bookingStatusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Статус поездки
              <select
                className={input}
                value={draft.rideStatus}
                onChange={(event) => change("rideStatus", event.target.value)}
              >
                <option value="">Любой</option>
                {Object.entries(rideStatusNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Минимум мест в заявке
              <input
                className={input}
                type="number"
                min="1"
                max="8"
                value={draft.minSeats}
                onChange={(event) => change("minSeats", event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Максимальная цена места, ₽
              <input
                className={input}
                inputMode="decimal"
                value={draft.maxPrice}
                onChange={(event) => change("maxPrice", event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Отправление от
              <input
                className={input}
                type="datetime-local"
                value={draft.departureFrom}
                onChange={(event) =>
                  change("departureFrom", event.target.value)
                }
              />
            </label>
            <label className="text-sm font-medium">
              Отправление до
              <input
                className={input}
                type="datetime-local"
                value={draft.departureTo}
                onChange={(event) => change("departureTo", event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Сортировка
              <select
                className={input}
                value={draft.sort}
                onChange={(event) => change("sort", event.target.value)}
              >
                <option value="departureAsc">Ближайшее отправление</option>
                <option value="departureDesc">Позднее отправление</option>
                <option value="createdDesc">Новые заявки</option>
              </select>
            </label>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Применить фильтры</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setCommand(null)
                setDraft(empty)
                setQuery("")
                setPage(1)
                setError("")
                setRevision((value) => value + 1)
              }}
            >
              Сбросить фильтры
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading || pending}
              onClick={() => setRevision((value) => value + 1)}
            >
              Обновить заявки
            </Button>
          </div>
        </fieldset>
      </form>
      {notice && (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          {notice}
        </p>
      )}
      {commandError && (
        <p role="alert" className="text-sm text-destructive">
          {commandError}
        </p>
      )}
      {command && (
        <form
          onSubmit={decide}
          className="space-y-4 rounded-xl border border-primary/30 p-5"
          aria-label="Решение по заявке"
        >
          <h2 className="text-lg font-semibold">
            {command.kind === "confirm"
              ? "Подтвердить заявку?"
              : command.kind === "cancel"
                ? "Отменить свою заявку?"
                : "Отклонить заявку?"}
          </h2>
          <p>
            {command.item.passenger?.fullName} · {command.item.ride.origin.name}{" "}
            → {command.item.ride.destination.name} · Мест: {command.item.seats}
          </p>
          {command.kind !== "confirm" && (
            <label className="block text-sm font-medium">
              {command.kind === "cancel"
                ? "Причина отмены (необязательно)"
                : "Причина отклонения"}
              <textarea
                className={`${input} min-h-24 py-3`}
                required={command.kind === "reject"}
                maxLength={500}
                disabled={pending}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  setCommandError("")
                }}
              />
            </label>
          )}
          {command.kind === "cancel" && (
            <p className="text-sm">
              Места освободятся. Успешная демо-оплата будет полностью
              возвращена; ожидающий платёж отменится без списания. Реальные
              деньги не используются.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={pending}>
              {pending
                ? "Сохраняем решение…"
                : command.kind === "confirm"
                  ? "Подтвердить заявку"
                  : command.kind === "cancel"
                    ? "Отменить заявку"
                    : "Отклонить заявку"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setCommand(null)}
            >
              Отмена
            </Button>
          </div>
        </form>
      )}
      {loading ? (
        <p role="status">Загружаем заявки…</p>
      ) : result.error ? (
        <div className="space-y-3">
          <p role="alert">{result.error}</p>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку
          </Button>
        </div>
      ) : (
        data && (
          <>
            <p role="status">Всего заявок: {data.total}</p>
            {!data.total ? (
              <div className="space-y-3 rounded-xl border border-dashed p-5">
                <p>
                  {hasFilters
                    ? "Нет заявок по выбранным условиям."
                    : "У вас пока нет заявок."}
                </p>
                <a
                  href="#/search"
                  className="font-medium underline underline-offset-4"
                >
                  Найти поездку
                </a>
              </div>
            ) : (
              <ul aria-label="Мои бронирования" className="space-y-4">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <article className="space-y-3 rounded-xl border p-5">
                      <h2 className="text-lg font-semibold break-words">
                        {item.ride.origin.name} → {item.ride.destination.name}
                      </h2>
                      <p className="font-medium">
                        Заявка: {bookingStatusNames[item.status] ?? item.status}
                      </p>
                      <p className="text-sm">
                        Поездка:{" "}
                        {rideStatusNames[item.ride.status] ?? item.ride.status}
                      </p>
                      <p>
                        {ekaterinburgInput(item.ride.departureAt).replace(
                          "T",
                          " "
                        )}{" "}
                        · Екатеринбург
                      </p>
                      <p>
                        {" "}
                        {driver
                          ? `Пассажир: ${item.passenger?.fullName}`
                          : `Водитель: ${item.ride.driver.fullName}`}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Посадка: {item.ride.origin.address}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Высадка: {item.ride.destination.address}
                      </p>
                      <p>
                        Мест: {item.seats} · Цена места:{" "}
                        {money(item.unitPriceKopecks)} · Сумма:{" "}
                        {money(item.seats * item.unitPriceKopecks)}
                      </p>
                      <p className="text-sm">
                        {item.ride.vehicle.make} {item.ride.vehicle.model} ·{" "}
                        {item.ride.vehicle.color}
                      </p>
                      {item.cancellationReason && (
                        <p className="text-sm break-words whitespace-pre-wrap">
                          Причина: {item.cancellationReason}
                        </p>
                      )}
                      <p className="text-xs break-all text-muted-foreground">
                        Номер заявки: {item.id}
                      </p>
                      <PaymentInfo payment={item.payment} />
                      {(!driver || item.passenger) &&
                        item.status === "COMPLETED" &&
                        item.ride.status === "COMPLETED" && (
                          <BookingReview
                            key={`${driver ? "driver" : "passenger"}-${item.id}`}
                            bookingId={item.id}
                            recipientRole={driver ? "PASSENGER" : "DRIVER"}
                            recipientName={
                              driver
                                ? item.passenger!.fullName
                                : item.ride.driver.fullName
                            }
                            onExpired={onExpired}
                          />
                        )}
                      {!driver &&
                        ["PENDING", "CONFIRMED"].includes(item.status) &&
                        item.ride.status === "PUBLISHED" &&
                        new Date(item.ride.departureAt).getTime() >
                          (result.loadedAt ?? 0) && (
                          <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => {
                              setCommand({ item, kind: "cancel" })
                              setReason("")
                              setCommandError("")
                              setNotice("")
                            }}
                          >
                            Отменить мою заявку
                          </Button>
                        )}
                      {driver && (
                        <>
                          <p className="text-sm text-muted-foreground">
                            {item.passenger?.affiliation ||
                              "Принадлежность к университету не указана"}
                          </p>
                          <p className="font-medium">
                            Свободных мест в поездке: {item.ride.availableSeats}
                          </p>
                          {item.status === "PENDING" &&
                            item.ride.status === "PUBLISHED" &&
                            new Date(item.ride.departureAt).getTime() >
                              (result.loadedAt ?? 0) && (
                              <div className="flex flex-wrap gap-3">
                                {(["confirm", "reject"] as const).map(
                                  (kind) => (
                                    <Button
                                      key={kind}
                                      variant={
                                        kind === "confirm"
                                          ? "default"
                                          : "outline"
                                      }
                                      disabled={pending}
                                      onClick={() => {
                                        setCommand({ item, kind })
                                        setReason("")
                                        setCommandError("")
                                        setNotice("")
                                      }}
                                    >
                                      {kind === "confirm"
                                        ? "Подтвердить"
                                        : "Отклонить"}
                                    </Button>
                                  )
                                )}
                              </div>
                            )}
                        </>
                      )}
                      <a
                        href={`#/ride/${item.rideId}`}
                        className="inline-block text-sm font-medium underline underline-offset-4"
                      >
                        Публичная карточка поездки
                      </a>
                    </article>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Завершённые, закрытые и заполненные поездки могут быть недоступны
              в публичной карточке. Данные вашей заявки сохраняются здесь.
            </p>
            <nav
              aria-label="Страницы заявок"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={pending || page <= 1}
                onClick={() => {
                  setCommand(null)
                  setPage((value) => value - 1)
                }}
              >
                Назад
              </Button>
              <span className="text-sm">
                Страница {page} из{" "}
                {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <Button
                variant="outline"
                disabled={pending || page * data.pageSize >= data.total}
                onClick={() => {
                  setCommand(null)
                  setPage((value) => value + 1)
                }}
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
