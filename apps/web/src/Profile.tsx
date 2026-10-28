import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest, type User } from "./auth"

export type Profile = User & { phone: string | null }
const inputClass =
  "mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-50"

type Props = { onSaved: (profile: Profile) => void; onExpired: () => void }
export function ProfileScreen({ onSaved, onExpired }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    let active = true
    apiRequest<Profile>("me")
      .then((result) => {
        if (active) setProfile(result)
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setError(
            cause instanceof Error
              ? cause.message
              : "Не удалось загрузить профиль"
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [retry, onExpired])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const fullName = String(data.get("fullName")).trim()
    setSaved(false)
    setError("")
    if (fullName.length < 2) {
      setError("Имя должно содержать от 2 до 100 символов")
      return
    }
    setSaving(true)
    try {
      const result = await apiRequest<Profile>("me", "PATCH", {
        fullName,
        phone: String(data.get("phone")).trim() || null,
        affiliation: String(data.get("affiliation")).trim() || null,
      })
      setProfile(result)
      onSaved(result)
      setSaved(true)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else
        setError(
          cause instanceof Error
            ? cause.message
            : "Не удалось сохранить профиль"
        )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      aria-labelledby="profile-title"
      className="min-w-0 rounded-2xl border bg-card p-6 sm:p-8"
    >
      <h1 id="profile-title" className="text-2xl font-semibold">
        Мой профиль
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Контактные данные для общения с попутчиками.
      </p>
      {loading ? (
        <p role="status" className="mt-6 text-sm">
          Загружаем профиль…
        </p>
      ) : profile ? (
        <form
          key={`${profile.fullName}:${profile.phone}:${profile.affiliation}`}
          onSubmit={(event) => void save(event)}
          onChange={() => setSaved(false)}
          className="mt-6 max-w-xl space-y-5"
          aria-busy={saving}
        >
          <fieldset disabled={saving} className="space-y-5">
            <label className="block text-sm font-medium">
              Имя и фамилия
              <input
                name="fullName"
                autoComplete="name"
                className={inputClass}
                defaultValue={profile.fullName}
                minLength={2}
                maxLength={100}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Email
              <input
                className={`${inputClass} text-muted-foreground`}
                value={profile.email}
                type="email"
                readOnly
                aria-describedby="email-hint"
              />
            </label>
            <p id="email-hint" className="text-xs text-muted-foreground">
              Email используется для входа. Его изменение пока недоступно.
            </p>
            <label className="block text-sm font-medium">
              Телефон
              <input
                name="phone"
                type="tel"
                autoComplete="tel"
                className={inputClass}
                defaultValue={profile.phone ?? ""}
                maxLength={32}
                placeholder="+7 (912) 345-67-89"
                aria-describedby="phone-hint"
              />
            </label>
            <p id="phone-hint" className="text-xs text-muted-foreground">
              Необязательно. Используйте цифры, пробелы, скобки, дефисы и + в
              начале.
            </p>
            <label className="block text-sm font-medium">
              Принадлежность к университету
              <input
                name="affiliation"
                autoComplete="organization"
                className={inputClass}
                defaultValue={profile.affiliation ?? ""}
                maxLength={200}
                placeholder="Студент ИРИТ-РТФ УрФУ"
              />
            </label>
            <Button type="submit" className="h-11 w-full sm:w-auto">
              {saving ? "Сохраняем…" : "Сохранить изменения"}
            </Button>
          </fieldset>
        </form>
      ) : (
        <Button
          className="mt-5"
          onClick={() => {
            setError("")
            setLoading(true)
            setRetry((value) => value + 1)
          }}
        >
          Повторить загрузку
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Профиль сохранён.
        </p>
      )}
    </section>
  )
}
