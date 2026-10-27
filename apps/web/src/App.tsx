import { useEffect, useState, type FormEvent } from "react"
import { CarFront, LoaderCircle, MapPin } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, authRequest, type User } from "./auth"

type Mode = "login" | "register"
const roleNames = {
  PASSENGER: "Пассажир",
  DRIVER: "Водитель",
  ADMIN: "Администратор",
}
const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [sessionError, setSessionError] = useState("")
  const [mode, setMode] = useState<Mode>("login")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    authRequest<User>("me")
      .then((current) => {
        if (active) setUser(current)
      })
      .catch((cause: unknown) => {
        if (active && !(cause instanceof ApiError && cause.status === 401))
          setSessionError(
            cause instanceof Error
              ? cause.message
              : "Не удалось проверить сессию"
          )
      })
      .finally(() => {
        if (active) setRestoring(false)
      })
    return () => {
      active = false
    }
  }, [retry])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = {
      email: String(form.get("email")),
      password: String(form.get("password")),
      ...(mode === "register"
        ? {
            fullName: String(form.get("fullName")),
            affiliation: String(form.get("affiliation")),
          }
        : {}),
    }
    setPending(true)
    setError("")
    setNotice("")
    try {
      setUser(await authRequest<User>(mode, body))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось войти")
    } finally {
      setPending(false)
    }
  }

  async function logout() {
    setPending(true)
    setError("")
    try {
      await authRequest<void>("logout", {})
      setUser(null)
      setMode("login")
      setNotice("Вы вышли из аккаунта.")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось выйти")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-5 sm:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b py-5">
        <a
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <CarFront className="size-6" aria-hidden="true" />
          CampusRide
        </a>
        {user ? (
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="max-w-60 truncate text-sm font-medium">
                {user.fullName}
              </p>
              <p className="text-xs text-muted-foreground">
                {user.roles.map((role) => roleNames[role]).join(" · ")}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => void logout()}
            >
              {pending ? "Выходим…" : "Выйти"}
            </Button>
          </div>
        ) : (
          <span className="flex items-center gap-1 text-xs text-muted-foreground sm:text-sm">
            <MapPin className="size-4" aria-hidden="true" />
            Екатеринбург · УрФУ
          </span>
        )}
      </header>
      <main className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-2 lg:gap-20 lg:py-24">
        <section>
          <p className="mb-5 text-sm text-muted-foreground">
            Свои люди. Общий маршрут.
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            В университет —<br />
            по пути друг с другом.
          </h1>
          <p className="mt-6 max-w-lg leading-relaxed text-muted-foreground">
            Совместные поездки студентов и сотрудников УрФУ. Знакомьтесь с
            попутчиками и добирайтесь до кампуса вместе.
          </p>
          <p className="mt-4 text-sm text-muted-foreground">
            Поиск поездок и бронирование появятся на следующих этапах проекта.
          </p>
        </section>
        <section
          className="w-full rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
          aria-label="Аккаунт"
        >
          {restoring ? (
            <p role="status" className="flex items-center gap-2">
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              Проверяем сессию…
            </p>
          ) : sessionError ? (
            <div>
              <h2 className="text-xl font-semibold">
                Не удалось проверить сессию
              </h2>
              <p role="alert" className="mt-3 text-sm text-destructive">
                {sessionError}
              </p>
              <Button
                className="mt-5"
                onClick={() => {
                  setSessionError("")
                  setRestoring(true)
                  setRetry((value) => value + 1)
                }}
              >
                Повторить
              </Button>
            </div>
          ) : user ? (
            <div>
              <p className="text-sm text-muted-foreground">Вы в CampusRide</p>
              <h2 className="mt-2 text-2xl font-semibold">
                Рады видеть вас, {user.fullName}!
              </h2>
              <p className="mt-4 text-sm break-all text-muted-foreground">
                {user.email}
              </p>
              {user.affiliation && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {user.affiliation}
                </p>
              )}
              <p className="mt-6 text-sm leading-relaxed">
                Аккаунт готов. Личные кабинеты и поездки появятся в следующих
                обновлениях.
              </p>
            </div>
          ) : (
            <>
              <h2 className="text-2xl font-semibold">
                {mode === "login"
                  ? "С возвращением"
                  : "Присоединяйтесь к CampusRide"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "login"
                  ? "Войдите в свой аккаунт, чтобы продолжить."
                  : "Создайте аккаунт пассажира. Стать водителем можно будет позже."}
              </p>
              <form
                key={mode}
                onSubmit={(event) => void submit(event)}
                className="mt-6 space-y-4"
                aria-busy={pending}
              >
                <fieldset disabled={pending} className="space-y-4">
                  {mode === "register" && (
                    <label className="block text-sm font-medium">
                      Имя и фамилия
                      <input
                        className={inputClass}
                        name="fullName"
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={100}
                        placeholder="Анна Соколова"
                      />
                    </label>
                  )}
                  <label className="block text-sm font-medium">
                    Email
                    <input
                      className={inputClass}
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                      maxLength={254}
                      placeholder="anna@example.ru"
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Пароль
                    <input
                      className={inputClass}
                      name="password"
                      type="password"
                      autoComplete={
                        mode === "login" ? "current-password" : "new-password"
                      }
                      required
                      minLength={10}
                      maxLength={128}
                      aria-describedby="password-hint"
                    />
                  </label>
                  <p
                    id="password-hint"
                    className="text-xs text-muted-foreground"
                  >
                    От 10 до 128 символов. Пробелы учитываются.
                  </p>
                  {mode === "register" && (
                    <label className="block text-sm font-medium">
                      Принадлежность к университету{" "}
                      <span className="font-normal text-muted-foreground">
                        (необязательно)
                      </span>
                      <input
                        className={inputClass}
                        name="affiliation"
                        autoComplete="organization"
                        maxLength={200}
                        placeholder="Студент ИРИТ-РТФ"
                      />
                    </label>
                  )}
                  <Button type="submit" className="mt-2 h-11 w-full">
                    {pending && (
                      <LoaderCircle
                        className="animate-spin"
                        aria-hidden="true"
                      />
                    )}
                    {pending
                      ? "Подождите…"
                      : mode === "login"
                        ? "Войти"
                        : "Создать аккаунт"}
                  </Button>
                </fieldset>
              </form>
              <div className="mt-5 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
                {mode === "login"
                  ? "Ещё нет аккаунта?"
                  : "Уже зарегистрированы?"}
                <Button
                  variant="link"
                  disabled={pending}
                  onClick={() => {
                    setMode(mode === "login" ? "register" : "login")
                    setError("")
                    setNotice("")
                  }}
                >
                  {mode === "login" ? "Зарегистрироваться" : "Войти в аккаунт"}
                </Button>
              </div>
            </>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              {notice}
            </p>
          )}
        </section>
      </main>
      <footer className="border-t py-5 text-xs text-muted-foreground">
        Демонстрационный сервис. Не является официальным сервисом УрФУ.
      </footer>
    </div>
  )
}
