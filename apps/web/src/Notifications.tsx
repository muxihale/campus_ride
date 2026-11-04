import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { Page } from "./ride-data"
import { ekaterinburgInput, ekaterinburgISO } from "./ride-form"
export type Notification = {
  id: string
  kind: string
  title: string
  body: string
  link: string | null
  resourceType: string | null
  resourceId: string | null
  createdAt: string
  readAt: string | null
}
const kinds: Record<string, string> = {
  BOOKING_REQUEST: "Новая заявка",
  BOOKING_CONFIRMED: "Подтверждение заявки",
  BOOKING_REJECTED: "Отклонение заявки",
  BOOKING_CANCELLED: "Отмена заявки",
  RIDE_CANCELLED: "Отмена поездки",
  RIDE_STARTED: "Начало поездки",
  RIDE_COMPLETED: "Завершение поездки",
  PAYMENT_UPDATED: "Изменение платежа",
  REVIEW_RECEIVED: "Новый отзыв",
  SYSTEM: "Системное",
}
const resources: Record<string, string> = {
  booking: "Заявка",
  ride: "Поездка",
  payment: "Платёж",
  review: "Отзыв",
  user: "Пользователь",
}
const empty = {
  q: "",
  kind: "",
  read: "",
  resourceType: "",
  dateFrom: "",
  dateTo: "",
}
const input =
  "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
export function NotificationsScreen({ onExpired }: { onExpired: () => void }) {
  const [draft, setDraft] = useState(empty),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0)
  const [error, setError] = useState(""),
    [pending, setPending] = useState(false)
  const active = useRef(true),
    busy = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const key = `${query}|${page}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: Page<Notification>
    error?: string
  }>({ key: "" })
  const loading = result.key !== key,
    data = !loading ? result.data : undefined
  useEffect(() => {
    let current = true
    apiRequest<Page<Notification>>(
      `notifications?${query}${query ? "&" : ""}page=${page}&pageSize=10`
    )
      .then((data) => {
        if (!current) return
        const last = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (page > last) setPage(last)
        else setResult({ key, data })
      })
      .catch((cause: unknown) => {
        if (!current) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setResult({
            key,
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить уведомления",
          })
      })
    return () => {
      current = false
    }
  }, [query, page, revision, key, onExpired])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      const params = new URLSearchParams()
      for (const name of ["q", "kind", "read", "resourceType"] as const)
        if (draft[name].trim()) params.set(name, draft[name].trim())
      for (const name of ["dateFrom", "dateTo"] as const)
        if (draft[name]) params.set(name, ekaterinburgISO(draft[name]))
      if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo)
        throw new Error("Начало диапазона позже конца")
      setQuery(String(params))
      setPage(1)
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте фильтры")
    }
  }
  async function read(id: string) {
    if (busy.current) return
    busy.current = true
    setPending(true)
    setError("")
    try {
      await apiRequest(`notifications/${id}/read`, "PATCH", {})
      if (active.current) setRevision((value) => value + 1)
    } catch (cause) {
      if (!active.current) return
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось отметить уведомление"
        )
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
      aria-labelledby="notifications-title"
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
    >
      <h1 id="notifications-title" className="text-2xl font-semibold">
        Уведомления
      </h1>
      <p className="text-sm text-muted-foreground">
        Изменения заявок и поездок. Время — Екатеринбург (UTC+5).
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">
              Поиск по уведомлениям
              <input
                className={input}
                maxLength={100}
                value={draft.q}
                onChange={(event) => change("q", event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Тип уведомления
              <select
                className={input}
                value={draft.kind}
                onChange={(event) => change("kind", event.target.value)}
              >
                <option value="">Любой</option>
                {Object.entries(kinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Прочтение
              <select
                className={input}
                value={draft.read}
                onChange={(event) => change("read", event.target.value)}
              >
                <option value="">Все</option>
                <option value="false">Непрочитанные</option>
                <option value="true">Прочитанные</option>
              </select>
            </label>
            <label className="text-sm font-medium">
              Объект уведомления
              <select
                className={input}
                value={draft.resourceType}
                onChange={(event) => change("resourceType", event.target.value)}
              >
                <option value="">Любой</option>
                {Object.entries(resources).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Получено от
              <input
                className={input}
                type="datetime-local"
                value={draft.dateFrom}
                onChange={(event) => change("dateFrom", event.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Получено до
              <input
                className={input}
                type="datetime-local"
                value={draft.dateTo}
                onChange={(event) => change("dateTo", event.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">Применить фильтры</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
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
              disabled={loading}
              onClick={() => setRevision((value) => value + 1)}
            >
              Обновить уведомления
            </Button>
          </div>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Загружаем уведомления…</p>
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
            <p role="status">Всего уведомлений: {data.total}</p>
            {!data.total ? (
              <p className="rounded-xl border border-dashed p-5">
                {query
                  ? "Нет уведомлений по выбранным условиям."
                  : "У вас пока нет уведомлений."}
              </p>
            ) : (
              <ul aria-label="Мои уведомления" className="space-y-4">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <article className="space-y-3 rounded-xl border p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold break-words">
                          {item.title}
                        </h2>
                        <span className="rounded-full bg-muted px-3 py-1 text-xs">
                          {item.readAt ? "Прочитано" : "Новое"}
                        </span>
                      </div>
                      <p className="break-words whitespace-pre-wrap">
                        {item.body}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {ekaterinburgInput(item.createdAt).replace("T", " ")} ·
                        Екатеринбург
                      </p>
                      <div className="flex flex-wrap items-center gap-4">
                        {item.link &&
                          [
                            "#/bookings",
                            "#/ride-bookings",
                            "#/driver",
                            "#/reviews",
                            "#/admin/reviews",
                            "#/profile",
                            "#/admin",
                            "#/rides",
                          ].includes(item.link) && (
                            <a
                              href={item.link}
                              className="text-sm font-medium underline underline-offset-4"
                            >
                              Открыть связанный раздел
                            </a>
                          )}
                        {!item.readAt && (
                          <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() => void read(item.id)}
                          >
                            Отметить прочитанным
                          </Button>
                        )}
                      </div>
                    </article>
                  </li>
                ))}
              </ul>
            )}
            <nav
              aria-label="Страницы уведомлений"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={pending || page <= 1}
                onClick={() => setPage((value) => value - 1)}
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
