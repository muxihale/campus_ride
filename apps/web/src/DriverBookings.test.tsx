import {
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
const base: OwnBooking = {
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

const row: OwnBooking = {
  ...base,
  status: "PENDING",
  passenger: {
    id: "passenger",
    fullName: "Мария Лебедева",
    affiliation: "ИРИТ-РТФ",
  },
  ride: { ...base.ride, availableSeats: 1 },
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (item = row) => ({
  items: [item],
  total: 1,
  page: 1,
  pageSize: 10,
})
const fetchMock = vi.fn<typeof fetch>(),
  onExpired = vi.fn()
async function start(item = row) {
  fetchMock.mockImplementation(async () => json(page(item)))
  vi.stubGlobal("fetch", fetchMock)
  render(<BookingsScreen driver onExpired={onExpired} />)
  await screen.findByText("Всего заявок: 1")
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  onExpired.mockReset()
  window.history.replaceState(null, "", "/")
})
it("загружает заявки водителя, показывает пассажира и свободные места", async () => {
  await start()
  expect(fetchMock.mock.calls[0]![0]).toBe(
    "/api/me/ride-bookings?page=1&pageSize=10"
  )
  expect(
    screen.getByRole("heading", { name: "Заявки пассажиров" })
  ).toBeTruthy()
  expect(screen.getByText("Пассажир: Мария Лебедева")).toBeTruthy()
  expect(screen.getByText("ИРИТ-РТФ")).toBeTruthy()
  expect(screen.getByText("Свободных мест в поездке: 1")).toBeTruthy()
})
it("подтверждает только после явного действия и обновляет список", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
  fetchMock
    .mockResolvedValueOnce(json({ status: "CONFIRMED" }))
    .mockResolvedValueOnce(json(page({ ...row, status: "CONFIRMED" })))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить заявку" })
  )
  await screen.findByText("Заявка: Подтверждена")
  expect(screen.getByText("Заявка подтверждена.")).toBeTruthy()
  const [url, init] = fetchMock.mock.calls[1]!
  expect(url).toBe(`/api/bookings/${row.id}/confirm`)
  expect(init?.method).toBe("POST")
  expect(init?.body).toBe("{}")
  expect(screen.queryByRole("button", { name: "Отклонить" })).toBeNull()
})
it("отклоняет с причиной и обновляет статус и свободные места", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Отклонить" }))
  await userEvent.type(
    screen.getByLabelText("Причина отклонения"),
    "  Изменился маршрут  "
  )
  fetchMock
    .mockResolvedValueOnce(json({ status: "REJECTED" }))
    .mockResolvedValueOnce(
      json(
        page({
          ...row,
          status: "REJECTED",
          cancellationReason: "Изменился маршрут",
          ride: { ...row.ride, availableSeats: 3 },
        })
      )
    )
  await userEvent.click(
    screen.getByRole("button", { name: "Отклонить заявку" })
  )
  await screen.findByText("Заявка: Отклонена")
  expect(screen.getByText("Свободных мест в поездке: 3")).toBeTruthy()
  expect(JSON.parse(String(fetchMock.mock.calls[1]![1]?.body))).toEqual({
    reason: "Изменился маршрут",
  })
})
it("отклоняет пустую после trim причину без запроса", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Отклонить" }))
  await userEvent.type(screen.getByLabelText("Причина отклонения"), "   ")
  await userEvent.click(
    screen.getByRole("button", { name: "Отклонить заявку" })
  )
  expect(screen.getByRole("alert").textContent).toContain("от 1 до 500")
  expect(fetchMock).toHaveBeenCalledTimes(1)
})
it("не отправляет два решения при двойной отправке", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
  let resolve!: (response: Response) => void
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      })
  )
  const form = screen.getByRole("form", { name: "Решение по заявке" })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(
    (
      screen.getByRole("button", {
        name: "Сохраняем решение…",
      }) as HTMLButtonElement
    ).disabled
  ).toBe(true)
  resolve(json({ status: "CONFIRMED" }))
  await screen.findByText("Заявка подтверждена.")
})
it("при конфликте показывает ошибку и перечитывает изменившуюся заявку", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
  fetchMock
    .mockResolvedValueOnce(json({ message: "Заявка уже отменена" }, 409))
    .mockResolvedValueOnce(json(page({ ...row, status: "CANCELLED" })))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить заявку" })
  )
  await screen.findByText("Заявка: Отменена")
  expect(screen.getByRole("alert").textContent).toContain("уже отменена")
  expect(screen.queryByRole("form", { name: "Решение по заявке" })).toBeNull()
})
it("сохраняет причину после ошибки и позволяет повторить решение", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Отклонить" }))
  await userEvent.type(
    screen.getByLabelText("Причина отклонения"),
    "Изменился маршрут"
  )
  fetchMock.mockRejectedValueOnce(new TypeError("Offline"))
  await userEvent.click(
    screen.getByRole("button", { name: "Отклонить заявку" })
  )
  await screen.findByRole("alert")
  expect(
    (screen.getByLabelText("Причина отклонения") as HTMLTextAreaElement).value
  ).toBe("Изменился маршрут")
  fetchMock
    .mockResolvedValueOnce(json({ status: "REJECTED" }))
    .mockResolvedValueOnce(json(page({ ...row, status: "REJECTED" })))
  await userEvent.click(
    screen.getByRole("button", { name: "Отклонить заявку" })
  )
  await screen.findByText("Заявка: Отклонена")
})
it.each([
  { ...row, status: "CONFIRMED" },
  { ...row, ride: { ...row.ride, status: "COMPLETED" } },
  { ...row, ride: { ...row.ride, departureAt: "2020-01-01T00:00:00Z" } },
])(
  "скрывает решения для неподходящих статусов или прошедшей поездки",
  async (item) => {
    await start(item)
    expect(screen.queryByRole("button", { name: "Подтвердить" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Отклонить" })).toBeNull()
  }
)
it("возвращает вход при истечении сессии во время решения", async () => {
  await start()
  await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
  fetchMock.mockResolvedValueOnce(json({ message: "Войдите" }, 401))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить заявку" })
  )
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
})
it("сохраняет применённые фильтры при обновлении после решения", async () => {
  await start()
  await userEvent.selectOptions(
    screen.getByLabelText("Статус заявки"),
    "PENDING"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего заявок: 1")
  await userEvent.click(screen.getByRole("button", { name: "Подтвердить" }))
  fetchMock
    .mockResolvedValueOnce(json({ status: "CONFIRMED" }))
    .mockResolvedValueOnce(json({ items: [], total: 0, page: 1, pageSize: 10 }))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить заявку" })
  )
  await screen.findByText("Всего заявок: 0")
  expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("status=PENDING")
})
it("прямой маршрут кабинета доступен водителю", async () => {
  fetchMock.mockImplementation(async (url) =>
    json(
      String(url) === "/api/auth/me"
        ? {
            id: "driver",
            email: "driver@example.ru",
            fullName: "Иван Петров",
            roles: ["DRIVER"],
            affiliation: null,
          }
        : page()
    )
  )
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(null, "", "/#/ride-bookings")
  render(<App />)
  await screen.findByRole("heading", { name: "Заявки пассажиров" })
  expect(
    screen
      .getByRole("link", { name: "Заявки пассажиров" })
      .getAttribute("aria-current")
  ).toBe("page")
})
