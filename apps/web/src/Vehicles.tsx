import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"

type Vehicle = {
  id: string
  make: string
  model: string
  color: string
  registrationNumber: string
  passengerSeats: number
  createdAt: string
}
type VehicleList = {
  items: Vehicle[]
  total: number
  page: number
  pageSize: number
}
type Filters = {
  q: string
  make: string
  model: string
  color: string
  minSeats: string
}
const emptyFilters: Filters = {
  q: "",
  make: "",
  model: "",
  color: "",
  minSeats: "",
}
const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
const focusHeading = (element: HTMLHeadingElement | null) => {
  element?.focus()
}
const fields = [
  { name: "make", label: "Марка", maxLength: 60, placeholder: "Kia" },
  { name: "model", label: "Модель", maxLength: 60, placeholder: "Rio" },
  { name: "color", label: "Цвет", maxLength: 40, placeholder: "Белый" },
  {
    name: "registrationNumber",
    label: "Госномер",
    maxLength: 20,
    placeholder: "А123ВС196",
  },
] as const

function VehicleForm({
  vehicle,
  onSaved,
  onCancel,
  onExpired,
}: {
  vehicle: Vehicle | null
  onSaved: () => void
  onCancel: () => void
  onExpired: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const text = Object.fromEntries(
      fields.map(({ name }) => [name, String(form.get(name)).trim()])
    )
    setError("")
    if (Object.values(text).some((value) => !value)) {
      setError("Заполните все поля автомобиля")
      return
    }
    setPending(true)
    try {
      await apiRequest<Vehicle>(
        vehicle ? `me/vehicles/${vehicle.id}` : "me/vehicles",
        vehicle ? "PATCH" : "POST",
        { ...text, passengerSeats: Number(form.get("passengerSeats")) }
      )
      onSaved()
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сохранить автомобиль"
        )
    } finally {
      setPending(false)
    }
  }
  return (
    <section
      className="rounded-xl border bg-muted/20 p-5"
      aria-labelledby="vehicle-form-title"
    >
      <h2
        id="vehicle-form-title"
        className="text-xl font-semibold"
        tabIndex={-1}
        ref={focusHeading}
      >
        {vehicle ? "Редактировать автомобиль" : "Новый автомобиль"}
      </h2>
      <form
        onSubmit={(event) => void save(event)}
        className="mt-5 space-y-4"
        aria-busy={pending}
      >
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.name} className="block text-sm font-medium">
                {field.label}
                <input
                  name={field.name}
                  defaultValue={vehicle?.[field.name] ?? ""}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  required
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Госномер легкового автомобиля РФ, например А123ВС196. Кириллица и
            латиница допустимы.
          </p>
          <label className="block text-sm font-medium">
            Пассажирских мест
            <input
              name="passengerSeats"
              type="number"
              required
              min={1}
              max={8}
              step={1}
              defaultValue={vehicle?.passengerSeats ?? 3}
              className={inputClass}
              aria-describedby="vehicle-seats-hint"
            />
          </label>
          <p id="vehicle-seats-hint" className="text-xs text-muted-foreground">
            От 1 до 8, без места водителя.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="submit">
              {pending ? "Сохраняем…" : "Сохранить автомобиль"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Отмена
            </Button>
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

export function VehiclesScreen({ onExpired }: { onExpired: () => void }) {
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [filters, setFilters] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<Vehicle | "new" | null>(null)
  const [notice, setNotice] = useState("")
  const params = new URLSearchParams({ page: String(page), pageSize: "10" })
  for (const [key, value] of Object.entries(filters))
    if (value.trim()) params.set(key, value.trim())
  const search = params.toString()
  const key = `${search}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: VehicleList
    error?: string
  }>({ key: "" })
  const loading = result.key !== key
  const data = loading ? undefined : result.data
  const error = loading ? undefined : result.error
  const hasFilters = Object.values(filters).some((value) => value.trim())

  useEffect(() => {
    let active = true
    apiRequest<VehicleList>(`me/vehicles?${search}`)
      .then((data) => {
        if (active) setResult({ key, data })
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
                : "Не удалось загрузить автомобили",
          })
      })
    return () => {
      active = false
    }
  }, [search, key, onExpired])

  function reset() {
    setDraft(emptyFilters)
    setFilters(emptyFilters)
    setPage(1)
  }
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFilters({ ...draft })
    setPage(1)
    setNotice("")
  }

  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="vehicles-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 id="vehicles-title" className="text-2xl font-semibold">
            Мои автомобили
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Добавляйте автомобили и поддерживайте их данные в актуальном
            состоянии.
          </p>
        </div>
        <Button
          disabled={editor !== null}
          onClick={() => {
            setEditor("new")
            setNotice("")
          }}
        >
          Добавить автомобиль
        </Button>
      </div>
      {editor !== null && (
        <VehicleForm
          key={editor === "new" ? "new" : editor.id}
          vehicle={editor === "new" ? null : editor}
          onExpired={onExpired}
          onCancel={() => setEditor(null)}
          onSaved={() => {
            if (editor === "new") reset()
            setEditor(null)
            setNotice("Автомобиль сохранён.")
            setRevision((value) => value + 1)
          }}
        />
      )}
      <form
        onSubmit={apply}
        className="space-y-4 rounded-xl border p-4"
        aria-label="Поиск автомобилей"
      >
        <label className="block text-sm font-medium">
          Поиск
          <input
            name="q"
            type="search"
            maxLength={100}
            placeholder="Марка, модель, цвет или госномер"
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
            className={inputClass}
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {(["make", "model", "color"] as const).map((field, index) => (
            <label key={field} className="block text-sm font-medium">
              {["Марка — фильтр", "Модель — фильтр", "Цвет — фильтр"][index]}
              <input
                value={draft[field]}
                maxLength={field === "color" ? 40 : 60}
                onChange={(event) =>
                  setDraft({ ...draft, [field]: event.target.value })
                }
                className={inputClass}
              />
            </label>
          ))}
          <label className="block text-sm font-medium">
            Минимум мест
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
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Найти</Button>
          <Button type="button" variant="outline" onClick={reset}>
            Сбросить фильтры
          </Button>
        </div>
      </form>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {loading ? (
        <p role="status" className="text-sm">
          Загружаем автомобили…
        </p>
      ) : error ? (
        <div>
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку
          </Button>
        </div>
      ) : (
        data && (
          <>
            <p className="text-sm text-muted-foreground" role="status">
              Найдено автомобилей: {data.total}
            </p>
            {data.items.length === 0 ? (
              <div className="rounded-xl border border-dashed p-6">
                <h2 className="text-lg font-semibold">
                  {hasFilters
                    ? "Нет автомобилей по этим условиям"
                    : page > 1
                      ? "На этой странице нет автомобилей"
                      : "Пока нет автомобилей"}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {hasFilters
                    ? "Измените поиск или сбросьте фильтры."
                    : page > 1
                      ? "Вернитесь на предыдущую страницу."
                      : "Добавьте свой первый автомобиль, чтобы подготовиться к созданию поездок."}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data.items.map((vehicle) => (
                  <li
                    key={vehicle.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5"
                  >
                    <div className="min-w-0">
                      <h2 className="text-lg font-semibold break-words">
                        {vehicle.make} {vehicle.model}
                      </h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {vehicle.color} · Мест для пассажиров:{" "}
                        {vehicle.passengerSeats}
                      </p>
                      <p className="mt-2 font-mono text-sm tracking-wider">
                        {vehicle.registrationNumber}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      disabled={editor !== null}
                      aria-label={`Редактировать ${vehicle.make} ${vehicle.model} ${vehicle.registrationNumber}`}
                      onClick={() => {
                        setEditor(vehicle)
                        setNotice("")
                      }}
                    >
                      Редактировать
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <nav
              aria-label="Страницы автомобилей"
              className="flex flex-wrap items-center gap-3"
            >
              <Button
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Назад
              </Button>
              <span className="text-sm text-muted-foreground">
                Страница {page} из {Math.max(1, Math.ceil(data.total / 10))}
              </span>
              <Button
                variant="outline"
                disabled={page * 10 >= data.total}
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
