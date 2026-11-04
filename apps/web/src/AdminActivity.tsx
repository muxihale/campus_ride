import { useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { useAdminPage } from "./useAdminPage"
import { ekaterinburgInput, ekaterinburgISO } from "./ride-form"
const actions: Record<string, string> = {
  "user.blocked": "Блокировка пользователя",
  "user.unblocked": "Разблокировка пользователя",
  "review.hidden": "Скрытие отзыва",
  "review.restored": "Восстановление отзыва",
  "ride.cancelled": "Отмена поездки",
  "booking.cancelled": "Отмена заявки",
  "payment.cancelled": "Отмена демо-платежа",
  "payment.refunded": "Демо-возврат",
}
const resources: Record<string, string> = {
  user: "Пользователь",
  review: "Отзыв",
  ride: "Поездка",
  booking: "Заявка",
  payment: "Платёж",
}
type Activity = {
  id: string
  action: string
  resourceType: string
  resourceId: string
  reason: string | null
  createdAt: string
}
const empty = {
  q: "",
  action: "",
  resourceType: "",
  resourceId: "",
  dateFrom: "",
  dateTo: "",
  sort: "newest",
}
const field =
  "mt-2 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
export function AdminActivityScreen({ onExpired }: { onExpired: () => void }) {
  const [draft, setDraft] = useState(empty),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("")
  const list = useAdminPage<Activity>(
    "admin/activity",
    query,
    page,
    revision,
    setPage,
    onExpired
  )
  const change = (name: keyof typeof empty, value: string) => {
    setDraft((state) => ({ ...state, [name]: value }))
    setError("")
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      if (draft.q.trim().length > 100)
        throw new Error("Поиск — не более 100 символов")
      if (
        draft.resourceId.trim() &&
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(
          draft.resourceId.trim()
        )
      )
        throw new Error("Номер объекта должен быть UUID")
      if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo)
        throw new Error("Начало диапазона позже конца")
      const params = new URLSearchParams()
      for (const name of [
        "q",
        "action",
        "resourceType",
        "resourceId",
        "sort",
      ] as const)
        if (draft[name].trim()) params.set(name, draft[name].trim())
      for (const name of ["dateFrom", "dateTo"] as const)
        if (draft[name]) params.set(name, ekaterinburgISO(draft[name]))
      setQuery(String(params))
      setPage(1)
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте фильтры")
    }
  }
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="admin-activity-title"
    >
      <h1 id="admin-activity-title" className="text-2xl font-semibold">
        Мои действия администратора
      </h1>
      {list.forbidden ? (
        <div className="space-y-3">
          <p role="alert">
            Доступ к истории запрещён. Требуется роль администратора.
          </p>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Проверить доступ
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Ваши решения и связанные отмены. Действия других администраторов
            здесь не показываются. Время — Екатеринбург.
          </p>
          <form onSubmit={submit} noValidate className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Поиск по причине или объекту
                <input
                  className={field}
                  maxLength={100}
                  value={draft.q}
                  onChange={(e) => change("q", e.target.value)}
                />
              </label>
              <label className="text-sm font-medium">
                Действие
                <select
                  className={field}
                  value={draft.action}
                  onChange={(e) => change("action", e.target.value)}
                >
                  <option value="">Любое</option>
                  {Object.entries(actions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium">
                Тип объекта
                <select
                  className={field}
                  value={draft.resourceType}
                  onChange={(e) => change("resourceType", e.target.value)}
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
                Номер объекта
                <input
                  className={field}
                  value={draft.resourceId}
                  onChange={(e) => change("resourceId", e.target.value)}
                  placeholder="UUID из карточки"
                />
              </label>
              {(["dateFrom", "dateTo"] as const).map((name) => (
                <label key={name} className="text-sm font-medium">
                  {name === "dateFrom" ? "Действие от" : "Действие до"}
                  <input
                    className={field}
                    type="datetime-local"
                    value={draft[name]}
                    onChange={(e) => change(name, e.target.value)}
                  />
                </label>
              ))}
              <label className="text-sm font-medium">
                Сортировка действий
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
            {error && <p role="alert">{error}</p>}
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
                Обновить историю
              </Button>
            </div>
          </form>
          {list.loading ? (
            <p role="status">Загружаем историю…</p>
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
                <p role="status">Всего действий: {list.data.total}</p>
                {!list.data.total ? (
                  <p className="rounded-xl border border-dashed p-5">
                    Нет действий по выбранным условиям.
                  </p>
                ) : (
                  <ul
                    aria-label="Мои административные действия"
                    className="space-y-4"
                  >
                    {list.data.items.map((item) => (
                      <li
                        key={item.id}
                        className="min-w-0 space-y-2 rounded-xl border p-5"
                      >
                        <h2 className="font-semibold">
                          {actions[item.action] ?? item.action}
                        </h2>
                        <p className="text-sm break-all">
                          {resources[item.resourceType] ?? item.resourceType}:{" "}
                          {item.resourceId}
                        </p>
                        <p className="break-words whitespace-pre-wrap">
                          {item.reason
                            ? `Причина: ${item.reason}`
                            : "Причина указана в основном решении по аккаунту."}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ekaterinburgInput(item.createdAt).replace("T", " ")}{" "}
                          · Екатеринбург
                        </p>
                        {["user", "review"].includes(item.resourceType) && (
                          <a
                            className="inline-block text-sm font-medium underline underline-offset-4"
                            href={
                              item.resourceType === "review"
                                ? "#/admin/reviews"
                                : "#/admin/users"
                            }
                          >
                            Открыть раздел объекта
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <nav
                  aria-label="Страницы истории"
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
                      Math.ceil(list.data.total / list.data.pageSize)
                    )}
                  </span>
                  <Button
                    variant="outline"
                    disabled={page * list.data.pageSize >= list.data.total}
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
