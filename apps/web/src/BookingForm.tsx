import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest, type User } from "./auth"
import type { PublicRideDetail } from "./PublicRide"
import { kopecksToRubles } from "./ride-form"
type Booking = {
  id: string
  rideId: string
  passengerId: string
  seats: number
  unitPriceKopecks: number
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED"
}
const money = (value: number) => `${kopecksToRubles(value).replace(".", ",")} ₽`
export function BookingForm({
  ride,
  user,
  restoring = false,
  returnTo,
  onExpired,
  onSeats,
}: {
  ride: PublicRideDetail
  user: User | null
  restoring?: boolean
  returnTo: string
  onExpired?: () => void
  onSeats: (seats: number) => void
}) {
  const [seats, setSeats] = useState("1")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [booking, setBooking] = useState<Booking | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const refreshId = useRef(0)
  const [notice, setNotice] = useState("")
  const [uncertain, setUncertain] = useState(false)
  const [closed, setClosed] = useState(false)
  const attempt = useRef<{ seats: number; requestKey: string } | null>(null)
  const busy = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  async function refresh() {
    const sequence = ++refreshId.current
    setRefreshing(true)
    try {
      const current = await apiRequest<PublicRideDetail>(`rides/${ride.id}`)
      if (active.current && sequence === refreshId.current) {
        setClosed(false)
        if (!attempt.current && current.availableSeats > 0)
          setSeats((value) =>
            String(Math.min(Number(value), current.availableSeats))
          )
        onSeats(current.availableSeats)
        setNotice("")
      }
    } catch (cause) {
      if (!active.current || sequence !== refreshId.current) return
      if (cause instanceof ApiError && cause.status === 404) {
        onSeats(0)
        setClosed(true)
        setNotice(
          "Поездка больше не доступна в публичном поиске: места могли закончиться или поездка закрыта."
        )
      } else
        setNotice("Не удалось обновить свободные места. Повторите обновление.")
    } finally {
      if (active.current && sequence === refreshId.current) setRefreshing(false)
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || booking || closed || !user) return
    const count = Number(seats)
    if (
      !attempt.current &&
      (!Number.isInteger(count) || count < 1 || count > ride.availableSeats)
    ) {
      setError("Выберите доступное число мест")
      return
    }
    busy.current = true
    setPending(true)
    setError("")
    attempt.current ??= { seats: count, requestKey: crypto.randomUUID() }
    try {
      const result = await apiRequest<Booking>(
        `rides/${ride.id}/bookings`,
        "POST",
        attempt.current
      )
      if (!active.current) return
      setBooking(result)
      setUncertain(false)
      // Серверная цена из ответа определяет итог, включая повтор запроса.
      await refresh()
    } catch (cause) {
      if (!active.current) return
      setError(
        cause instanceof Error ? cause.message : "Не удалось отправить заявку"
      )
      const definite =
        cause instanceof ApiError &&
        [400, 401, 403, 404, 409, 429].includes(cause.status)
      setUncertain(!definite)
      if (definite) attempt.current = null
      if (cause instanceof ApiError && cause.status === 401) onExpired?.()
      if (cause instanceof ApiError && [404, 409].includes(cause.status))
        await refresh()
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }
  const login = (
    <a
      href={`#/login?returnTo=${encodeURIComponent(returnTo)}`}
      className="inline-block font-medium underline underline-offset-4"
    >
      Войти для бронирования
    </a>
  )
  return (
    <section
      aria-labelledby="booking-title"
      className="space-y-4 rounded-xl border p-5"
    >
      <h3 id="booking-title" className="text-lg font-semibold">
        Бронирование мест
      </h3>
      {restoring ? (
        <p role="status">Проверяем вход…</p>
      ) : !user ? (
        login
      ) : user.id === ride.driver.id ? (
        <p>Это ваша поездка. Бронировать места в ней нельзя.</p>
      ) : !user.roles.includes("PASSENGER") ? (
        <p>Бронирование доступно аккаунтам с ролью пассажира.</p>
      ) : booking ? (
        <div role="status" className="space-y-2">
          <p className="font-medium">
            {
              {
                PENDING: "Заявка отправлена. Ожидает подтверждения водителем.",
                CONFIRMED: "Заявка подтверждена водителем.",
                REJECTED: "Заявка отклонена водителем.",
                CANCELLED: "Заявка отменена.",
                COMPLETED: "Поездка по заявке завершена.",
              }[booking.status]
            }
          </p>
          <p>Мест в заявке: {booking.seats}</p>
          <p>
            Стоимость заявки: {money(booking.seats * booking.unitPriceKopecks)}
          </p>
          <p className="text-sm break-all text-muted-foreground">
            Номер заявки: {booking.id}
          </p>
        </div>
      ) : closed || ride.availableSeats < 1 ? (
        <p>Свободных мест для бронирования нет.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">
            Количество мест
            <select
              value={seats}
              disabled={pending || uncertain}
              onChange={(event) => {
                setSeats(event.target.value)
                setError("")
              }}
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
            >
              {Array.from(
                { length: Math.min(8, ride.availableSeats) },
                (_, index) => index + 1
              ).map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </select>
          </label>
          <p className="font-medium">
            Итого: {money(Number(seats) * ride.priceKopecks)}
          </p>
          <p className="text-sm text-muted-foreground">
            Места резервируются сразу. Для поездки нужно подтверждение водителя.
            Оплата пока не выполняется.
          </p>
          {uncertain && (
            <p className="text-sm">
              Результат отправки неизвестен. Повторите отправку: повторная
              заявка не будет создана.
            </p>
          )}
          <Button type="submit" disabled={pending}>
            {pending
              ? "Отправляем заявку…"
              : uncertain
                ? "Повторить отправку"
                : "Забронировать места"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted-foreground">
            {notice}
          </p>
          <Button
            variant="outline"
            disabled={pending || refreshing}
            onClick={() => void refresh()}
          >
            Обновить свободные места
          </Button>
        </div>
      )}
    </section>
  )
}
