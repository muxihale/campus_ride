import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "./App"
import type { User } from "./auth"
const passenger: User = {
  id: "passenger",
  email: "anna@example.ru",
  fullName: "Анна Соколова",
  roles: ["PASSENGER"],
  affiliation: null,
}
const driver: User = {
  ...passenger,
  id: "driver",
  email: "driver@example.ru",
  fullName: "Иван Петров",
  roles: ["DRIVER"],
}
const json = (data: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(data), { status })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
it("после завершения участники оставляют встречные отзывы и открывают рейтинги из уведомлений", async () => {
  let current: User | null = passenger
  const reviews: {
    id: string
    bookingId: string
    authorId: string
    recipientId: string
    author: { fullName: string }
    recipient: { fullName: string }
    recipientRole: string
    rating: number
    comment: string
    createdAt: string
  }[] = []
  const booking = {
    id: "booking-id",
    rideId: "ride-id",
    status: "COMPLETED",
    seats: 1,
    unitPriceKopecks: 15000,
    cancellationReason: null,
    createdAt: "2026-11-03T03:00:00Z",
    passenger: { ...passenger },
    ride: {
      id: "ride-id",
      status: "COMPLETED",
      departureAt: "2026-11-03T03:00:00Z",
      origin: { name: "Уралмаш", address: "Космонавтов" },
      destination: { name: "УрФУ", address: "Мира, 19" },
      driver: { ...driver },
      vehicle: { make: "Kia", model: "Rio", color: "Белый" },
    },
  }
  const page = (items: unknown[]) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 10,
  })
  const mock = vi.fn<typeof fetch>(async (url, init) => {
    const parsed = new URL(String(url), "http://localhost"),
      path = parsed.pathname
    if (path === "/api/auth/me") return json(current, current ? 200 : 401)
    if (path === "/api/auth/logout") {
      current = null
      return json(null, 204)
    }
    if (path === "/api/auth/login") {
      current =
        JSON.parse(String(init?.body)).email === driver.email
          ? driver
          : passenger
      return json(current)
    }
    if (path === "/api/me/bookings" || path === "/api/me/ride-bookings")
      return json(page([booking]))
    if (path === "/api/bookings/booking-id/reviews") {
      const body = JSON.parse(String(init?.body))
      const isDriver = current?.id === driver.id,
        recipient = isDriver ? passenger : driver
      const row = {
        ...body,
        id: `review-${reviews.length}`,
        bookingId: booking.id,
        authorId: current!.id,
        recipientId: recipient.id,
        author: { fullName: current!.fullName },
        recipient: { fullName: recipient.fullName },
        recipientRole: isDriver ? "PASSENGER" : "DRIVER",
        createdAt: "2026-11-03T04:00:00Z",
      }
      reviews.push(row)
      return json(row, 201)
    }
    if (path === "/api/me/reviews")
      return json(
        page(
          reviews.filter((row) =>
            parsed.searchParams.get("direction") === "sent"
              ? row.authorId === current?.id
              : row.recipientId === current?.id
          )
        )
      )
    if (path.endsWith("/ratings")) {
      const received = reviews.filter((row) => row.recipientId === current?.id)
      const rating = (role: string) => {
        const row = received.find((item) => item.recipientRole === role)
        return { average: row?.rating ?? null, count: row ? 1 : 0 }
      }
      return json({ driver: rating("DRIVER"), passenger: rating("PASSENGER") })
    }
    if (path === "/api/notifications")
      return json(
        page(
          reviews
            .filter((row) => row.recipientId === current?.id)
            .map((row) => ({
              id: row.id,
              kind: "REVIEW_RECEIVED",
              title: "Вы получили новый отзыв",
              body: `Оценка: ${row.rating} из 5`,
              link: "#/reviews",
              resourceType: "review",
              resourceId: row.id,
              createdAt: row.createdAt,
              readAt: null,
            }))
        )
      )
    throw new Error(`Неожиданный запрос ${url}`)
  })
  vi.stubGlobal("fetch", mock)
  window.history.replaceState(null, "", "/#/bookings")
  render(<App />)
  await screen.findByText("Заявка: Завершена")
  await userEvent.selectOptions(screen.getByLabelText("Раздел"), "history")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  async function submitReview(label: string, rating: string, text: string) {
    await userEvent.click(
      await screen.findByRole("button", { name: `Оценить ${label}` })
    )
    await userEvent.selectOptions(
      screen.getByLabelText(`Оценка ${label}`),
      rating
    )
    await userEvent.type(screen.getByLabelText("Комментарий о поездке"), text)
    await userEvent.click(
      screen.getByRole("button", { name: "Отправить отзыв" })
    )
    await screen.findByText("Отзыв отправлен. Спасибо за оценку!")
  }
  async function loginAs(user: User) {
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }))
    await screen.findByRole("heading", { name: "С возвращением" })
    await userEvent.type(screen.getByLabelText("Email"), user.email)
    await userEvent.type(
      screen.getByLabelText("Пароль"),
      "CampusRide-demo-2026"
    )
    await userEvent.click(screen.getByRole("button", { name: "Войти" }))
    await screen.findByRole("link", { name: "Уведомления" })
  }
  async function openReceived() {
    await userEvent.click(screen.getByRole("link", { name: "Уведомления" }))
    await screen.findByRole("heading", { name: "Вы получили новый отзыв" })
    await userEvent.click(
      screen.getByRole("link", { name: "Открыть связанный раздел" })
    )
    await screen.findByRole("heading", { name: "Полученные отзывы" })
  }
  await submitReview(
    "водителя",
    "5",
    "Комфортная поездка, водитель приехал вовремя."
  )
  await userEvent.click(screen.getByRole("link", { name: "Отзывы и рейтинги" }))
  await screen.findByText("Всего отзывов: 0")
  await userEvent.selectOptions(screen.getByLabelText("Раздел отзывов"), "sent")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Кому: Иван Петров")
  await loginAs(driver)
  await openReceived()
  await screen.findByText("5 из 5 · Отзывов: 1")
  await userEvent.click(screen.getByRole("link", { name: "Заявки пассажиров" }))
  await submitReview("пассажира", "4", "Пассажир был на месте вовремя.")
  await loginAs(passenger)
  await openReceived()
  await screen.findByText("4 из 5 · Отзывов: 1")
  await screen.findByText("От: Иван Петров")
  await userEvent.click(screen.getByRole("link", { name: "Мои заявки" }))
  await screen.findByText("Оценка: 5 из 5")
  expect(screen.queryByRole("button", { name: "Оценить водителя" })).toBeNull()
  expect(reviews).toHaveLength(2)
  expect(
    mock.mock.calls.filter(
      ([, init]) =>
        init?.method === "POST" && String(init.body).includes('"rating"')
    )
  ).toHaveLength(2)
}, 15000)
