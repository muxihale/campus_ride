import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import { bookingStatusNames, type OwnBooking } from "./Bookings"
import type { Page } from "./ride-data"
import { ekaterinburgInput } from "./ride-form"
import { DriverStatisticsPanel } from "./DriverStatistics"
type RoleHome = "passenger" | "driver" | "admin"
const titles = {
  passenger: "Кабинет пассажира",
  driver: "Кабинет водителя",
  admin: "Администрирование",
}
const roleLinks: Record<RoleHome, { href: string; label: string }[]> = {
  passenger: [
    { href: "#/search", label: "Найти поездку" },
    { href: "#/bookings", label: "Открыть мои заявки" },
  ],
  driver: [
    { href: "#/rides", label: "Открыть мои поездки" },
    { href: "#/rides/new", label: "Новая поездка" },
    { href: "#/ride-bookings", label: "Открыть заявки пассажиров" },
    { href: "#/vehicles", label: "Управлять автомобилями" },
  ],
  admin: [
    { href: "#/admin/users", label: "Управлять пользователями" },
    { href: "#/admin/reviews", label: "Модерировать отзывы" },
    { href: "#/admin/activity", label: "Открыть историю решений" },
  ],
}
function UpcomingTrip({ onExpired }: { onExpired: () => void }) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{
    revision: number
    data?: Page<OwnBooking>
    error?: string
  }>({ revision: -1 })
  const loading = result.revision !== revision
  useEffect(() => {
    let active = true
    apiRequest<Page<OwnBooking>>(
      "me/bookings?period=upcoming&sort=departureAsc&page=1&pageSize=1"
    )
      .then((data) => {
        if (active) setResult({ revision, data })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setResult({
            revision,
            error:
              cause instanceof ApiError && cause.status === 403
                ? "Предстоящие поездки недоступны. Требуется роль пассажира."
                : cause instanceof Error
                  ? cause.message
                  : "Не удалось загрузить предстоящие поездки",
          })
      })
    return () => {
      active = false
    }
  }, [revision, onExpired])
  const booking = result.data?.items[0]
  return (
    <section className="space-y-4" aria-labelledby="upcoming-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="upcoming-title" className="text-xl font-semibold">
          Предстоящие поездки
        </h2>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Обновить предстоящие поездки
        </Button>
      </div>
      {loading ? (
        <p role="status">Загружаем предстоящие поездки…</p>
      ) : result.error ? (
        <div className="space-y-3">
          <p role="alert">{result.error}</p>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку поездок
          </Button>
        </div>
      ) : (
        result.data && (
          <>
            <p role="status">Предстоящих заявок: {result.data.total}</p>
            {!booking ? (
              <p className="rounded-xl border border-dashed p-5">
                Предстоящих поездок пока нет. Найдите подходящую поездку и
                отправьте заявку водителю.
              </p>
            ) : (
              <article className="min-w-0 space-y-3 rounded-xl border p-5">
                <p className="text-xs font-medium text-muted-foreground">
                  БЛИЖАЙШАЯ ПОЕЗДКА
                </p>
                <h3 className="text-lg font-semibold break-words">
                  {booking.ride.origin.name} → {booking.ride.destination.name}
                </h3>
                <p>
                  {ekaterinburgInput(booking.ride.departureAt).replace(
                    "T",
                    " "
                  )}{" "}
                  · Екатеринбург
                </p>
                <p className="break-words">
                  Водитель: {booking.ride.driver.fullName}
                </p>
                <p>
                  Заявка: {bookingStatusNames[booking.status] ?? booking.status}
                </p>
                <p>Мест в заявке: {booking.seats}</p>
                <p className="text-sm break-words text-muted-foreground">
                  Посадка: {booking.ride.origin.address}
                </p>
                <p className="text-sm text-muted-foreground">
                  Полная история и остальные заявки доступны в разделе «Мои
                  заявки».
                </p>
              </article>
            )}
          </>
        )
      )}
    </section>
  )
}
export function CabinetHome({
  role,
  onExpired,
}: {
  role: RoleHome
  onExpired: () => void
}) {
  const links = [
    ...roleLinks[role],
    { href: "#/activity", label: "Открыть историю действий" },
    { href: "#/profile", label: "Настроить профиль" },
    { href: "#/notifications", label: "Открыть уведомления" },
    { href: "#/reviews", label: "Открыть отзывы и рейтинги" },
  ]
  return (
    <section
      className="min-w-0 space-y-6 rounded-2xl border bg-card p-5 sm:p-8"
      aria-labelledby="cabinet-home-title"
    >
      <div>
        <p className="text-sm text-muted-foreground">CampusRide · УрФУ</p>
        <h1 id="cabinet-home-title" className="mt-2 text-2xl font-semibold">
          {titles[role]}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {role === "passenger"
            ? "Ваши ближайшие поездки и всё необходимое для следующего маршрута."
            : role === "driver"
              ? "Управляйте поездками и заявками, следите за результатами поездок."
              : "Управляйте доступом пользователей, проверяйте отзывы и историю собственных решений."}
        </p>
      </div>
      <nav aria-label="Быстрые действия" className="grid gap-3 sm:grid-cols-2">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="rounded-xl border p-4 text-sm font-medium underline-offset-4 outline-none hover:bg-muted hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {link.label}
          </a>
        ))}
      </nav>
      {role === "passenger" ? (
        <UpcomingTrip onExpired={onExpired} />
      ) : role === "driver" ? (
        <DriverStatisticsPanel onExpired={onExpired} />
      ) : (
        <p className="rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
          Каждое изменение доступа или видимости отзыва требует причины и
          сохраняется в истории. Связанные отмены и демо-возвраты выполняются
          вместе с решением.
        </p>
      )}
    </section>
  )
}
