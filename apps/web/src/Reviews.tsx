import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { Page } from "./ride-data"
import { ekaterinburgInput, ekaterinburgISO } from "./ride-form"
type Review = {
  id: string
  rating: number
  comment: string
  createdAt: string
  recipientRole: "DRIVER" | "PASSENGER"
  author: { fullName: string }
  recipient: { fullName: string }
}
type Rating = { average: number | null; count: number }
type Ratings = { driver: Rating; passenger: Rating }
const empty = {
  q: "",
  direction: "received",
  recipientRole: "",
  ratingMin: "",
  ratingMax: "",
  dateFrom: "",
  dateTo: "",
  sort: "newest",
}
const field =
  "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
export function ReviewsScreen({
  userId,
  onExpired,
}: {
  userId: string
  onExpired: () => void
}) {
  const [draft, setDraft] = useState(empty)
  const [query, setQuery] = useState("direction=received")
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState("")
  const key = `${userId}|${query}|${page}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: Page<Review>
    ratings?: Ratings
    error?: string
  }>({ key: "" })
  const loading = key !== result.key
  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest<Page<Review>>(`me/reviews?${query}&page=${page}&pageSize=10`),
      apiRequest<Ratings>(`users/${userId}/ratings`),
    ])
      .then(([data, ratings]) => {
        if (!active) return
        const last = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (page > last) setPage(last)
        else setResult({ key, data, ratings })
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
                : "Не удалось загрузить отзывы",
          })
      })
    return () => {
      active = false
    }
  }, [userId, query, page, revision, key, onExpired])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      const params = new URLSearchParams()
      if (draft.q.trim().length > 100)
        throw new Error("Поиск — не более 100 символов")
      for (const name of ["q", "direction", "recipientRole", "sort"] as const)
        if (draft[name].trim()) params.set(name, draft[name].trim())
      for (const name of ["ratingMin", "ratingMax"] as const)
        if (draft[name]) {
          if (!/^[1-5]$/.test(draft[name]))
            throw new Error("Оценка — целое число от 1 до 5")
          params.set(name, draft[name])
        }
      if (
        draft.ratingMin &&
        draft.ratingMax &&
        Number(draft.ratingMin) > Number(draft.ratingMax)
      )
        throw new Error("Минимальная оценка больше максимальной")
      if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo)
        throw new Error("Начало диапазона позже конца")
      for (const name of ["dateFrom", "dateTo"] as const)
        if (draft[name]) params.set(name, ekaterinburgISO(draft[name]))
      setQuery(String(params))
      setPage(1)
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте фильтры")
    }
  }
  const change = (name: keyof typeof empty, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }))
    setError("")
  }
  const sent = new URLSearchParams(query).get("direction") === "sent"
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="reviews-title"
    >
      <h1 id="reviews-title" className="text-2xl font-semibold">
        Мои отзывы и рейтинги
      </h1>
      <p className="text-sm text-muted-foreground">
        Оценки после завершённых поездок. Скрытые отзывы не показываются и не
        учитываются. Время — Екатеринбург.
      </p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Поиск по тексту или имени
            <input
              className={field}
              value={draft.q}
              maxLength={100}
              onChange={(e) => change("q", e.target.value)}
            />
          </label>
          <label className="text-sm font-medium">
            Раздел отзывов
            <select
              className={field}
              value={draft.direction}
              onChange={(e) => change("direction", e.target.value)}
            >
              <option value="received">Полученные</option>
              <option value="sent">Оставленные</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Роль получателя
            <select
              className={field}
              value={draft.recipientRole}
              onChange={(e) => change("recipientRole", e.target.value)}
            >
              <option value="">Любая</option>
              <option value="DRIVER">Водитель</option>
              <option value="PASSENGER">Пассажир</option>
            </select>
          </label>
          {(["ratingMin", "ratingMax"] as const).map((name) => (
            <label key={name} className="text-sm font-medium">
              {name === "ratingMin" ? "Оценка от" : "Оценка до"}
              <input
                className={field}
                type="number"
                min={1}
                max={5}
                value={draft[name]}
                onChange={(e) => change(name, e.target.value)}
              />
            </label>
          ))}
          {(["dateFrom", "dateTo"] as const).map((name) => (
            <label key={name} className="text-sm font-medium">
              {name === "dateFrom" ? "Отзыв от" : "Отзыв до"}
              <input
                className={field}
                type="datetime-local"
                value={draft[name]}
                onChange={(e) => change(name, e.target.value)}
              />
            </label>
          ))}
          <label className="text-sm font-medium">
            Сортировка отзывов
            <select
              className={field}
              value={draft.sort}
              onChange={(e) => change("sort", e.target.value)}
            >
              <option value="newest">Сначала новые</option>
              <option value="oldest">Сначала старые</option>
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
              setDraft(empty)
              setQuery("direction=received")
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
            Обновить отзывы
          </Button>
        </div>
      </form>
      {loading ? (
        <p role="status">Загружаем отзывы…</p>
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
        result.data && (
          <>
            <div
              className="grid gap-3 sm:grid-cols-2"
              aria-label="Мои рейтинги"
            >
              {(["driver", "passenger"] as const).map((name) => {
                const rating = result.ratings![name]
                return (
                  <div className="rounded-xl border p-4" key={name}>
                    <h2 className="font-semibold">
                      {name === "driver" ? "Как водитель" : "Как пассажир"}
                    </h2>
                    <p>
                      {rating.average === null
                        ? "Пока нет оценок"
                        : `${String(rating.average).replace(".", ",")} из 5`}{" "}
                      · Отзывов: {rating.count}
                    </p>
                  </div>
                )
              })}
            </div>
            <p className="text-sm text-muted-foreground">
              Рейтинги рассчитаны по всем вашим полученным оценкам и не зависят
              от фильтров.
            </p>
            <h2 className="text-lg font-semibold">
              {sent ? "Оставленные отзывы" : "Полученные отзывы"}
            </h2>
            <p role="status">Всего отзывов: {result.data.total}</p>
            {!result.data.total ? (
              <p className="rounded-xl border border-dashed p-5">
                Нет отзывов по выбранным условиям.
              </p>
            ) : (
              <ul aria-label="Список отзывов" className="space-y-4">
                {result.data.items.map((review) => (
                  <li
                    className="min-w-0 space-y-2 rounded-xl border p-5"
                    key={review.id}
                  >
                    <p className="font-medium break-words">
                      {sent
                        ? `Кому: ${review.recipient.fullName}`
                        : `От: ${review.author.fullName}`}
                    </p>
                    <p>
                      Оценка: {review.rating} из 5 ·{" "}
                      {review.recipientRole === "DRIVER"
                        ? "Водителю"
                        : "Пассажиру"}
                    </p>
                    <p className="break-words whitespace-pre-wrap">
                      {review.comment}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ekaterinburgInput(review.createdAt).replace("T", " ")} ·
                      Екатеринбург
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <nav
              aria-label="Страницы отзывов"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Назад
              </Button>
              <span>
                Страница {page} из{" "}
                {Math.max(
                  1,
                  Math.ceil(result.data.total / result.data.pageSize)
                )}
              </span>
              <Button
                variant="outline"
                disabled={page * result.data.pageSize >= result.data.total}
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
