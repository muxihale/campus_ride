import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import type { User } from "./auth"
import type { PublicRideDetail } from "./PublicRide"
import { App } from "./App"
const passenger: User = {
  id: "passenger",
  email: "anna@example.ru",
  fullName: "Анна Соколова",
  roles: ["PASSENGER"],
  affiliation: null,
}
const id = "11111111-1111-4111-8111-111111111111"
const location = { id: "point", name: "Уралмаш", address: "Космонавтов" }
const ride: PublicRideDetail = {
  id,
  status: "PUBLISHED",
  origin: location,
  destination: { ...location, name: "УрФУ" },
  departureAt: "2099-11-09T03:30:00Z",
  availableSeats: 3,
  seatsTotal: 3,
  priceKopecks: 12050,
  conditions: null,
  musicAllowed: true,
  luggageAllowed: true,
  smokingAllowed: false,
  driver: {
    id: "driver",
    fullName: "Иван Петров",
    bio: null,
    rating: null,
    reviewCount: 0,
  },
  vehicle: { make: "Kia", model: "Rio", color: "Белый", passengerSeats: 3 },
  stops: [],
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
it("проходит поиск, бронирование, уведомление водителя, подтверждение и кабинет пассажира через интерфейс", async () => {
  let current: User | null = passenger
  let booked = false,
    confirmed = false
  const booking = () => ({
    id: "booking-id",
    rideId: id,
    passengerId: passenger.id,
    requestKey: "request-key",
    seats: 1,
    unitPriceKopecks: ride.priceKopecks,
    status: confirmed ? "CONFIRMED" : "PENDING",
    createdAt: "2099-11-01T00:00:00Z",
    cancellationReason: null,
    passenger: {
      id: passenger.id,
      fullName: passenger.fullName,
      affiliation: null,
    },
    ride: { ...ride, availableSeats: booked ? 2 : 3 },
  })
  const list = (items: unknown[]) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 10,
  })
  const fetchMock = vi.fn(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).split("?")[0]
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
      if (path === "/api/districts" || path === "/api/campuses")
        return json(list([]))
      if (path === "/api/rides") return json(list([ride]))
      if (path === `/api/rides/${id}`)
        return json({ ...ride, availableSeats: booked ? 2 : 3 })
      if (path === `/api/rides/${id}/bookings`) {
        booked = true
        return json(booking(), 201)
      }
      if (path === "/api/me/bookings" || path === "/api/me/ride-bookings")
        return json(list(booked ? [booking()] : []))
      if (path === "/api/bookings/booking-id/confirm") {
        confirmed = true
        return json(booking())
      }
      if (path === "/api/notifications") {
        const isDriver = current?.id === driver.id
        return json(
          list([
            {
              id: "notification-id",
              kind: isDriver ? "BOOKING_REQUEST" : "BOOKING_CONFIRMED",
              title: isDriver
                ? "Новая заявка на поездку"
                : "Заявка подтверждена",
              body: "Уралмаш → УрФУ. Мест: 1.",
              readAt: null,
              createdAt: "2099-11-01T00:00:00Z",
              resourceType: "booking",
              resourceId: "booking-id",
              link: isDriver ? "#/ride-bookings" : "#/bookings",
            },
          ])
        )
      }
      throw new Error(`Unexpected ${url}`)
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(null, "", "/#/search?date=2099-11-09")
  render(<App />)
  await userEvent.click(
    await screen.findByRole("link", { name: /^Подробнее:/ })
  )
  await userEvent.click(
    await screen.findByRole("button", { name: "Забронировать места" })
  )
  await screen.findByText("Заявка отправлена. Ожидает подтверждения водителем.")
  await userEvent.click(
    screen.getByRole("link", { name: "Открыть мои заявки" })
  )
  await screen.findByText("Заявка: Ожидает подтверждения")
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
    await userEvent.click(screen.getByRole("link", { name: "Уведомления" }))
  }
  await loginAs(driver)
  await screen.findByRole("heading", { name: "Новая заявка на поездку" })
  await userEvent.click(
    screen.getByRole("link", { name: "Открыть связанный раздел" })
  )
  await userEvent.click(
    await screen.findByRole("button", { name: "Подтвердить" })
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить заявку" })
  )
  await screen.findByText("Заявка: Подтверждена")
  await loginAs(passenger)
  await screen.findByRole("heading", { name: "Заявка подтверждена" })
  await userEvent.click(
    screen.getByRole("link", { name: "Открыть связанный раздел" })
  )
  await screen.findByText("Заявка: Подтверждена")
  await userEvent.selectOptions(screen.getByLabelText("Раздел"), "upcoming")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего заявок: 1")
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).includes("period=upcoming")
    )
  ).toBe(true)
}, 15000)
