import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { CabinetHome } from "./CabinetHome"
import {
  DriverStatisticsPanel,
  type DriverStatistics,
} from "./DriverStatistics"
import { Cabinet } from "./Cabinet"
const statistics: DriverStatistics = {
  dateFrom: null,
  dateTo: null,
  periodBasis: "departureAt",
  isDemo: true,
  currency: "RUB",
  ridesTotal: 6,
  draftRides: 1,
  publishedRides: 1,
  inProgressRides: 1,
  completedRides: 2,
  cancelledRides: 1,
  completedBookings: 3,
  passengersTransported: 2,
  seatsTransported: 4,
  cancelledBookings: 2,
  rejectedBookings: 1,
  demoReceiptsKopecks: "95000",
  demoCompletedRevenueKopecks: "45000",
  demoRefundsKopecks: "24000",
}
const booking = {
  id: "booking",
  rideId: "ride",
  status: "CONFIRMED",
  seats: 2,
  ride: {
    id: "ride",
    status: "PUBLISHED",
    departureAt: "2099-11-09T03:30:00Z",
    origin: { name: "Уралмаш", address: "Космонавтов" },
    destination: { name: "УрФУ", address: "Мира, 19" },
    driver: { fullName: "Иван Петров" },
  },
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const mock = vi.fn<typeof fetch>(),
  expired = vi.fn()
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mock.mockReset()
  expired.mockReset()
  window.history.replaceState(null, "", "/")
})
async function driver(data = statistics) {
  mock.mockImplementation(async () => json(data))
  vi.stubGlobal("fetch", mock)
  const view = render(<CabinetHome role="driver" onExpired={expired} />)
  await screen.findByText("Все даты отправления")
  return view
}
it("водитель видит реальные показатели и рабочие быстрые переходы", async () => {
  await driver()
  expect(mock.mock.calls[0]?.[0]).toBe("/api/me/driver-statistics")
  expect(
    screen.getByText("Уникальные пассажиры").nextElementSibling?.textContent
  ).toBe("2")
  expect(
    screen.getByText("Перевезённые места").nextElementSibling?.textContent
  ).toBe("4")
  expect(
    screen
      .getByText("Демо-поступления")
      .nextElementSibling?.textContent?.replace(/\s/g, "")
  ).toBe("950,00₽")
  expect(
    screen
      .getByRole("link", { name: "Открыть заявки пассажиров" })
      .getAttribute("href")
  ).toBe("#/ride-bookings")
  expect(screen.queryByText("Статистика появится позже.")).toBeNull()
  for (const name of [
    "Настроить профиль",
    "Открыть уведомления",
    "Открыть отзывы и рейтинги",
    "Открыть историю действий",
  ])
    expect(screen.getByRole("link", { name })).toBeTruthy()
})
it("сохраняет точность очень большой денежной суммы", async () => {
  await driver({ ...statistics, demoReceiptsKopecks: "900719925474099301" })
  expect(
    screen
      .getByText("Демо-поступления")
      .nextElementSibling?.textContent?.replace(/\s/g, "")
  ).toBe("9007199254740993,01₽")
})
it("передаёт период отправления Екатеринбурга и умеет сбросить его", async () => {
  await driver()
  fireEvent.change(screen.getByLabelText("Отправление от"), {
    target: { value: "2026-11-01T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Отправление до"), {
    target: { value: "2026-11-05T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить период" })
  )
  await screen.findByText("Все даты отправления")
  expect(
    Object.fromEntries(
      new URL(String(mock.mock.calls.at(-1)?.[0]), "http://localhost")
        .searchParams
    )
  ).toEqual({
    dateFrom: "2026-11-01T08:00:00+05:00",
    dateTo: "2026-11-05T08:00:00+05:00",
  })
  await userEvent.click(screen.getByRole("button", { name: "Все даты" }))
  await waitFor(() =>
    expect(mock.mock.calls.at(-1)?.[0]).toBe("/api/me/driver-statistics")
  )
})
it("не отправляет обратный период, а пустую статистику показывает нулями", async () => {
  await driver({
    ...statistics,
    ridesTotal: 0,
    passengersTransported: 0,
    seatsTransported: 0,
    demoReceiptsKopecks: "0",
  })
  expect(
    screen.getByText("Всего поездок").nextElementSibling?.textContent
  ).toBe("0")
  fireEvent.change(screen.getByLabelText("Отправление от"), {
    target: { value: "2026-11-05T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Отправление до"), {
    target: { value: "2026-11-01T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить период" })
  )
  await screen.findByText("Начало периода позже конца")
  expect(mock).toHaveBeenCalledTimes(1)
})
it("повторяет ошибку статистики с сохранением периода", async () => {
  await driver()
  fireEvent.change(screen.getByLabelText("Отправление от"), {
    target: { value: "2026-11-01T08:00" },
  })
  mock.mockResolvedValueOnce(
    json({ message: "Статистика временно недоступна" }, 503)
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить период" })
  )
  await screen.findByText("Статистика временно недоступна")
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку статистики" })
  )
  await screen.findByText("Все даты отправления")
  expect(
    new URL(
      String(mock.mock.calls.at(-1)?.[0]),
      "http://localhost"
    ).searchParams.get("dateFrom")
  ).toBe("2026-11-01T08:00:00+05:00")
})
it("пассажир видит ближайшую поездку и общее число предстоящих заявок", async () => {
  mock.mockResolvedValueOnce(
    json({ items: [booking], total: 3, page: 1, pageSize: 1 })
  )
  vi.stubGlobal("fetch", mock)
  render(<CabinetHome role="passenger" onExpired={expired} />)
  await screen.findByText("Предстоящих заявок: 3")
  expect(mock.mock.calls[0]?.[0]).toBe(
    "/api/me/bookings?period=upcoming&sort=departureAsc&page=1&pageSize=1"
  )
  expect(screen.getByRole("heading", { name: "Уралмаш → УрФУ" })).toBeTruthy()
  expect(screen.getByText("2099-11-09 08:30 · Екатеринбург")).toBeTruthy()
  expect(screen.getByText("Заявка: Подтверждена")).toBeTruthy()
  expect(
    screen
      .getByRole("link", { name: "Открыть мои заявки" })
      .getAttribute("href")
  ).toBe("#/bookings")
  expect(
    screen.queryByRole("link", { name: "Публичная карточка поездки" })
  ).toBeNull()
})
it("пустые предстоящие поездки предлагают поиск, ошибка позволяет повтор", async () => {
  mock
    .mockResolvedValueOnce(json({ message: "Сбой загрузки" }, 503))
    .mockResolvedValueOnce(json({ items: [], total: 0, page: 1, pageSize: 1 }))
  vi.stubGlobal("fetch", mock)
  render(<CabinetHome role="passenger" onExpired={expired} />)
  await screen.findByText("Сбой загрузки")
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку поездок" })
  )
  await screen.findByText(/Предстоящих поездок пока нет/)
  expect(
    screen.getByRole("link", { name: "Найти поездку" }).getAttribute("href")
  ).toBe("#/search")
})
it.each(["driver", "passenger"] as const)(
  "главная роли %s обрабатывает 401 и 403",
  async (role) => {
    mock.mockResolvedValueOnce(json({ message: "Вход" }, 401))
    vi.stubGlobal("fetch", mock)
    const view = render(<CabinetHome role={role} onExpired={expired} />)
    await waitFor(() => expect(expired).toHaveBeenCalledOnce())
    view.unmount()
    mock.mockResolvedValueOnce(json({ message: "Нет прав" }, 403))
    render(<CabinetHome role={role} onExpired={expired} />)
    await screen.findByRole("alert")
    expect(screen.queryByText("Все даты отправления")).toBeNull()
    expect(screen.queryByText("Заявка: Подтверждена")).toBeNull()
  }
)
it("поздний ответ после ухода из статистики игнорируется", async () => {
  let resolve!: (data: Response) => void
  mock.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  vi.stubGlobal("fetch", mock)
  const view = render(<DriverStatisticsPanel onExpired={expired} />)
  view.unmount()
  await act(async () => resolve(json({ message: "Вход" }, 401)))
  expect(expired).not.toHaveBeenCalled()
})
it("администратор видит действия без заглушек и лишних запросов", () => {
  vi.stubGlobal("fetch", mock)
  render(<CabinetHome role="admin" onExpired={expired} />)
  expect(
    screen.getByRole("heading", { name: "Администрирование" })
  ).toBeTruthy()
  expect(
    screen
      .getByRole("link", { name: "Управлять пользователями" })
      .getAttribute("href")
  ).toBe("#/admin/users")
  expect(
    screen
      .getByRole("link", { name: "Модерировать отзывы" })
      .getAttribute("href")
  ).toBe("#/admin/reviews")
  expect(
    screen
      .getByRole("link", { name: "Открыть историю решений" })
      .getAttribute("href")
  ).toBe("#/admin/activity")
  expect(screen.queryByText("Раздел в разработке")).toBeNull()
  expect(mock).not.toHaveBeenCalled()
})
it("при переключении двух ролей загружает только данные выбранного кабинета", async () => {
  mock.mockImplementation(async (url) =>
    String(url).includes("driver-statistics")
      ? json(statistics)
      : json({ items: [booking], total: 1, page: 1, pageSize: 1 })
  )
  vi.stubGlobal("fetch", mock)
  window.history.replaceState(null, "", "/#/passenger")
  render(
    <Cabinet
      user={{
        id: "user",
        fullName: "Анна",
        email: "a@example.ru",
        affiliation: null,
        roles: ["PASSENGER", "DRIVER"],
      }}
      onExpired={expired}
      onSaved={vi.fn()}
    />
  )
  await screen.findByText("Предстоящих заявок: 1")
  await userEvent.click(screen.getByRole("link", { name: "Кабинет водителя" }))
  await screen.findByText("Все даты отправления")
  expect(screen.queryByText("Предстоящих заявок: 1")).toBeNull()
  expect(mock).toHaveBeenCalledTimes(2)
  expect(
    within(
      screen.getByRole("navigation", { name: "Быстрые действия" })
    ).getByRole("link", { name: "Открыть мои поездки" })
  ).toBeTruthy()
})
