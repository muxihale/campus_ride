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
const car = {
  id: "car-1",
  make: "Kia",
  model: "Rio",
  color: "Белый",
  registrationNumber: "A123BC196",
  passengerSeats: 3,
  createdAt: "2026-10-28T10:00:00Z",
}
const fetchMock = vi.fn<typeof fetch>()
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
const list = (items = [car], total = items.length, page = 1) => ({
  items,
  total,
  page,
  pageSize: 10,
})
function start(roles = driver.roles) {
  window.history.replaceState(null, "", "/#/vehicles")
  fetchMock.mockResolvedValueOnce(response({ ...driver, roles }))
  vi.stubGlobal("fetch", fetchMock)
}
async function fill() {
  await userEvent.type(screen.getByLabelText("Марка"), "Kia")
  await userEvent.type(screen.getByLabelText("Модель"), "Rio")
  await userEvent.type(screen.getByLabelText("Цвет"), "Белый")
  await userEvent.type(screen.getByLabelText("Госномер"), "А123ВС196")
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  window.history.replaceState(null, "", "/")
})

describe("Экран автомобилей", () => {
  it("добавляет автомобиль из пустого списка и обновляет данные через API", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(list([])))
      .mockResolvedValueOnce(response(car, 201))
      .mockResolvedValueOnce(response(list()))
    render(<App />)
    await screen.findByText("Пока нет автомобилей")
    await userEvent.click(
      screen.getByRole("button", { name: "Добавить автомобиль" })
    )
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить автомобиль" })
    )
    expect(await screen.findByRole("heading", { name: "Kia Rio" })).toBeTruthy()
    expect(screen.getByText("Автомобиль сохранён.")).toBeTruthy()
    const [url, options] = fetchMock.mock.calls[2]!
    expect(url).toBe("/api/me/vehicles")
    expect(options?.method).toBe("POST")
    expect(JSON.parse(String(options?.body))).toEqual({
      make: "Kia",
      model: "Rio",
      color: "Белый",
      registrationNumber: "А123ВС196",
      passengerSeats: 3,
    })
    expect(
      screen
        .getByRole("link", { name: "Мои автомобили" })
        .getAttribute("aria-current")
    ).toBe("page")
  })

  it("редактирует выбранный автомобиль и сохраняет его UUID в маршруте API", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(list()))
      .mockResolvedValueOnce(response({ ...car, color: "Синий" }))
      .mockResolvedValueOnce(response(list([{ ...car, color: "Синий" }])))
    render(<App />)
    await userEvent.click(
      await screen.findByRole("button", { name: /Редактировать Kia/ })
    )
    expect((screen.getByLabelText("Марка") as HTMLInputElement).value).toBe(
      "Kia"
    )
    const color = screen.getByLabelText("Цвет")
    await userEvent.clear(color)
    await userEvent.type(color, "Синий")
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить автомобиль" })
    )
    expect(await screen.findByText(/Синий · Мест/)).toBeTruthy()
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/me/vehicles/car-1")
    expect(fetchMock.mock.calls[2]![1]?.method).toBe("PATCH")
  })

  it("передаёт поиск и четыре фильтра, отличает пустой результат и сбрасывает условия", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(list()))
      .mockResolvedValueOnce(response(list([])))
      .mockResolvedValueOnce(response(list()))
    render(<App />)
    await screen.findByText("A123BC196")
    await userEvent.type(screen.getByLabelText("Поиск"), "Rio")
    await userEvent.type(screen.getByLabelText("Марка — фильтр"), "Kia")
    await userEvent.type(screen.getByLabelText("Модель — фильтр"), "Rio")
    await userEvent.type(screen.getByLabelText("Цвет — фильтр"), "Синий")
    await userEvent.type(screen.getByLabelText("Минимум мест"), "4")
    await userEvent.click(screen.getByRole("button", { name: "Найти" }))
    expect(
      await screen.findByText("Нет автомобилей по этим условиям")
    ).toBeTruthy()
    const url = new URL(String(fetchMock.mock.calls[2]![0]), "http://localhost")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      page: "1",
      pageSize: "10",
      q: "Rio",
      make: "Kia",
      model: "Rio",
      color: "Синий",
      minSeats: "4",
    })
    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить фильтры" })
    )
    expect(await screen.findByText("A123BC196")).toBeTruthy()
    expect((screen.getByLabelText("Поиск") as HTMLInputElement).value).toBe("")
  })

  it("переключает страницы списка", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(list([car], 11)))
      .mockResolvedValueOnce(
        response(list([{ ...car, id: "car-2", model: "Ceed" }], 11, 2))
      )
    render(<App />)
    await userEvent.click(await screen.findByRole("button", { name: "Далее" }))
    expect(
      await screen.findByRole("heading", { name: "Kia Ceed" })
    ).toBeTruthy()
    expect(String(fetchMock.mock.calls[2]![0])).toContain("page=2")
    expect(
      screen.getByRole("button", { name: "Далее" }).hasAttribute("disabled")
    ).toBe(true)
  })

  it("позволяет повторить загрузку после ошибки", async () => {
    start()
    fetchMock
      .mockRejectedValueOnce(new TypeError("Offline"))
      .mockResolvedValueOnce(response(list()))
    render(<App />)
    await screen.findByRole("alert")
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку" })
    )
    expect(await screen.findByText("A123BC196")).toBeTruthy()
  })

  it("сохраняет форму при конфликте номера и позволяет отменить изменения без запроса", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(list()))
      .mockResolvedValueOnce(response({ message: "Госномер занят" }, 409))
    render(<App />)
    await userEvent.click(
      await screen.findByRole("button", { name: /Редактировать Kia/ })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить автомобиль" })
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Госномер занят"
    )
    expect((screen.getByLabelText("Госномер") as HTMLInputElement).value).toBe(
      car.registrationNumber
    )
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
    expect(screen.queryByLabelText("Госномер")).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it("не открывает автомобили пассажиру по прямой ссылке", async () => {
    start(["PASSENGER"])
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "Раздел недоступен" })
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Мои автомобили" })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("при истечении сессии во время сохранения возвращает форму входа", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(list()))
      .mockResolvedValueOnce(response({ message: "Сессия истекла" }, 401))
    render(<App />)
    await userEvent.click(
      await screen.findByRole("button", { name: /Редактировать Kia/ })
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить автомобиль" })
    )
    expect(
      await screen.findByRole("heading", { name: "С возвращением" })
    ).toBeTruthy()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })
})
