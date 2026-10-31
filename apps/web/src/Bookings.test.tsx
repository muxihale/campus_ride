import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { BookingsScreen, type OwnBooking } from "./Bookings"
import { App } from "./App"
const row: OwnBooking = {
  id: "booking-one",
  rideId: "11111111-1111-4111-8111-111111111111",
  status: "CONFIRMED",
  seats: 2,
  unitPriceKopecks: 12050,
  cancellationReason: null,
  createdAt: "2099-11-01T00:00:00Z",
  ride: {
    id: "ride",
    status: "PUBLISHED",
    departureAt: "2099-11-09T03:30:00Z",
    origin: { id: "a", name: "Уралмаш", address: "Космонавтов" },
    destination: { id: "b", name: "УрФУ", address: "Мира, 19" },
    driver: { id: "driver", fullName: "Иван Петров" },
    vehicle: { make: "Kia", model: "Rio", color: "Белый" },
  },
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (items = [row], total = items.length, current = 1) => ({
  items,
  total,
  page: current,
  pageSize: 10,
})
const onExpired = vi.fn()
const fetchMock = vi.fn<typeof fetch>()
async function start(data = page()) {
  fetchMock.mockImplementation(async () => json(data))
  vi.stubGlobal("fetch", fetchMock)
  render(<BookingsScreen onExpired={onExpired} />)
  await screen.findByText(`Всего заявок: ${data.total}`)
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  onExpired.mockReset()
  window.history.replaceState(null, "", "/")
})
it("показывает маршрут, время Екатеринбурга, цену заявки, сумму, статус и ссылку", async () => {
  await start()
  expect(screen.getByRole("heading", { name: "Уралмаш → УрФУ" })).toBeTruthy()
  for (const text of [
    "Заявка: Подтверждена",
    "Поездка: Опубликована",
    "2099-11-09 08:30 · Екатеринбург",
    "Водитель: Иван Петров",
    "Мест: 2 · Цена места: 120,50 ₽ · Сумма: 241,00 ₽",
  ])
    expect(screen.getByText(text)).toBeTruthy()
  expect(
    screen
      .getByRole("link", { name: "Публичная карточка поездки" })
      .getAttribute("href")
  ).toBe(`#/ride/${row.rideId}`)
})
it("отправляет поисковый текст и фильтры, переводит рубли в копейки и время в UTC+5", async () => {
  await start()
  await userEvent.type(
    screen.getByLabelText("Поиск по маршруту, водителю или автомобилю"),
    "Уралмаш"
  )
  await userEvent.selectOptions(screen.getByLabelText("Раздел"), "upcoming")
  await userEvent.selectOptions(
    screen.getByLabelText("Статус заявки"),
    "CONFIRMED"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Статус поездки"),
    "PUBLISHED"
  )
  await userEvent.type(screen.getByLabelText("Минимум мест в заявке"), "2")
  await userEvent.type(
    screen.getByLabelText("Максимальная цена места, ₽"),
    "150,15"
  )
  fireEvent.change(screen.getByLabelText("Отправление от"), {
    target: { value: "2099-11-09T08:00" },
  })
  await userEvent.selectOptions(
    screen.getByLabelText("Сортировка"),
    "createdDesc"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const params = new URLSearchParams(
    String(fetchMock.mock.calls[1]![0]).split("?")[1]
  )
  expect(Object.fromEntries(params)).toEqual({
    q: "Уралмаш",
    period: "upcoming",
    status: "CONFIRMED",
    rideStatus: "PUBLISHED",
    minSeats: "2",
    maxPriceKopecks: "15015",
    departureFrom: "2099-11-09T08:00:00+05:00",
    sort: "createdDesc",
    page: "1",
    pageSize: "10",
  })
})
it("сохраняет фильтры при пагинации, сбрасывает страницу и фильтры", async () => {
  await start(page([row], 21))
  await userEvent.selectOptions(screen.getByLabelText("Раздел"), "history")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего заявок: 21")
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await waitFor(() =>
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(
      "period=history&sort=departureAsc&page=2"
    )
  )
  await screen.findByText("Всего заявок: 21")
  await userEvent.click(
    screen.getByRole("button", { name: "Сбросить фильтры" })
  )
  await waitFor(() =>
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(
      "/api/me/bookings?page=1&pageSize=10"
    )
  )
  expect((screen.getByLabelText("Раздел") as HTMLSelectElement).value).toBe(
    "all"
  )
})
it("сохраняет данные закрытой поездки и причину отказа, показывает нулевую цену", async () => {
  await start(
    page([
      {
        ...row,
        status: "REJECTED",
        unitPriceKopecks: 0,
        cancellationReason: "Изменился маршрут",
        ride: { ...row.ride, status: "CANCELLED" },
      },
    ])
  )
  expect(screen.getByText("Причина: Изменился маршрут")).toBeTruthy()
  expect(screen.getByText("Поездка: Отменена")).toBeTruthy()
  expect(
    screen.getByText("Мест: 2 · Цена места: 0,00 ₽ · Сумма: 0,00 ₽")
  ).toBeTruthy()
})
it("различает отсутствие заявок и отсутствие совпадений", async () => {
  await start(page([]))
  expect(screen.getByText("У вас пока нет заявок.")).toBeTruthy()
  await userEvent.selectOptions(
    screen.getByLabelText("Статус заявки"),
    "REJECTED"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  expect(
    await screen.findByText("Нет заявок по выбранным условиям.")
  ).toBeTruthy()
})
it("проверяет диапазон до запроса, допускает прошлые даты истории", async () => {
  await start()
  fireEvent.change(screen.getByLabelText("Отправление от"), {
    target: { value: "2020-11-10T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Отправление до"), {
    target: { value: "2020-11-09T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  expect(screen.getByRole("alert").textContent).toContain("Начало диапазона")
  expect(fetchMock).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText("Отправление до"), {
    target: { value: "2020-11-11T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
})
it("повторяет чтение после ошибки", async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockImplementation(async () => json(page()))
  vi.stubGlobal("fetch", fetchMock)
  render(<BookingsScreen onExpired={onExpired} />)
  await screen.findByRole("alert")
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  expect(await screen.findByText("Всего заявок: 1")).toBeTruthy()
})
it("возвращает вход при недействующей сессии", async () => {
  fetchMock.mockResolvedValue(json({ message: "Войдите" }, 401))
  vi.stubGlobal("fetch", fetchMock)
  render(<BookingsScreen onExpired={onExpired} />)
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
})
it("возвращается к доступной странице при сокращении списка", async () => {
  await start(page([row], 11))
  fetchMock.mockImplementation(async (url) =>
    json(String(url).includes("page=2") ? page([], 1, 2) : page())
  )
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await screen.findByText("Страница 1 из 1")
  expect(fetchMock.mock.calls.at(-1)![0]).toBe(
    "/api/me/bookings?page=1&pageSize=10"
  )
})
it("прямая ссылка в кабинете загружает список пассажира", async () => {
  fetchMock.mockImplementation(async (url) =>
    json(
      String(url) === "/api/auth/me"
        ? {
            id: "passenger",
            email: "anna@example.ru",
            fullName: "Анна Соколова",
            roles: ["PASSENGER"],
            affiliation: null,
          }
        : page()
    )
  )
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(null, "", "/#/bookings")
  render(<App />)
  expect(
    await screen.findByRole("heading", { name: "Мои заявки" })
  ).toBeTruthy()
  await screen.findByText("Всего заявок: 1")
  expect(
    screen
      .getByRole("link", { name: "Мои заявки" })
      .getAttribute("aria-current")
  ).toBe("page")
})

it("игнорирует устаревший ответ после смены фильтров", async () => {
  let resolve!: (response: Response) => void
  fetchMock
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    .mockImplementation(async () =>
      json(page([{ ...row, status: "REJECTED" }]))
    )
  vi.stubGlobal("fetch", fetchMock)
  render(<BookingsScreen onExpired={onExpired} />)
  await userEvent.selectOptions(
    screen.getByLabelText("Статус заявки"),
    "REJECTED"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Заявка: Отклонена")
  await act(async () => {
    resolve(json(page()))
  })
  expect(screen.queryByText("Заявка: Подтверждена")).toBeNull()
})
it("аккаунту без роли пассажира не открывает список и не запрашивает API заявок", async () => {
  fetchMock.mockImplementation(async () =>
    json({
      id: "admin",
      email: "admin@example.ru",
      fullName: "Анна Соколова",
      roles: ["ADMIN"],
      affiliation: null,
    })
  )
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(null, "", "/#/bookings")
  render(<App />)
  await screen.findByRole("heading", { name: "Раздел недоступен" })
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith("/api/me/bookings")
    )
  ).toBe(false)
})
