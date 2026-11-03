import { useEffect, useRef, useState, type FormEvent } from "react"
import { Button } from "@workspace/ui/components/button"
import { ApiError, apiRequest } from "./auth"
import type { Page } from "./ride-data"
import { ekaterinburgInput } from "./ride-form"

type Review = { id: string; rating: number; comment: string; createdAt: string }
const field =
  "mt-2 w-full min-w-0 rounded-lg border border-input bg-background px-3 py-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
export function PassengerReview({
  bookingId,
  driverName,
  onExpired,
}: {
  bookingId: string
  driverName: string
  onExpired: () => void
}) {
  const [revision, setRevision] = useState(0)
  const [lookup, setLookup] = useState<{
    revision: number
    review?: Review
    error?: string
  }>({ revision: -1 })
  const [saved, setSaved] = useState<Review | null>(null)
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState("")
  const [comment, setComment] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [conflict, setConflict] = useState(false)
  const busy = useRef(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    let cancelled = false
    apiRequest<Page<Review>>(
      `me/reviews?direction=sent&bookingId=${encodeURIComponent(bookingId)}&pageSize=1`
    )
      .then((data) => {
        if (!cancelled) setLookup({ revision, review: data.items[0] })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setLookup({
            revision,
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить отзыв",
          })
      })
    return () => {
      cancelled = true
    }
  }, [bookingId, revision, onExpired])
  const review = saved ?? lookup.review
  const loading = lookup.revision !== revision
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy.current || loading || review || conflict) return
    if (
      !/^[1-5]$/.test(rating) ||
      !comment.trim() ||
      [...comment.trim()].length > 1000
    ) {
      setError(
        "Выберите оценку от 1 до 5 и напишите комментарий от 1 до 1000 символов"
      )
      return
    }
    busy.current = true
    setPending(true)
    setError("")
    try {
      const data = await apiRequest<Review>(
        `bookings/${bookingId}/reviews`,
        "POST",
        { rating: Number(rating), comment: comment.trim() }
      )
      if (!active.current) return
      setSaved(data)
      setOpen(false)
    } catch (cause) {
      if (!active.current) return
      if (cause instanceof ApiError && cause.status === 401) onExpired()
      else {
        setError(
          cause instanceof Error ? cause.message : "Не удалось отправить отзыв"
        )
        if (cause instanceof ApiError && [404, 409].includes(cause.status)) {
          setOpen(false)
          setConflict(true)
          setRevision((value) => value + 1)
        }
      }
    } finally {
      busy.current = false
      if (active.current) setPending(false)
    }
  }
  return (
    <section
      className="min-w-0 space-y-3 rounded-xl border bg-muted/30 p-4"
      aria-label={`Отзыв водителю ${driverName}`}
    >
      <h3 className="font-semibold">Ваша оценка водителя</h3>
      {review ? (
        <>
          {saved && <p role="status">Отзыв отправлен. Спасибо за оценку!</p>}
          <p className="font-medium">Оценка: {review.rating} из 5</p>
          <p className="break-words whitespace-pre-wrap">{review.comment}</p>
          <p className="text-xs text-muted-foreground">
            {ekaterinburgInput(review.createdAt).replace("T", " ")} ·
            Екатеринбург
          </p>
        </>
      ) : loading ? (
        <p role="status">Проверяем оставленный отзыв…</p>
      ) : lookup.error ? (
        <>
          <p role="alert">{lookup.error}</p>
          <Button
            variant="outline"
            onClick={() => setRevision((value) => value + 1)}
          >
            Повторить загрузку отзыва
          </Button>
        </>
      ) : conflict ? (
        <p role="alert">
          {error} Обновите заявки, чтобы проверить доступность отзыва. Если
          отзыв скрыт, повторная оценка недоступна.
        </p>
      ) : open ? (
        <form
          onSubmit={submit}
          className="space-y-4"
          aria-label="Оценить водителя"
          noValidate
        >
          <p className="text-sm break-words">
            Водитель: {driverName}. Отзыв можно отправить один раз.
          </p>
          <fieldset disabled={pending} className="space-y-4">
            <label className="block text-sm font-medium">
              Оценка водителя
              <select
                className={field}
                value={rating}
                onChange={(event) => {
                  setRating(event.target.value)
                  setError("")
                }}
                required
              >
                <option value="">Выберите оценку</option>
                {[5, 4, 3, 2, 1].map((value) => (
                  <option key={value} value={value}>
                    {value} из 5
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Комментарий о поездке
              <textarea
                className={`${field} min-h-28 resize-y`}
                value={comment}
                maxLength={1000}
                required
                onChange={(event) => {
                  setComment(event.target.value)
                  setError("")
                }}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              До 1000 символов. Отзыв будет виден другим пользователям.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <Button
                type="submit"
                className="h-auto min-h-9 whitespace-normal"
                disabled={pending}
              >
                {pending ? "Отправляем отзыв…" : "Отправить отзыв"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  setError("")
                }}
              >
                Отмена
              </Button>
            </div>
          </fieldset>
        </form>
      ) : (
        <Button variant="outline" onClick={() => setOpen(true)}>
          Оценить водителя
        </Button>
      )}
    </section>
  )
}
