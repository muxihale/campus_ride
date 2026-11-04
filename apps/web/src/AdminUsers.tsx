import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { Page } from "./ride-data"
import { ekaterinburgInput, ekaterinburgISO } from "./ride-form"
export type AdminUser = {
  id: string
  fullName: string
  email: string
  affiliation: string | null
  roles: string[]
  status: "ACTIVE" | "BLOCKED"
  createdAt: string
  updatedAt: string
}
type StatusResult = {
  changed: boolean
  cancelledRides: number
  cancelledBookings: number
  revokedSessions: number
}
const roles: Record<string, string> = {
  PASSENGER: "Пассажир",
  DRIVER: "Водитель",
  ADMIN: "Администратор",
}
const empty = {
  q: "",
  role: "",
  status: "",
  affiliation: "",
  registeredFrom: "",
  registeredTo: "",
  sort: "createdDesc",
}
const field =
  "mt-2 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
const focusHeading = (element: HTMLHeadingElement | null) => element?.focus()
export function AdminUsersScreen({
  userId,
  onExpired,
}: {
  userId: string
  onExpired: () => void
}) {
  const [draft, setDraft] = useState(empty),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0)
  const [command, setCommand] = useState<{
    user: AdminUser
    block: boolean
  } | null>(null)
  const [reason, setReason] = useState(""),
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
  const key = `${userId}|${query}|${page}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: Page<AdminUser>
    error?: string
  }>({ key: "" })
  const loading = result.key !== key
  useEffect(() => {
    let current = true
    apiRequest<Page<AdminUser>>(
      `admin/users?${query}${query ? "&" : ""}page=${page}&pageSize=10`
    )
      .then((data) => {
        if (!current) return
        setDenied(false)
        const last = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (page > last) setPage(last)
        else setResult({ key, data })
      })
      .catch((cause: unknown) => {
        if (!current) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else {
          if (cause instanceof ApiError && cause.status === 403) {
            setDenied(true)
            setCommand(null)
          }
          setResult({
            key,
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить пользователей",
          })
        }
      })
    return () => {
      current = false
    }
  }, [query, page, revision, key, onExpired])
  function filters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (command || busy.current) return
    setError("")
    try {
      if (draft.q.trim().length > 100 || draft.affiliation.trim().length > 200)
        throw new Error("Поиск — до 100 символов, принадлежность — до 200")
      if (
        draft.registeredFrom &&
        draft.registeredTo &&
        draft.registeredFrom > draft.registeredTo
      )
        throw new Error("Начало диапазона регистрации позже конца")
      const params = new URLSearchParams()
      for (const name of [
        "q",
        "role",
        "status",
        "affiliation",
        "sort",
      ] as const)
        if (draft[name].trim()) params.set(name, draft[name].trim())
      for (const name of ["registeredFrom", "registeredTo"] as const)
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
    if (!command || busy.current || denied || command.user.id === userId) return
    if (!reason.trim() || [...reason.trim()].length > 500) {
      setError("Укажите причину от 1 до 500 символов")
      return
    }
    busy.current = true
    setPending(true)
    setError("")
    setNotice("")
    try {
      const data = await apiRequest<StatusResult>(
        `admin/users/${command.user.id}/${command.block ? "block" : "unblock"}`,
        "POST",
        { reason: reason.trim() }
      )
      if (!active.current) return
      setNotice(
        !data.changed
          ? "Статус пользователя уже установлен. Данные обновлены."
          : command.block
            ? `Пользователь заблокирован. Отменено поездок: ${data.cancelledRides}, заявок: ${data.cancelledBookings}. Завершено сессий: ${data.revokedSessions}.`
            : "Пользователь разблокирован. Потребуется новый вход; отменённые участия не восстанавливаются."
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
            : "Не удалось изменить блокировку"
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
  const change = (name: keyof typeof empty, value: string) => {
    setDraft((current) => ({ ...current, [name]: value }))
    setError("")
  }
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="admin-users-title"
    >
      <h1 id="admin-users-title" className="text-2xl font-semibold">
        Управление пользователями
      </h1>
      {denied ? (
        <div className="space-y-3">
          <p role="alert">
            Доступ к управлению пользователями запрещён. Требуется роль
            администратора.
          </p>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => {
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
            Поиск и блокировка аккаунтов. Время регистрации — Екатеринбург
            (UTC+5).
          </p>
          <form onSubmit={filters} noValidate>
            <fieldset
              disabled={pending || command !== null}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium">
                  Поиск по имени или email
                  <input
                    className={field}
                    value={draft.q}
                    maxLength={100}
                    onChange={(e) => change("q", e.target.value)}
                  />
                </label>
                <label className="text-sm font-medium">
                  Роль пользователя
                  <select
                    className={field}
                    value={draft.role}
                    onChange={(e) => change("role", e.target.value)}
                  >
                    <option value="">Любая</option>
                    {Object.entries(roles).map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Статус аккаунта
                  <select
                    className={field}
                    value={draft.status}
                    onChange={(e) => change("status", e.target.value)}
                  >
                    <option value="">Любой</option>
                    <option value="ACTIVE">Активен</option>
                    <option value="BLOCKED">Заблокирован</option>
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Принадлежность к университету
                  <input
                    className={field}
                    value={draft.affiliation}
                    maxLength={200}
                    onChange={(e) => change("affiliation", e.target.value)}
                  />
                </label>
                {(["registeredFrom", "registeredTo"] as const).map((name) => (
                  <label className="text-sm font-medium" key={name}>
                    {name === "registeredFrom"
                      ? "Регистрация от"
                      : "Регистрация до"}
                    <input
                      className={field}
                      type="datetime-local"
                      value={draft[name]}
                      onChange={(e) => change(name, e.target.value)}
                    />
                  </label>
                ))}
                <label className="text-sm font-medium">
                  Сортировка пользователей
                  <select
                    className={field}
                    value={draft.sort}
                    onChange={(e) => change("sort", e.target.value)}
                  >
                    <option value="createdDesc">Сначала новые</option>
                    <option value="createdAsc">Сначала старые</option>
                    <option value="nameAsc">По имени</option>
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
                  disabled={loading}
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Обновить пользователей
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
              aria-label="Изменение блокировки"
            >
              <h2
                ref={focusHeading}
                tabIndex={-1}
                className="text-lg font-semibold"
              >
                {command.block
                  ? "Заблокировать пользователя?"
                  : "Разблокировать пользователя?"}
              </h2>
              <p className="break-words">{command.user.fullName}</p>
              <p className="text-sm break-all">{command.user.email}</p>
              <p className="text-sm text-muted-foreground">
                {command.block
                  ? "Все сессии завершатся. Активные участия в будущих не начатых поездках будут отменены с демонстрационными возвратами. Начатые, завершённые и прошедшие поездки сохранятся. Реальные деньги не используются."
                  : "Пользователь сможет войти заново. Старые сессии, отменённые поездки и заявки не восстанавливаются."}
              </p>
              <label className="block text-sm font-medium">
                Причина решения
                <textarea
                  className={`${field} min-h-28 resize-y`}
                  required
                  maxLength={500}
                  value={reason}
                  disabled={pending}
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
                    : command.block
                      ? "Подтвердить блокировку"
                      : "Подтвердить разблокировку"}
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
          {loading ? (
            <p role="status">Загружаем пользователей…</p>
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
                <p role="status">Всего пользователей: {result.data.total}</p>
                {!result.data.total ? (
                  <p className="rounded-xl border border-dashed p-5">
                    Нет пользователей по выбранным условиям.
                  </p>
                ) : (
                  <ul aria-label="Пользователи" className="space-y-4">
                    {result.data.items.map((user) => (
                      <li
                        className="min-w-0 space-y-3 rounded-xl border p-5"
                        key={user.id}
                      >
                        <h2 className="text-lg font-semibold break-words">
                          {user.fullName}
                        </h2>
                        <p className="break-all">{user.email}</p>
                        <p>
                          Статус:{" "}
                          {user.status === "ACTIVE"
                            ? "Активен"
                            : "Заблокирован"}
                        </p>
                        <p>
                          Роли:{" "}
                          {user.roles
                            .map((role) => roles[role] ?? role)
                            .join(", ") || "Не назначены"}
                        </p>
                        <p className="text-sm break-words">
                          {user.affiliation || "Принадлежность не указана"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Регистрация:{" "}
                          {ekaterinburgInput(user.createdAt).replace("T", " ")}{" "}
                          · Екатеринбург
                        </p>
                        {user.id === userId ? (
                          <p className="text-sm text-muted-foreground">
                            Ваш аккаунт. Изменение блокировки недоступно.
                          </p>
                        ) : (
                          <Button
                            variant={
                              user.status === "ACTIVE" ? "outline" : "default"
                            }
                            disabled={pending || command !== null}
                            onClick={() => {
                              setCommand({
                                user,
                                block: user.status === "ACTIVE",
                              })
                              setReason("")
                              setError("")
                              setNotice("")
                            }}
                          >
                            {user.status === "ACTIVE"
                              ? "Заблокировать"
                              : "Разблокировать"}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <nav
                  aria-label="Страницы пользователей"
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
                      Math.ceil(result.data.total / result.data.pageSize)
                    )}
                  </span>
                  <Button
                    variant="outline"
                    disabled={
                      page * result.data.pageSize >= result.data.total ||
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
