import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
const driver = {
  id: "driver",
  email: "driver@example.ru",
  fullName: "Михаил Кузнецов",
  affiliation: null,
  roles: ["PASSENGER", "DRIVER"],
}
const vehicle = {
  id: "car-1",
  make: "Kia",
  model: "Rio",
  registrationNumber: "A123BC196",
  passengerSeats: 3,
}
const locations = [
  { id: "origin", name: "Уралмаш", address: "Космонавтов" },
  { id: "destination", name: "ГУК УрФУ", address: "Мира, 19" },
  { id: "stop1", name: "Точка 1", address: "Первомайская" },
  { id: "stop2", name: "Точка 2", address: "Мира" },
]
const ride = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "DRAFT",
  vehicleId: vehicle.id,
  originId: "origin",
  destinationId: "destination",
  departureAt: "2099-11-09T03:00:00.000Z",
  seatsTotal: 2,
  priceKopecks: 15015,
  conditions: "У выхода из метро",
  musicAllowed: false,
  luggageAllowed: true,
  smokingAllowed: false,
  stops: [{ locationId: "stop1" }],
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const page = <T,>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 100,
})
const calls = vi.fn<typeof fetch>()
function start({
  edit = false,
  roles = driver.roles,
  cars = [vehicle],
  points = locations,
  savedStatus = 201,
  savedBody = ride,
  loadedRide = ride,
} = {}) {
  window.history.replaceState(
    null,
    "",
    edit ? `/#/rides/${ride.id}/edit` : "/#/rides/new"
  )
  calls.mockImplementation(async (url, init) => {
    const path = String(url)
    if (path === "/api/auth/me") return response({ ...driver, roles })
    if (path.startsWith("/api/locations?")) return response(page(points))
    if (path.startsWith("/api/me/vehicles?")) return response(page(cars))
    if (path === `/api/me/rides/${ride.id}`) return response(loadedRide)
    if (init?.method === "POST" || init?.method === "PATCH")
      return response(savedBody, savedStatus)
    throw new Error(`Unexpected URL ${path}`)
  })
  vi.stubGlobal("fetch", calls)
  render(<App />)
}
async function fill() {
  await userEvent.selectOptions(
    await screen.findByLabelText("Автомобиль"),
    vehicle.id
  )
  await userEvent.selectOptions(screen.getByLabelText("Откуда"), "origin")
  await userEvent.selectOptions(screen.getByLabelText("Куда"), "destination")
  await userEvent.type(
    screen.getByLabelText("Отправление — Екатеринбург"),
    "2099-11-09T08:00"
  )
  await userEvent.clear(screen.getByLabelText("Цена за место, ₽"))
  await userEvent.type(screen.getByLabelText("Цена за место, ₽"), "150,15")
  await userEvent.type(
    screen.getByLabelText("Место встречи и условия"),
    "У выхода из метро"
  )
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  calls.mockReset()
  window.history.replaceState(null, "", "/")
})

describe("Форма поездки", () => {
  it("выбирает данные из API, передаёт копейки и +05:00 и открывает сохранённый черновик для редактирования", async () => {
    start()
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить черновик" })
    )
    expect(await screen.findByText("Черновик сохранён")).toBeTruthy()
    const [url, options] = calls.mock.calls.find(
      ([, options]) => options?.method === "POST"
    )!
    expect(url).toBe("/api/rides")
    expect(JSON.parse(String(options?.body))).toEqual({
      vehicleId: vehicle.id,
      originId: "origin",
      destinationId: "destination",
      departureAt: "2099-11-09T08:00:00+05:00",
      seatsTotal: 1,
      priceKopecks: 15015,
      conditions: "У выхода из метро",
      musicAllowed: true,
      luggageAllowed: false,
      smokingAllowed: false,
      stops: [],
    })
    await userEvent.click(
      screen.getByRole("link", { name: "Редактировать черновик" })
    )
    expect(
      await screen.findByRole("heading", { name: "Редактировать черновик" })
    ).toBeTruthy()
    expect(
      (
        (await screen.findByLabelText(
          "Отправление — Екатеринбург"
        )) as HTMLInputElement
      ).value
    ).toBe("2099-11-09T08:00")
  })
  it("загружает черновик, сохраняет флаги и позволяет изменить порядок остановок", async () => {
    start({ edit: true, savedStatus: 200 })
    await screen.findByLabelText("Автомобиль")
    expect(
      (screen.getByLabelText("Цена за место, ₽") as HTMLInputElement).value
    ).toBe("150.15")
    expect(
      (screen.getByLabelText("Можно с багажом") as HTMLInputElement).checked
    ).toBe(true)
    await userEvent.click(
      screen.getByRole("button", { name: "Добавить остановку" })
    )
    await userEvent.selectOptions(screen.getByLabelText("Остановка 2"), "stop2")
    await userEvent.click(
      screen.getByRole("button", { name: "Поднять остановку 2" })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить черновик" })
    )
    await screen.findByText("Черновик сохранён")
    const [url, options] = calls.mock.calls.find(
      ([, options]) => options?.method === "PATCH"
    )!
    expect(url).toBe(`/api/rides/${ride.id}`)
    expect(JSON.parse(String(options?.body))).toMatchObject({
      musicAllowed: false,
      luggageAllowed: true,
      stops: [{ locationId: "stop2" }, { locationId: "stop1" }],
    })
  })
  it("сохраняет введённые значения при конфликте сервера", async () => {
    start({
      savedStatus: 409,
      savedBody: {
        ...ride,
        message: "Изменять можно только черновик",
      } as typeof ride,
    })
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить черновик" })
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Изменять можно только черновик"
    )
    expect(
      (screen.getByLabelText("Цена за место, ₽") as HTMLInputElement).value
    ).toBe("150,15")
  })
  it("локально отклоняет повтор точки и лишнюю точность цены", async () => {
    start()
    await fill()
    await userEvent.selectOptions(screen.getByLabelText("Куда"), "origin")
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить черновик" })
    )
    expect((await screen.findByRole("alert")).textContent).toContain(
      "разные точки"
    )
    await userEvent.selectOptions(screen.getByLabelText("Куда"), "destination")
    await userEvent.clear(screen.getByLabelText("Цена за место, ₽"))
    await userEvent.type(screen.getByLabelText("Цена за место, ₽"), "1.001")
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить черновик" })
    )
    expect((await screen.findByRole("alert")).textContent).toContain(
      "двух знаков"
    )
    expect(
      calls.mock.calls.some(([, options]) => options?.method === "POST")
    ).toBe(false)
  })
  it("при отсутствии автомобиля предлагает добавить его", async () => {
    start({ cars: [] })
    expect(
      await screen.findByRole("link", { name: "Открыть мои автомобили" })
    ).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "Сохранить черновик" })
    ).toBeNull()
  })
  it("не показывает форму для опубликованной поездки", async () => {
    start({ edit: true, loadedRide: { ...ride, status: "PUBLISHED" } })
    expect((await screen.findByRole("alert")).textContent).toContain(
      "только черновик"
    )
  })
  it("возвращает вход при истечении сессии во время сохранения", async () => {
    start({ savedStatus: 401 })
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить черновик" })
    )
    expect(
      await screen.findByRole("heading", { name: "С возвращением" })
    ).toBeTruthy()
  })
  it("не открывает форму пассажиру по прямой ссылке", async () => {
    start({ roles: ["PASSENGER"] })
    expect(
      await screen.findByRole("heading", { name: "Раздел недоступен" })
    ).toBeTruthy()
    expect(calls).toHaveBeenCalledTimes(1)
  })
  it("загружает все страницы вариантов, а не только первые сто", async () => {
    start()
    calls.mockImplementation(async (url) => {
      const path = String(url)
      if (path === "/api/auth/me") return response(driver)
      if (path.startsWith("/api/me/vehicles")) return response(page([vehicle]))
      return response({
        items: path.includes("page=2")
          ? [locations[0]]
          : Array.from({ length: 100 }, (_, index) => ({
              id: `point-${index}`,
              name: `Точка ${index}`,
              address: "Екатеринбург",
            })),
        total: 101,
        page: path.includes("page=2") ? 2 : 1,
        pageSize: 100,
      })
    })
    await screen.findByLabelText("Автомобиль")
    await waitFor(() =>
      expect(
        calls.mock.calls.some(
          ([url]) => String(url) === "/api/locations?pageSize=100&page=2"
        )
      ).toBe(true)
    )
  })
})
