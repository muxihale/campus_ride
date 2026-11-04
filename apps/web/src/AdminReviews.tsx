import { bookingStatusNames } from "./Bookings"
import { rideStatusNames } from "./ride-data"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import { useAdminPage } from "./useAdminPage"
import { ekaterinburgInput, ekaterinburgISO } from "./ride-form"
export type AdminReview = {
  id: string
  bookingId: string
  rating: number
  comment: string
  createdAt: string
  hiddenAt: string | null
  hiddenReason: string | null
  recipientRole: "DRIVER" | "PASSENGER" | null
  author: { id: string; fullName: string }
  recipient: { id: string; fullName: string }
  bookingStatus: string
  rideStatus: string
}
const empty = {
  q: "",
  hidden: "",
  recipientRole: "",
  ratingMin: "",
  ratingMax: "",
  dateFrom: "",
  dateTo: "",
  sort: "newest",
}
const field =
  "mt-2 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
const focus = (heading: HTMLHeadingElement | null) => heading?.focus()
export function AdminReviewsScreen({ onExpired }: { onExpired: () => void }) {
  const [draft, setDraft] = useState(empty),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0)
  const [command, setCommand] = useState<AdminReview | null>(null),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [denied, setDenied] = useState(false)
  const busy = useRef(false),
    active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const list = useAdminPage<AdminReview>(
    "admin/reviews",
    query,
    page,
    revision,
    setPage,
    onExpired
  )
  const forbidden = denied || list.forbidden
  const change = (name: keyof typeof empty, value: string) => {
    setDraft((state) => ({ ...state, [name]: value }))
    setError("")
  }
  function filters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (command || pending) return
    setError("")
    try {
      if (draft.q.trim().length > 100)
        throw new Error("Поиск — не более 100 символов")
      const params = new URLSearchParams()
      for (const name of ["q", "hidden", "recipientRole", "sort"] as const)
        if (draft[name].trim()) params.set(name, draft[name].trim())
      for (const name of ["ratingMin", "ratingMax"] as const)
        if (draft[name]) {
          if (!/^[1-5]$/.test(draft[name]))
            throw new Error("Оценка — от 1 до 5")
          params.set(name, draft[name])
        }
      if (
        draft.ratingMin &&
        draft.ratingMax &&
        draft.ratingMin > draft.ratingMax
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
  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command || busy.current || forbidden) return
    if (!reason.trim() || [...reason.trim()].length > 500) {
      setError("Укажите причину от 1 до 500 символов")
      return
    }
    busy.current = true
    setPending(true)
    setError("")
    setNotice("")
    try {
      const data = await apiRequest<{ changed: boolean }>(
        `admin/reviews/${command.id}/${command.hiddenAt ? "restore" : "hide"}`,
        "POST",
        { reason: reason.trim() }
      )
      if (!active.current) return
      setNotice(
        !data.changed
          ? "Видимость отзыва уже установлена. Данные обновлены."
          : command.hiddenAt
            ? "Отзыв восстановлен."
            : "Отзыв скрыт и исключён из рейтингов."
      )
      setCommand(null)
      setRevision((value) => value + 1)
    } catch (cause) {
      if (!active.current) return
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else {
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сохранить решение"
        )
        if (cause instanceof ApiError && cause.status === 403) {
          setDenied(true)
          setCommand(null)
        } else if (
          cause instanceof ApiError &&
          [404, 409].includes(cause.status)
        ) {
          setCommand(null)
          setRevision((value) => value + 1)
        }
      }
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="admin-reviews-title"
    >
      <h1 id="admin-reviews-title" className="text-2xl font-semibold">
        Модерация отзывов
      </h1>
      {forbidden ? (
        <div className="space-y-3">
          <p role="alert">
            Доступ к модерации запрещён. Требуется роль администратора.
          </p>
          <Button
            variant="outline"
            disabled={list.loading}
            onClick={() => {
              setDenied(false)
              setError("")
              setRevision((value) => value + 1)
            }}
          >
            Проверить доступ
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Скрытые отзывы не учитываются в рейтингах. Причина обязательна для
            скрытия и восстановления. Время — Екатеринбург.
          </p>
          <form onSubmit={filters} noValidate>
            <fieldset
              disabled={pending || command !== null}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Поиск по отзыву, причине или имени
                  <input
                    className={field}
                    value={draft.q}
                    maxLength={100}
                    onChange={(e) => change("q", e.target.value)}
                  />
                </label>
                <label className="text-sm font-medium">
                  Видимость отзыва
                  <select
                    className={field}
                    value={draft.hidden}
                    onChange={(e) => change("hidden", e.target.value)}
                  >
                    <option value="">Все</option>
                    <option value="false">Видимые</option>
                    <option value="true">Скрытые</option>
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
                  <label className="text-sm font-medium" key={name}>
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
                  <label className="text-sm font-medium" key={name}>
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
                  disabled={list.loading}
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Обновить отзывы
                </Button>
              </div>
            </fieldset>
          </form>
          {notice && (
            <p role="status" className="rounded-lg bg-muted p-3 text-sm">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {command && (
            <form
              onSubmit={execute}
              noValidate
              className="space-y-4 rounded-xl border border-primary/30 p-5"
              aria-label="Решение по отзыву"
            >
              <h2 ref={focus} tabIndex={-1} className="text-lg font-semibold">
                {command.hiddenAt ? "Восстановить отзыв?" : "Скрыть отзыв?"}
              </h2>
              <p className="break-words">
                {command.author.fullName} → {command.recipient.fullName} ·
                Оценка: {command.rating} из 5
              </p>
              <p className="break-words whitespace-pre-wrap">
                {command.comment}
              </p>
              <p className="text-sm text-muted-foreground">
                {command.hiddenAt
                  ? "Видимость будет восстановлена. В рейтинге учитываются только корректные отзывы завершённых поездок."
                  : "Отзыв исчезнет из собственных и публичных списков и перестанет влиять на рейтинг. Текст и оценка сохранятся."}{" "}
                Участники получат уведомления, решение будет записано в историю.
              </p>
              <label className="block text-sm font-medium">
                Причина решения
                <textarea
                  className={`${field} min-h-28 resize-y`}
                  required
                  maxLength={500}
                  disabled={pending}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    setError("")
                  }}
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  className="h-auto min-h-9 whitespace-normal"
                  disabled={pending}
                >
                  {pending
                    ? "Сохраняем решение…"
                    : command.hiddenAt
                      ? "Подтвердить восстановление"
                      : "Подтвердить скрытие"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setCommand(null)
                    setError("")
                  }}
                >
                  Отмена
                </Button>
              </div>
            </form>
          )}
          {list.loading ? (
            <p role="status">Загружаем отзывы…</p>
          ) : list.error ? (
            <div className="space-y-3">
              <p role="alert">{list.error}</p>
              <Button
                variant="outline"
                onClick={() => setRevision((value) => value + 1)}
              >
                Повторить загрузку
              </Button>
            </div>
          ) : (
            list.data && (
              <>
                <p role="status">Всего отзывов: {list.data.total}</p>
                {!list.data.total ? (
                  <p className="rounded-xl border border-dashed p-5">
                    Нет отзывов по выбранным условиям.
                  </p>
                ) : (
                  <ul aria-label="Отзывы для модерации" className="space-y-4">
                    {list.data.items.map((review) => (
                      <li
                        className="min-w-0 space-y-3 rounded-xl border p-5"
                        key={review.id}
                      >
                        <h2 className="text-lg font-semibold break-words">
                          {review.author.fullName} → {review.recipient.fullName}
                        </h2>
                        <p>
                          Оценка: {review.rating} из 5 ·{" "}
                          {review.recipientRole === "DRIVER"
                            ? "Водителю"
                            : review.recipientRole === "PASSENGER"
                              ? "Пассажиру"
                              : "Участники требуют проверки"}
                        </p>
                        <p className="break-words whitespace-pre-wrap">
                          {review.comment}
                        </p>
                        <p className="font-medium">
                          {review.hiddenAt ? "Отзыв скрыт" : "Отзыв видим"}
                        </p>
                        {review.hiddenReason && (
                          <p className="break-words whitespace-pre-wrap">
                            Причина скрытия: {review.hiddenReason}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {ekaterinburgInput(review.createdAt).replace(
                            "T",
                            " "
                          )}{" "}
                          · Екатеринбург
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Заявка:{" "}
                          {bookingStatusNames[review.bookingStatus] ??
                            review.bookingStatus}{" "}
                          · Поездка:{" "}
                          {rideStatusNames[review.rideStatus] ??
                            review.rideStatus}
                        </p>
                        <p className="text-xs break-all text-muted-foreground">
                          Номер отзыва: {review.id}
                        </p>
                        <p className="text-xs break-all text-muted-foreground">
                          Номер заявки: {review.bookingId}
                        </p>
                        <Button
                          variant="outline"
                          disabled={pending || command !== null}
                          onClick={() => {
                            setCommand(review)
                            setReason("")
                            setError("")
                            setNotice("")
                          }}
                        >
                          {review.hiddenAt ? "Восстановить" : "Скрыть"}
                        </Button>
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
                    disabled={page <= 1 || pending || command !== null}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    Назад
                  </Button>
                  <span>
                    Страница {page} из{" "}
                    {Math.max(
                      1,
                      Math.ceil(list.data.total / list.data.pageSize)
                    )}
                  </span>
                  <Button
                    variant="outline"
                    disabled={
                      page * list.data.pageSize >= list.data.total ||
                      pending ||
                      command !== null
                    }
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Далее
                  </Button>
                </nav>
              </>
            )
          )}
        </>
      )}
    </section>
  )
}
