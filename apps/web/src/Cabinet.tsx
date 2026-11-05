import { CabinetHome } from "./CabinetHome"
import { ActivityScreen } from "./Activity"
import { AdminActivityScreen } from "./AdminActivity"
import { AdminReviewsScreen } from "./AdminReviews"
import { AdminUsersScreen } from "./AdminUsers"
import { ReviewsScreen } from "./Reviews"
import { NotificationsScreen } from "./Notifications"
import { BookingsScreen } from "./Bookings"
import { useEffect, useState } from "react"
import { RidesScreen } from "./Rides"
import { RideEditor } from "./RideEditor"
import { VehiclesScreen } from "./Vehicles"
import { BecomeDriver } from "./BecomeDriver"
import type { User } from "./auth"
import { ProfileScreen, type Profile } from "./Profile"
import { cn } from "@workspace/ui/lib/utils"

type Props = {
  user: User
  onSaved: (profile: Profile) => void
  onExpired: () => void
}
const destinations = [
  {
    path: "passenger",
    label: "Кабинет пассажира",
    role: "PASSENGER",
  },
  {
    path: "driver",
    label: "Кабинет водителя",
    role: "DRIVER",
  },
  {
    path: "admin",
    label: "Администрирование",
    role: "ADMIN",
  },
] as const

export function Cabinet({ user, onSaved, onExpired }: Props) {
  const [path, setPath] = useState(() => window.location.hash.slice(2))
  useEffect(() => {
    const changed = () => setPath(window.location.hash.slice(2))
    window.addEventListener("hashchange", changed)
    return () => window.removeEventListener("hashchange", changed)
  }, [])
  const available = destinations.filter((item) =>
    user.roles.includes(item.role)
  )
  const current = path || available[0]?.path || "profile"
  const destination = available.find((item) => item.path === current)
  return (
    <div className="grid min-w-0 gap-6 py-8 md:grid-cols-[15rem_minmax(0,1fr)] md:py-12">
      <nav
        aria-label="Личный кабинет"
        className="flex flex-col gap-2 self-start rounded-2xl border bg-card p-3"
      >
        <p className="px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground">
          ЛИЧНЫЙ КАБИНЕТ
        </p>
        {[
          ...available,
          ...(user.roles.includes("ADMIN")
            ? [
                { path: "admin/users", label: "Пользователи" },
                { path: "admin/reviews", label: "Модерация отзывов" },
                { path: "admin/activity", label: "Мои действия" },
              ]
            : []),
          ...(user.roles.includes("PASSENGER")
            ? [{ path: "bookings", label: "Мои заявки" }]
            : []),
          ...(user.roles.includes("DRIVER")
            ? [
                { path: "rides", label: "Мои поездки" },
                { path: "ride-bookings", label: "Заявки пассажиров" },
                { path: "vehicles", label: "Мои автомобили" },
                { path: "rides/new", label: "Создать поездку" },
              ]
            : []),
          { path: "activity", label: "История действий" },
          { path: "reviews", label: "Отзывы и рейтинги" },
          { path: "notifications", label: "Уведомления" },
          { path: "profile", label: "Мой профиль" },
          ...(user.roles.includes("PASSENGER") && !user.roles.includes("DRIVER")
            ? [{ path: "become-driver", label: "Стать водителем" }]
            : []),
        ].map((item) => (
          <a
            key={item.path}
            href={`#/${item.path}`}
            aria-current={current === item.path ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-3 text-sm font-medium transition outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
              current === item.path && "bg-secondary text-secondary-foreground"
            )}
          >
            {item.label}
          </a>
        ))}
      </nav>
      {current === "activity" ? (
        <ActivityScreen roles={user.roles} onExpired={onExpired} />
      ) : current === "admin/reviews" && user.roles.includes("ADMIN") ? (
        <AdminReviewsScreen onExpired={onExpired} />
      ) : current === "admin/activity" && user.roles.includes("ADMIN") ? (
        <AdminActivityScreen onExpired={onExpired} />
      ) : current === "admin/users" && user.roles.includes("ADMIN") ? (
        <AdminUsersScreen userId={user.id} onExpired={onExpired} />
      ) : current === "reviews" ? (
        <ReviewsScreen userId={user.id} onExpired={onExpired} />
      ) : current === "notifications" ? (
        <NotificationsScreen onExpired={onExpired} />
      ) : current === "ride-bookings" && user.roles.includes("DRIVER") ? (
        <BookingsScreen key="driver-bookings" driver onExpired={onExpired} />
      ) : current === "bookings" && user.roles.includes("PASSENGER") ? (
        <BookingsScreen key="passenger-bookings" onExpired={onExpired} />
      ) : current === "profile" ? (
        <ProfileScreen onSaved={onSaved} onExpired={onExpired} />
      ) : current === "vehicles" && user.roles.includes("DRIVER") ? (
        <VehiclesScreen onExpired={onExpired} />
      ) : current === "rides" && user.roles.includes("DRIVER") ? (
        <RidesScreen onExpired={onExpired} />
      ) : user.roles.includes("DRIVER") &&
        (current === "rides/new" ||
          /^rides\/[a-f0-9-]+\/edit$/i.test(current)) ? (
        <RideEditor
          key={current}
          rideId={current === "rides/new" ? undefined : current.split("/")[1]}
          onExpired={onExpired}
        />
      ) : current === "become-driver" && user.roles.includes("PASSENGER") ? (
        <BecomeDriver
          alreadyDriver={user.roles.includes("DRIVER")}
          onSaved={onSaved}
          onExpired={onExpired}
        />
      ) : destination ? (
        <CabinetHome
          key={destination.path}
          role={destination.path}
          onExpired={onExpired}
        />
      ) : (
        <section className="rounded-2xl border p-6">
          <h1 className="text-2xl font-semibold">Раздел недоступен</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Раздел не существует или недоступен для ваших ролей.
          </p>
          <a
            href="#/profile"
            className="mt-5 inline-block underline underline-offset-4"
          >
            Открыть мой профиль
          </a>
        </section>
      )}
    </div>
  )
}
