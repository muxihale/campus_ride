import { useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { Profile } from "./Profile"

type Props = {
  alreadyDriver: boolean
  onSaved: (profile: Profile) => void
  onExpired: () => void
}
const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"
const fields = [
  { name: "make", label: "Марка", placeholder: "Kia", maxLength: 60 },
  { name: "model", label: "Модель", placeholder: "Rio", maxLength: 60 },
  { name: "color", label: "Цвет", placeholder: "Белый", maxLength: 40 },
  {
    name: "registrationNumber",
    label: "Госномер",
    placeholder: "А123ВС196",
    maxLength: 20,
  },
]

export function BecomeDriver({ alreadyDriver, onSaved, onExpired }: Props) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const vehicle = Object.fromEntries(
      fields.map(({ name }) => [name, String(form.get(name)).trim()])
    )
    setError("")
    if (Object.values(vehicle).some((value) => !value)) {
      setError("Заполните все поля автомобиля")
      return
    }
    setPending(true)
    try {
      const profile = await apiRequest<Profile>("me/driver-profile", "POST", {
        bio: String(form.get("bio")).trim(),
        vehicle: {
          ...vehicle,
          passengerSeats: Number(form.get("passengerSeats")),
        },
      })
      setDone(true)
      onSaved(profile)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось подключить роль водителя"
        )
    } finally {
      setPending(false)
    }
  }

  if (done || alreadyDriver)
    return (
      <section className="rounded-2xl border bg-card p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">
          {done ? "Вы стали водителем" : "Вы уже водитель"}
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          Кабинет водителя доступен в меню. Роль пассажира сохраняется.
        </p>
        {done && (
          <p role="status" className="mt-3 text-sm">
            Профиль водителя и первый автомобиль сохранены.
          </p>
        )}
        <a
          href="#/driver"
          className="mt-6 inline-block text-sm font-medium underline underline-offset-4"
        >
          Открыть кабинет водителя
        </a>
      </section>
    )

  return (
    <section
      className="min-w-0 rounded-2xl border bg-card p-6 sm:p-8"
      aria-labelledby="driver-title"
    >
      <h1 id="driver-title" className="text-2xl font-semibold">
        Стать водителем
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Расскажите о себе и добавьте первый автомобиль. Вы сможете пользоваться
        и кабинетом пассажира.
      </p>
      <form
        onSubmit={(event) => void submit(event)}
        className="mt-6 space-y-5"
        aria-busy={pending}
      >
        <fieldset disabled={pending} className="space-y-5">
          <label className="block text-sm font-medium">
            О себе{" "}
            <span className="font-normal text-muted-foreground">
              (необязательно)
            </span>
            <textarea
              name="bio"
              maxLength={1000}
              rows={3}
              className={`${inputClass} h-auto py-3`}
              placeholder="Езжу в главный корпус по будням к 8:30."
            />
          </label>
          <h2 className="text-lg font-semibold">Первый автомобиль</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.name} className="block text-sm font-medium">
                {field.label}
                <input
                  name={field.name}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  className={inputClass}
                  required
                />
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Госномер легкового автомобиля РФ, например А123ВС196. Можно
            использовать кириллицу или латиницу.
          </p>
          <label className="block text-sm font-medium">
            Пассажирских мест
            <input
              name="passengerSeats"
              type="number"
              min={1}
              max={8}
              step={1}
              required
              defaultValue={3}
              className={inputClass}
              aria-describedby="seats-hint"
            />
          </label>
          <p id="seats-hint" className="text-xs text-muted-foreground">
            От 1 до 8, без места водителя.
          </p>
          <Button type="submit" className="h-11 w-full sm:w-auto">
            {pending ? "Подключаем…" : "Подключить роль водителя"}
          </Button>
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
