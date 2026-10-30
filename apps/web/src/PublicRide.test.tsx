import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { PublicRideScreen, type PublicRideDetail } from "./PublicRide"
const id = "11111111-1111-4111-8111-111111111111"
const point = (name: string) => ({ id: name, name, address: `Адрес: ${name}` })
const ride: PublicRideDetail = {
  id,
  status: "PUBLISHED",
  origin: point("Уралмаш"),
  destination: point("УрФУ"),
  departureAt: "2099-11-09T03:30:00Z",
  seatsTotal: 4,
  availableSeats: 1,
  priceKopecks: 12050,
  conditions: "Встречаемся у входа",
  musicAllowed: false,
  luggageAllowed: true,
  smokingAllowed: false,
  driver: {
    id: "driver",
    fullName: "Анна Соколова",
    bio: "Учусь в УрФУ",
    rating: 4.75,
    reviewCount: 8,
  },
  vehicle: { make: "Kia", model: "Rio", color: "Белый", passengerSeats: 4 },
  stops: [
    { position: 2, location: point("Динамо") },
    { position: 1, location: point("Проспект Космонавтов") },
  ],
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
it("загружает публичную карточку и отображает полный маршрут, рейтинг и остаток мест", async () => {
  const fetchMock = vi.fn(async () => json(ride))
  vi.stubGlobal("fetch", fetchMock)
  render(<PublicRideScreen id={id} query="" />)
  expect(screen.getByRole("status").textContent).toContain("Загружаем")
  await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
  expect(fetchMock.mock.calls.length).toBe(1)
  expect(screen.getByText("120,50 ₽ за место")).toBeTruthy()
  expect(
    screen.getByText("Отправление: 2099-11-09 08:30 · Екатеринбург (UTC+5)")
  ).toBeTruthy()
  expect(screen.getByText("1", { selector: "strong" })).toBeTruthy()
  expect(
    screen.getByText("Рейтинг водителя: 4,75 из 5 · Отзывов: 8")
  ).toBeTruthy()
  expect(screen.getByText("Учусь в УрФУ")).toBeTruthy()
  expect(screen.getByText("Пассажирских мест в автомобиле: 4")).toBeTruthy()
  expect(screen.getByText("Встречаемся у входа")).toBeTruthy()
  const stops = within(
    screen.getByRole("list", { name: "Точки маршрута" })
  ).getAllByRole("listitem")
  expect(stops.map((item) => item.textContent)).toEqual([
    expect.stringContaining("Уралмаш"),
    expect.stringContaining("Проспект Космонавтов"),
    expect.stringContaining("Динамо"),
    expect.stringContaining("УрФУ"),
  ])
})
it("показывает отсутствие отзывов, остановок, описания и дополнительных условий", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        ...ride,
        priceKopecks: 0,
        stops: [],
        conditions: null,
        driver: { ...ride.driver, rating: null, reviewCount: 0, bio: null },
      })
    )
  )
  render(<PublicRideScreen id={id} query="" />)
  for (const text of [
    "Бесплатно",
    "Пока нет отзывов",
    "Без промежуточных остановок",
    "Водитель пока не добавил описание.",
    "Дополнительных условий нет.",
  ])
    expect(await screen.findByText(text)).toBeTruthy()
})
it.each([400, 404])(
  "обрабатывает недоступную или некорректную поездку (%s)",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "Not found" }, status))
    )
    render(
      <PublicRideScreen
        id={id}
        query={`search=${encodeURIComponent("date=2099-11-09&page=2&sort=priceAsc")}`}
      />
    )
    expect(
      await screen.findByRole("heading", { name: "Поездка недоступна" })
    ).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Вернуться к результатам" })
        .getAttribute("href")
    ).toBe("#/search?date=2099-11-09&page=2&sort=priceAsc")
    expect(
      screen.queryByRole("button", { name: "Повторить загрузку" })
    ).toBeNull()
  }
)
it("повторяет запрос после сетевой ошибки", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(json(ride))
  vi.stubGlobal("fetch", fetchMock)
  render(<PublicRideScreen id={id} query="" />)
  expect(await screen.findByRole("alert")).toBeTruthy()
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  expect(
    await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
  ).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
it("игнорирует ответ старой карточки после смены маршрута", async () => {
  let resolve!: (value: Response) => void
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        })
    )
    .mockResolvedValueOnce(json({ ...ride, origin: point("Академический") }))
  vi.stubGlobal("fetch", fetchMock)
  const view = render(<PublicRideScreen key="first" id={id} query="" />)
  view.rerender(
    <PublicRideScreen
      key="second"
      id="22222222-2222-4222-8222-222222222222"
      query=""
    />
  )
  await screen.findByRole("heading", { name: "Академический → УрФУ" })
  resolve(json(ride))
  await new Promise((done) => setTimeout(done, 0))
  expect(screen.queryByRole("heading", { name: "Уралмаш → УрФУ" })).toBeNull()
})
