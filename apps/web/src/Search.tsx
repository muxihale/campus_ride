import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { apiRequest } from "./auth"
import { allPages } from "./ride-data"
import {
  emptySearch,
  readSearch,
  searchParams,
  type SearchFilters,
} from "./search-form"
type Reference = { id: string; name: string }
const inputClass =
  "mt-2 h-11 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
export function SearchScreen({ query }: { query: string }) {
  const [initial] = useState(() => readSearch(query))
  const [values, setValues] = useState<SearchFilters>(initial.values)
  const [error, setError] = useState(initial.error ?? "")
  const [refs, setRefs] = useState<{
    districts: Reference[]
    campuses: Reference[]
  } | null>(null)
  const [refsError, setRefsError] = useState("")
  const [result, setResult] = useState<{
    total?: number
    error?: string
  } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    Promise.all([
      allPages<Reference>("districts"),
      allPages<Reference>("campuses"),
    ])
      .then(([districts, campuses]) => {
        if (active) {
          setRefs({ districts, campuses })
          setRefsError("")
        }
      })
      .catch((cause: unknown) => {
        if (active)
          setRefsError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить районы и корпуса"
          )
      })
    return () => {
      active = false
    }
  }, [retry])
  useEffect(() => {
    if (!query || initial.error) return
    let active = true
    apiRequest<{ total: number }>(`rides?${new URLSearchParams(query)}`)
      .then((body) => {
        if (active) setResult({ total: body.total })
      })
      .catch((cause: unknown) => {
        if (active)
          setResult({
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось выполнить поиск",
          })
      })
    return () => {
      active = false
    }
  }, [query, initial.error, retry])
  function update(key: keyof SearchFilters, value: string) {
    setValues((current) => ({ ...current, [key]: value }))
    setError("")
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      const target = `#/search?${searchParams(values)}`
      if (window.location.hash === target) {
        setResult(null)
        setRetry((value) => value + 1)
      } else window.location.hash = target
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Проверьте условия поиска"
      )
    }
  }
  function reset() {
    setValues(emptySearch)
    setError("")
    if (window.location.hash !== "#/search") window.location.hash = "#/search"
    else setResult(null)
  }
  function retryLoad() {
    setRefsError("")
    setResult(null)
    setRetry((value) => value + 1)
  }
  return (
    <section
      className="mx-auto w-full max-w-4xl space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="search-title"
    >
      <div>
        <p className="text-sm text-muted-foreground">Екатеринбург · УрФУ</p>
        <h1 id="search-title" className="mt-2 text-3xl font-semibold">
          Найти поездку
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Выберите направление и удобное время. Дата и часы всегда относятся к
          Екатеринбургу (UTC+5).
        </p>
      </div>
      {refsError && (
        <div>
          <p role="alert" className="text-sm text-destructive">
            {refsError}
          </p>
          <Button variant="outline" className="mt-3" onClick={retryLoad}>
            Повторить загрузку справочников
          </Button>
        </div>
      )}
      {!refs && !refsError && (
        <p role="status" className="text-sm">
          Загружаем районы и корпуса…
        </p>
      )}
      <form
        onSubmit={submit}
        className="space-y-5"
        aria-label="Условия поиска поездки"
      >
        <fieldset disabled={!refs} className="space-y-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block min-w-0 text-sm font-medium">
              Направление
              <select
                value={values.direction}
                onChange={(event) => update("direction", event.target.value)}
                className={inputClass}
              >
                <option value="">Любое направление</option>
                <option value="TO_CAMPUS">В университет</option>
                <option value="FROM_CAMPUS">Из университета</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Дата поездки
              <input
                type="date"
                value={values.date}
                onChange={(event) => update("date", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Отправление с
              <input
                type="time"
                value={values.timeFrom}
                onChange={(event) => update("timeFrom", event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Отправление до
              <input
                type="time"
                value={values.timeTo}
                onChange={(event) => update("timeTo", event.target.value)}
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Для ограничения по времени выберите дату. Можно искать и без даты —
            среди всех будущих поездок.
          </p>
          <div className="grid gap-5 sm:grid-cols-2">
            {(
              [
                {
                  key: "originDistrictId",
                  label: "Район отправления",
                  list: refs?.districts ?? [],
                  all: "Любой район",
                },
                {
                  key: "campusId",
                  label: "Корпус УрФУ",
                  list: refs?.campuses ?? [],
                  all: "Любой корпус",
                },
              ] as const
            ).map((field) => (
              <label
                key={field.key}
                className="block min-w-0 text-sm font-medium"
              >
                {field.label}
                <select
                  value={values[field.key]}
                  onChange={(event) => update(field.key, event.target.value)}
                  className={inputClass}
                >
                  <option value="">{field.all}</option>
                  {values[field.key] &&
                    !field.list.some(
                      (item) => item.id === values[field.key]
                    ) && (
                      <option value={values[field.key]}>
                        Выбранный район или корпус недоступен
                      </option>
                    )}
                  {field.list.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="block text-sm font-medium">
            Маршрут или условия
            <input
              type="search"
              maxLength={100}
              value={values.q}
              onChange={(event) => update("q", event.target.value)}
              placeholder="Например, Мира или рюкзак"
              className={inputClass}
            />
          </label>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Максимальная цена за место, ₽
              <input
                inputMode="decimal"
                maxLength={16}
                value={values.maxPrice}
                onChange={(event) => update("maxPrice", event.target.value)}
                placeholder="Без ограничения"
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              Нужно свободных мест
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={values.minSeats}
                onChange={(event) => update("minSeats", event.target.value)}
                placeholder="Хотя бы одно"
                className={inputClass}
              />
            </label>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            {(
              [
                { key: "musicAllowed", label: "Музыка" },
                { key: "luggageAllowed", label: "Багаж" },
                { key: "smokingAllowed", label: "Курение" },
              ] as const
            ).map((field) => (
              <label
                key={field.key}
                className="block min-w-0 text-sm font-medium"
              >
                {field.label}
                <select
                  value={values[field.key]}
                  onChange={(event) => update(field.key, event.target.value)}
                  className={inputClass}
                >
                  <option value="">Неважно</option>
                  <option value="true">Разрешено</option>
                  <option value="false">Не разрешено</option>
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!refs}>
            Найти поездки
          </Button>
          <Button type="button" variant="outline" onClick={reset}>
            Сбросить условия
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
      {query &&
        !initial.error &&
        (result?.error ? (
          <div>
            <p role="alert" className="text-sm text-destructive">
              {result.error}
            </p>
            <Button className="mt-3" variant="outline" onClick={retryLoad}>
              Повторить поиск
            </Button>
          </div>
        ) : result?.total !== undefined ? (
          <div className="rounded-xl border p-5">
            <p role="status" className="font-medium">
              Найдено поездок: {result.total}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Карточки результатов будут доступны в следующем обновлении.
            </p>
          </div>
        ) : (
          <p role="status" className="text-sm">
            Ищем поездки…
          </p>
        ))}
    </section>
  )
}
