import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

const user = {
  id: "anna",
  email: "anna@example.ru",
  fullName: "Анна Соколова",
  phone: null,
  affiliation: null,
  roles: ["PASSENGER"],
}
const fetchMock = vi.fn<typeof fetch>()
function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}
function start() {
  window.history.replaceState(null, "", "/#/become-driver")
  fetchMock.mockResolvedValueOnce(response(user))
  vi.stubGlobal("fetch", fetchMock)
  render(<App />)
}
async function fill() {
  await userEvent.type(await screen.findByLabelText("Марка"), "Kia")
  await userEvent.type(screen.getByLabelText("Модель"), "Rio")
  await userEvent.type(screen.getByLabelText("Цвет"), "Белый")
  await userEvent.type(screen.getByLabelText("Госномер"), "А123ВС196")
}
afterEach(() => {
  cleanup()
  fetchMock.mockReset()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})

describe("Форма подключения водителя", () => {
  it("сохраняет первый автомобиль и сразу открывает навигацию обеих ролей", async () => {
    start()
    fetchMock.mockResolvedValueOnce(
      response({ ...user, roles: ["PASSENGER", "DRIVER"] }, 201)
    )
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Подключить роль водителя" })
    )
    expect(
      await screen.findByRole("heading", { name: "Вы стали водителем" })
    ).toBeTruthy()
    expect(screen.getByRole("link", { name: "Кабинет водителя" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Кабинет пассажира" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Стать водителем" })).toBeNull()
    const [url, options] = fetchMock.mock.calls[1]!
    expect(url).toBe("/api/me/driver-profile")
    expect(options?.method).toBe("POST")
    expect(JSON.parse(String(options?.body))).toEqual({
      bio: "",
      vehicle: {
        make: "Kia",
        model: "Rio",
        color: "Белый",
        registrationNumber: "А123ВС196",
        passengerSeats: 3,
      },
    })
  })

  it("сохраняет введённые данные при конфликте и разрешает исправить номер", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(
        response(
          { message: "Профиль водителя уже создан или госномер занят" },
          409
        )
      )
      .mockResolvedValueOnce(
        response({ ...user, roles: ["PASSENGER", "DRIVER"] }, 201)
      )
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Подключить роль водителя" })
    )
    await screen.findByRole("alert")
    expect((screen.getByLabelText("Марка") as HTMLInputElement).value).toBe(
      "Kia"
    )
    const plate = screen.getByLabelText("Госномер")
    await userEvent.clear(plate)
    await userEvent.type(plate, "А456ВС196")
    await userEvent.click(
      screen.getByRole("button", { name: "Подключить роль водителя" })
    )
    expect(
      await screen.findByRole("heading", { name: "Вы стали водителем" })
    ).toBeTruthy()
  })

  it("при истечении сессии предлагает войти повторно", async () => {
    start()
    fetchMock.mockResolvedValueOnce(
      response({ message: "Сессия истекла" }, 401)
    )
    await fill()
    await userEvent.click(
      screen.getByRole("button", { name: "Подключить роль водителя" })
    )
    expect(
      await screen.findByRole("heading", { name: "С возвращением" })
    ).toBeTruthy()
  })

  it("уже подключённому водителю не показывает повторную форму", async () => {
    window.history.replaceState(null, "", "/#/become-driver")
    fetchMock.mockResolvedValueOnce(
      response({ ...user, roles: ["PASSENGER", "DRIVER"] })
    )
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    expect(
      await screen.findByRole("heading", { name: "Вы уже водитель" })
    ).toBeTruthy()
    expect(screen.queryByLabelText("Марка")).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
