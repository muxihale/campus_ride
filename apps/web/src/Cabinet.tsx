import { useEffect, useState } from "react"
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
    description:
      "Здесь появятся предстоящие поездки, история бронирований и отзывы.",
  },
  {
    path: "driver",
    label: "Кабинет водителя",
    role: "DRIVER",
    description:
      "Здесь появятся созданные поездки, заявки пассажиров и статистика. Автомобили уже доступны в меню.",
  },
  {
    path: "admin",
    label: "Администрирование",
    role: "ADMIN",
    description:
      "Здесь появятся управление пользователями, поездками и модерация отзывов.",
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
          ...(user.roles.includes("DRIVER")
            ? [
                { path: "vehicles", label: "Мои автомобили" },
                { path: "rides/new", label: "Создать поездку" },
              ]
            : []),
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
      {current === "profile" ? (
        <ProfileScreen onSaved={onSaved} onExpired={onExpired} />
      ) : current === "vehicles" && user.roles.includes("DRIVER") ? (
        <VehiclesScreen onExpired={onExpired} />
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
        <section className="rounded-2xl border bg-card p-6 sm:p-8">
          <p className="text-sm text-muted-foreground">CampusRide · УрФУ</p>
          <h1 className="mt-2 text-2xl font-semibold">{destination.label}</h1>
          <p className="mt-5 max-w-xl leading-relaxed text-muted-foreground">
            {destination.description}
          </p>
          <div className="mt-6 rounded-xl border border-dashed p-5">
            <p className="text-sm font-medium">Раздел в разработке</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Уже сейчас вы можете заполнить контактные данные в профиле.
            </p>
            <a
              className="mt-4 inline-block text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
              href="#/profile"
            >
              Заполнить профиль
            </a>
          </div>
        </section>
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
