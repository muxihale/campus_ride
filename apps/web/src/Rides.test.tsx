import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

const user = {
  id: "driver",
  email: "driver@example.ru",
  fullName: "Михаил Кузнецов",
  affiliation: null,
  roles: ["PASSENGER", "DRIVER"],
}
const locations = [
  { id: "origin", name: "Уралмаш", address: "Космонавтов" },
  { id: "destination", name: "УрФУ", address: "Мира, 19" },
]
const car = {
  id: "car",
  make: "Kia",
  model: "Rio",
  registrationNumber: "A123BC196",
  passengerSeats: 3,
}
const ride = {
  id: "11111111-1111-4111-8111-111111111111",
  vehicleId: car.id,
  originId: "origin",
  destinationId: "destination",
  departureAt: "2099-11-09T03:00:00Z",
  seatsTotal: 3,
  priceKopecks: 15015,
  conditions: "У выхода из метро",
  musicAllowed: true,
  luggageAllowed: true,
  smokingAllowed: false,
  stops: [],
  status: "DRAFT",
}
const fetchMock = vi.fn<typeof fetch>()
const response = (body: unknown, status = 200) =>
  new Response(status === 204 ? null : JSON.stringify(body), { status })
function start({
  items = [ride],
  role = user.roles,
  failure = 0,
  total = items.length,
}: {
  items?: (typeof ride)[]
  role?: string[]
  failure?: number
  total?: number
} = {}) {
  let current = [...items]
  window.history.replaceState(null, "", "/#/rides")
  fetchMock.mockImplementation(async (input, options) => {
    const path = String(input)
    if (path === "/api/auth/me") return response({ ...user, roles: role })
    if (path.startsWith("/api/locations?"))
      return response({ items: locations, total: 2, page: 1, pageSize: 100 })
    if (path.startsWith("/api/me/vehicles?"))
      return response({ items: [car], total: 1, page: 1, pageSize: 100 })
    if (path.startsWith("/api/me/rides?")) {
      const url = new URL(path, "http://localhost")
      const page = Number(url.searchParams.get("page"))
      const found = url.searchParams.has("q") ? [] : current
      return response({
        items: page === 1 ? found : [],
        total: url.searchParams.has("q")
          ? 0
          : current.length === items.length
            ? total
            : current.length,
        page,
        pageSize: 10,
      })
    }
    if (options?.method === "POST") {
      if (failure)
        return response({ message: "Не удалось опубликовать поездку" }, failure)
      current = current.map((item) => ({ ...item, status: "PUBLISHED" }))
      return response(current[0])
    }
    if (options?.method === "DELETE") {
      current = []
      return response(null, 204)
    }
    throw new Error(`Unexpected URL: ${path}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  render(<App />)
}
const commandCalls = () =>
  fetchMock.mock.calls.filter(([, options]) =>
    ["POST", "DELETE"].includes(options?.method ?? "")
  )
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  window.history.replaceState(null, "", "/")
})

describe("Свои поездки и публикация", () => {
  it("показывает маршрут, местное время, цену, статус и ссылку редактирования", async () => {
    start()
    expect(
      await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
    ).toBeTruthy()
    expect(screen.getByText("2099-11-09 08:00 · Екатеринбург")).toBeTruthy()
    expect(screen.getByText(/150,15 ₽ за место/)).toBeTruthy()
    expect(
      screen
        .getByRole("link", { name: "Редактировать черновик" })
        .getAttribute("href")
    ).toBe(`#/rides/${ride.id}/edit`)
    expect(
      screen
        .getByRole("link", { name: "Мои поездки" })
        .getAttribute("aria-current")
    ).toBe("page")
  })
  it("публикует только после подтверждения и обновляет статус без перезагрузки", async () => {
    start()
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Опубликовать поездку Уралмаш/,
      })
    )
    expect(commandCalls()).toHaveLength(0)
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить публикацию" })
    )
    expect(await screen.findByText("Поездка опубликована.")).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Опубликовать поездку Уралмаш/ })
      ).toBeNull()
    )
    expect(
      screen.queryByRole("link", { name: "Редактировать черновик" })
    ).toBeNull()
    expect(commandCalls()).toHaveLength(1)
    expect(commandCalls()[0]![0]).toBe(`/api/rides/${ride.id}/publish`)
    expect(JSON.parse(String(commandCalls()[0]![1]?.body))).toEqual({})
  })
  it("отмена подтверждения не вызывает API", async () => {
    start()
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Опубликовать поездку Уралмаш/,
      })
    )
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
    expect(commandCalls()).toHaveLength(0)
    expect(
      screen.queryByRole("heading", { name: "Опубликовать поездку?" })
    ).toBeNull()
  })
  it("удаляет черновик после подтверждения и показывает пустое состояние", async () => {
    start()
    await userEvent.click(
      await screen.findByRole("button", { name: /Удалить черновик Уралмаш/ })
    )
    expect(commandCalls()).toHaveLength(0)
    await userEvent.click(
      screen.getByRole("button", { name: "Удалить окончательно" })
    )
    expect(await screen.findByText("Черновик удалён.")).toBeTruthy()
    expect(await screen.findByText("Пока нет поездок")).toBeTruthy()
    expect(commandCalls()[0]![1]?.method).toBe("DELETE")
  })
  it("передаёт поиск и фильтры, копейки и местное время, сбрасывает условия", async () => {
    start()
    await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
    await userEvent.type(screen.getByLabelText("Поиск"), "рюкзак")
    await userEvent.selectOptions(screen.getByLabelText("Статус"), "DRAFT")
    await userEvent.selectOptions(
      screen.getByLabelText("Автомобиль — фильтр"),
      car.id
    )
    await userEvent.selectOptions(
      screen.getByLabelText("Откуда — фильтр"),
      "origin"
    )
    await userEvent.selectOptions(
      screen.getByLabelText("Куда — фильтр"),
      "destination"
    )
    await userEvent.type(
      screen.getByLabelText("Максимум за место, ₽"),
      "150,15"
    )
    await userEvent.type(
      screen.getByLabelText("Минимум предложенных мест"),
      "2"
    )
    await userEvent.type(
      screen.getByLabelText("Отправление от — Екатеринбург"),
      "2020-01-01T08:00"
    )
    await userEvent.click(screen.getByRole("button", { name: "Найти" }))
    expect(await screen.findByText("Нет поездок по этим условиям")).toBeTruthy()
    const call = fetchMock.mock.calls
      .filter(([url]) => String(url).startsWith("/api/me/rides?"))
      .at(-1)!
    const params = new URL(String(call[0]), "http://localhost").searchParams
    expect(Object.fromEntries(params)).toEqual({
      q: "рюкзак",
      status: "DRAFT",
      vehicleId: "car",
      originId: "origin",
      destinationId: "destination",
      maxPriceKopecks: "15015",
      minSeats: "2",
      departureFrom: "2020-01-01T08:00:00+05:00",
      sort: "departureAsc",
      page: "1",
      pageSize: "10",
    })
    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить фильтры" })
    )
    expect(
      await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
    ).toBeTruthy()
  })
  it("переключает страницы списка", async () => {
    start({ total: 11 })
    await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
    await userEvent.click(screen.getByRole("button", { name: "Далее" }))
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes("page=2&pageSize=10")
        )
      ).toBe(true)
    )
    expect(await screen.findByText("Страница 2 из 2")).toBeTruthy()
  })
  it("сохраняет черновик в списке при ошибке публикации и позволяет исправить его", async () => {
    start({ failure: 400 })
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Опубликовать поездку Уралмаш/,
      })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить публикацию" })
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Не удалось опубликовать поездку"
    )
    expect(
      screen.getByRole("link", { name: "Редактировать черновик" })
    ).toBeTruthy()
  })
  it("при истечении сессии во время команды возвращает форму входа", async () => {
    start({ failure: 401 })
    await userEvent.click(
      await screen.findByRole("button", {
        name: /Опубликовать поездку Уралмаш/,
      })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить публикацию" })
    )
    expect(
      await screen.findByRole("heading", { name: "С возвращением" })
    ).toBeTruthy()
  })
  it("не показывает изменяющие действия для опубликованных поездок", async () => {
    start({ items: [{ ...ride, status: "PUBLISHED" }] })
    await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
    expect(
      screen.queryByRole("link", { name: "Редактировать черновик" })
    ).toBeNull()
    expect(
      screen.queryByRole("button", { name: /Удалить черновик/ })
    ).toBeNull()
  })
  it("не открывает список пассажиру по прямой ссылке", async () => {
    start({ role: ["PASSENGER"] })
    expect(
      await screen.findByRole("heading", { name: "Раздел недоступен" })
    ).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it("позволяет повторить загрузку после сетевой ошибки", async () => {
    start()
    const original = fetchMock.getMockImplementation()!
    let fail = true
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url).startsWith("/api/me/rides?") && fail) {
        fail = false
        throw new TypeError("Offline")
      }
      return original(url, options)
    })
    await screen.findByRole("alert")
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку" })
    )
    expect(
      await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
    ).toBeTruthy()
  })
})
