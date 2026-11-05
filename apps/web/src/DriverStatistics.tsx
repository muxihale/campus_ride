import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import { ekaterinburgInput, ekaterinburgISO } from "./ride-form"
export type DriverStatistics = {
  dateFrom: string | null
  dateTo: string | null
  periodBasis: "departureAt"
  isDemo: true
  currency: "RUB"
  ridesTotal: number
  draftRides: number
  publishedRides: number
  inProgressRides: number
  completedRides: number
  cancelledRides: number
  completedBookings: number
  passengersTransported: number
  seatsTransported: number
  cancelledBookings: number
  rejectedBookings: number
  demoReceiptsKopecks: string
  demoCompletedRevenueKopecks: string
  demoRefundsKopecks: string
}
const labels: Record<
  Exclude<
    keyof DriverStatistics,
    | "dateFrom"
    | "dateTo"
    | "periodBasis"
    | "isDemo"
    | "currency"
    | "demoReceiptsKopecks"
    | "demoCompletedRevenueKopecks"
    | "demoRefundsKopecks"
  >,
  string
> = {
  ridesTotal: "Всего поездок",
  draftRides: "Черновики",
  publishedRides: "Опубликованы",
  inProgressRides: "В пути",
  completedRides: "Завершены",
  cancelledRides: "Отменены",
  completedBookings: "Завершённые заявки",
  passengersTransported: "Уникальные пассажиры",
  seatsTransported: "Перевезённые места",
  cancelledBookings: "Отменённые заявки",
  rejectedBookings: "Отклонённые заявки",
}
const moneyLabels = {
  demoReceiptsKopecks: "Демо-поступления",
  demoCompletedRevenueKopecks: "За завершённые поездки",
  demoRefundsKopecks: "Демо-возвраты",
}
const field =
  "mt-2 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
const money = (value: string) => {
  const amount = BigInt(value)
  return `${(amount / 100n).toLocaleString("ru-RU")},${String(amount % 100n).padStart(2, "0")} ₽`
}
export function DriverStatisticsPanel({
  onExpired,
}: {
  onExpired: () => void
}) {
  const [draft, setDraft] = useState({ dateFrom: "", dateTo: "" }),
    [query, setQuery] = useState(""),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("")
  const key = `${query}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: DriverStatistics
    error?: string
  }>({ key: "" })
  const loading = result.key !== key
  useEffect(() => {
    let active = true
    apiRequest<DriverStatistics>(
      `me/driver-statistics${query ? `?${query}` : ""}`
    )
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
              cause instanceof ApiError && cause.status === 403
                ? "Статистика недоступна. Требуется роль водителя."
                : cause instanceof Error
                  ? cause.message
                  : "Не удалось загрузить статистику",
          })
      })
    return () => {
      active = false
    }
  }, [query, revision, key, onExpired])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    try {
      if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo)
        throw new Error("Начало периода позже конца")
      const params = new URLSearchParams()
      for (const name of ["dateFrom", "dateTo"] as const)
        if (draft[name]) params.set(name, ekaterinburgISO(draft[name]))
      setQuery(String(params))
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверьте период")
    }
  }
  return (
    <section
      className="min-w-0 space-y-4"
      aria-labelledby="driver-statistics-title"
    >
      <h2 id="driver-statistics-title" className="text-xl font-semibold">
        Статистика поездок
      </h2>
      <p className="text-sm text-muted-foreground">
        Период относится ко времени отправления. Даты — Екатеринбург (UTC+5).
      </p>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {(["dateFrom", "dateTo"] as const).map((name) => (
            <label key={name} className="text-sm font-medium">
              {name === "dateFrom" ? "Отправление от" : "Отправление до"}
              <input
                className={field}
                type="datetime-local"
                value={draft[name]}
                onChange={(event) => {
                  setDraft((value) => ({
                    ...value,
                    [name]: event.target.value,
                  }))
                  setError("")
                }}
              />
            </label>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="submit">Применить период</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft({ dateFrom: "", dateTo: "" })
              setQuery("")
              setError("")
              setRevision((value) => value + 1)
            }}
          >
            Все даты
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            Обновить статистику
          </Button>
        </div>
      </form>
      {loading ? (
        <p role="status">Загружаем статистику…</p>
      ) : result.error ? (
        <div className="space-y-3">
          <p role="alert">{result.error}</p>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку статистики
          </Button>
        </div>
      ) : (
        result.data && (
          <>
            <p className="text-sm text-muted-foreground">
              {!result.data.dateFrom && !result.data.dateTo
                ? "Все даты отправления"
                : `Отправление: ${result.data.dateFrom ? ekaterinburgInput(result.data.dateFrom).replace("T", " ") : "без нижней границы"} — ${result.data.dateTo ? ekaterinburgInput(result.data.dateTo).replace("T", " ") : "без верхней границы"} · Екатеринбург`}
            </p>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(Object.keys(labels) as (keyof typeof labels)[]).map((name) => (
                <div key={name} className="min-w-0 rounded-xl border p-4">
                  <dt className="text-sm text-muted-foreground">
                    {labels[name]}
                  </dt>
                  <dd className="mt-2 text-2xl font-semibold break-words">
                    {result.data![name]}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Уникальные пассажиры считаются по аккаунтам. Места включают
              попутчиков без отдельного аккаунта.
            </p>
            <h3 className="font-semibold">Демонстрационные суммы</h3>
            <dl className="grid gap-3 sm:grid-cols-3">
              {(Object.keys(moneyLabels) as (keyof typeof moneyLabels)[]).map(
                (name) => (
                  <div key={name} className="min-w-0 rounded-xl border p-4">
                    <dt className="text-sm text-muted-foreground">
                      {moneyLabels[name]}
                    </dt>
                    <dd className="mt-2 text-lg font-semibold break-words">
                      {money(result.data![name])}
                    </dd>
                  </div>
                )
              )}
            </dl>
            <p className="text-xs text-muted-foreground">
              Поступления включают сохранённые оплаты подтверждённых будущих
              поездок. Возвраты уже исключены из поступлений и отдельно показаны
              для справки. Реальные деньги не используются.
            </p>
          </>
        )
      )}
    </section>
  )
}
