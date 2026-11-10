import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { PublicRideScreen, type PublicRideDetail } from "./PublicRide"
import type { User } from "./auth"
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
const booking = {
  id: "booking-id",
  rideId: id,
  passengerId: passenger.id,
  seats: 2,
  unitPriceKopecks: 12050,
  status: "PENDING",
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
async function start(
  user: User | null = passenger,
  options: { price?: number; onExpired?: () => void; query?: string } = {}
) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      json({ ...ride, priceKopecks: options.price ?? ride.priceKopecks })
    )
  vi.stubGlobal("fetch", fetchMock)
  render(
    <PublicRideScreen
      id={id}
      query={options.query ?? ""}
      user={user}
      onExpired={options.onExpired}
    />
  )
  await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
  return fetchMock
}
it("подставляет число мест из параметров поиска", async () => {
  await start(passenger, {
    query: `search=${encodeURIComponent("minSeats=2&page=1")}`,
  })
  expect(
    (screen.getByLabelText("Количество мест") as HTMLSelectElement).value
  ).toBe("2")
  expect(screen.getByText("Итого: 241,00 ₽")).toBeTruthy()
})
it("выбирает места, считает итог, отправляет только seats и requestKey, обновляет остаток", async () => {
  const fetchMock = await start()
  await userEvent.selectOptions(screen.getByLabelText("Количество мест"), "2")
  expect(screen.getByText("Итого: 241,00 ₽")).toBeTruthy()
  fetchMock
    .mockResolvedValueOnce(json({ ...booking, unitPriceKopecks: 10000 }, 201))
    .mockResolvedValueOnce(json({ ...ride, availableSeats: 1 }))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  expect(
    await screen.findByText(
      "Заявка отправлена. Ожидает подтверждения водителем."
    )
  ).toBeTruthy()
  expect(screen.getByText("Стоимость заявки: 200,00 ₽")).toBeTruthy()
  await screen.findByText("1", { selector: "strong" })
  const [url, init] = fetchMock.mock.calls[1]!
  expect(url).toBe(`/api/rides/${id}/bookings`)
  expect(init?.method).toBe("POST")
  expect(JSON.parse(String(init?.body))).toEqual({
    seats: 2,
    requestKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
  })
  expect(
    screen.queryByRole("button", { name: "Забронировать места" })
  ).toBeNull()
})
it("при неизвестном результате повторяет тот же ключ и число мест", async () => {
  const fetchMock = await start()
  await userEvent.selectOptions(screen.getByLabelText("Количество мест"), "2")
  fetchMock.mockRejectedValueOnce(new TypeError("Lost response"))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  await screen.findByRole("alert")
  expect(
    (screen.getByLabelText("Количество мест") as HTMLSelectElement).disabled
  ).toBe(true)
  fetchMock
    .mockResolvedValueOnce(json(booking, 200))
    .mockResolvedValueOnce(json({ ...ride, availableSeats: 1 }))
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить отправку" })
  )
  await screen.findByText("Стоимость заявки: 241,00 ₽")
  expect(fetchMock.mock.calls[1]![1]?.body).toBe(
    fetchMock.mock.calls[2]![1]?.body
  )
})
it("не отправляет две заявки при двойной отправке формы", async () => {
  const fetchMock = await start()
  let resolve!: (response: Response) => void
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const button = screen.getByRole("button", { name: "Забронировать места" })
  fireEvent.submit(button.closest("form")!)
  fireEvent.submit(button.closest("form")!)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(
    (
      screen.getByRole("button", {
        name: "Отправляем заявку…",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  resolve(json({ ...booking, seats: 1 }, 201))
  await screen.findByText("Мест в заявке: 1")
})
it("сохраняет успешную заявку, когда после резервирования всех мест API карточки даёт 404", async () => {
  const fetchMock = await start()
  await userEvent.selectOptions(screen.getByLabelText("Количество мест"), "3")
  fetchMock
    .mockResolvedValueOnce(json({ ...booking, seats: 3 }, 201))
    .mockResolvedValueOnce(json({ message: "Недоступно" }, 404))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  await screen.findByText("0", { selector: "strong" })
  expect(screen.getByText("Мест в заявке: 3")).toBeTruthy()
  expect(
    screen.queryByRole("heading", { name: "Поездка недоступна" })
  ).toBeNull()
})
it("после конфликта обновляет остаток, ограничивает выбор и разрешает новую попытку", async () => {
  const fetchMock = await start()
  await userEvent.selectOptions(screen.getByLabelText("Количество мест"), "3")
  fetchMock
    .mockResolvedValueOnce(
      json({ message: "Недостаточно свободных мест" }, 409)
    )
    .mockResolvedValueOnce(json({ ...ride, availableSeats: 1 }))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Количество мест") as HTMLSelectElement).value
    ).toBe("1")
  )
  expect(screen.getByRole("alert").textContent).toContain("Недостаточно")
  expect(screen.getAllByRole("option")).toHaveLength(1)
  fetchMock
    .mockResolvedValueOnce(json({ ...booking, seats: 1 }, 201))
    .mockResolvedValueOnce(json({ ...ride, availableSeats: 0 }))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  await screen.findByText("Мест в заявке: 1")
  expect(
    JSON.parse(String(fetchMock.mock.calls[1]![1]?.body)).requestKey
  ).not.toBe(JSON.parse(String(fetchMock.mock.calls[3]![1]?.body)).requestKey)
})
it("не теряет успешную заявку при сбое обновления остатка", async () => {
  const fetchMock = await start()
  fetchMock
    .mockResolvedValueOnce(json({ ...booking, seats: 1 }, 201))
    .mockRejectedValueOnce(new TypeError("Offline"))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  await screen.findByText(
    "Не удалось обновить свободные места. Повторите обновление."
  )
  expect(screen.getByText("Мест в заявке: 1")).toBeTruthy()
  fetchMock.mockResolvedValueOnce(json({ ...ride, availableSeats: 2 }))
  await userEvent.click(
    screen.getByRole("button", { name: "Обновить свободные места" })
  )
  await screen.findByText("2", { selector: "strong" })
  expect(
    fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
  ).toHaveLength(1)
})
it("для бесплатной поездки показывает нулевой итог", async () => {
  await start(passenger, { price: 0 })
  expect(screen.getByText("Итого: 0,00 ₽")).toBeTruthy()
})
it("гостю предлагает вход с возвратом к карточке", async () => {
  await start(null)
  const href = screen
    .getByRole("link", { name: "Войти для бронирования" })
    .getAttribute("href")!
  expect(new URLSearchParams(href.split("?")[1]).get("returnTo")).toBe(
    `#/ride/${id}`
  )
  expect(
    screen.queryByRole("button", { name: "Забронировать места" })
  ).toBeNull()
})
it.each([
  { ...passenger, id: "driver" },
  { ...passenger, roles: ["ADMIN"] as User["roles"] },
])("не даёт бронировать свою поездку или без роли пассажира", async (user) => {
  await start(user)
  expect(screen.queryByLabelText("Количество мест")).toBeNull()
})
it("обрабатывает истечение сессии", async () => {
  const onExpired = vi.fn(),
    fetchMock = await start(passenger, { onExpired })
  fetchMock.mockResolvedValueOnce(json({ message: "Сессия истекла" }, 401))
  await userEvent.click(
    screen.getByRole("button", { name: "Забронировать места" })
  )
  await screen.findByRole("alert")
  expect(onExpired).toHaveBeenCalledOnce()
})
it("после входа возвращает гостя к исходной карточке", async () => {
  const returnTo = `#/ride/${id}?search=${encodeURIComponent("date=2099-11-09&page=2&sort=priceAsc")}`
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === "/api/auth/me") return json({ message: "Войдите" }, 401)
    if (path === "/api/auth/login") return json(passenger)
    if (path === `/api/rides/${id}`) return json(ride)
    throw new Error(path)
  })
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(
    null,
    "",
    `/#/login?returnTo=${encodeURIComponent(returnTo)}`
  )
  render(<App />)
  await screen.findByRole("heading", { name: "С возвращением" })
  await userEvent.type(screen.getByLabelText("Email"), passenger.email)
  await userEvent.type(screen.getByLabelText("Пароль"), "CampusRide-demo-2026")
  await userEvent.click(screen.getByRole("button", { name: "Войти" }))
  await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
  expect(window.location.hash).toBe(returnTo)
  expect(
    screen
      .getByRole("link", { name: "Вернуться к результатам" })
      .getAttribute("href")
  ).toBe("#/search?date=2099-11-09&page=2&sort=priceAsc")
  expect(screen.getByLabelText("Количество мест")).toBeTruthy()
})
