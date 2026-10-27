import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"

const user = {
  id: "user-1",
  email: "anna@example.ru",
  fullName: "Анна Соколова",
  affiliation: null,
  roles: ["PASSENGER"],
}
const fetchMock = vi.fn<typeof fetch>()
function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}
function guest() {
  fetchMock.mockResolvedValueOnce(response({ message: "Требуется вход" }, 401))
  vi.stubGlobal("fetch", fetchMock)
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe("Авторизация в интерфейсе", () => {
  it("восстанавливает пользователя после загрузки и завершает сессию", async () => {
    fetchMock
      .mockResolvedValueOnce(response(user))
      .mockResolvedValueOnce(response(null, 204))
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    expect(await screen.findByText("Анна Соколова")).toBeTruthy()
    expect(screen.getByText("Пассажир")).toBeTruthy()
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }))
    expect(
      await screen.findByRole("heading", { name: "С возвращением" })
    ).toBeTruthy()
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/auth/logout")
  })

  it("регистрирует пассажира и передаёт пароль без обрезки", async () => {
    guest()
    fetchMock.mockResolvedValueOnce(response(user, 201))
    render(<App />)
    await userEvent.click(
      await screen.findByRole("button", { name: "Зарегистрироваться" })
    )
    await userEvent.type(screen.getByLabelText("Имя и фамилия"), user.fullName)
    await userEvent.type(screen.getByLabelText("Email"), user.email)
    await userEvent.type(screen.getByLabelText("Пароль"), "  Password 2026  ")
    await userEvent.click(
      screen.getByRole("button", { name: "Создать аккаунт" })
    )
    expect(await screen.findByText("Анна Соколова")).toBeTruthy()
    const [url, options] = fetchMock.mock.calls[1]!
    expect(url).toBe("/api/auth/register")
    expect(JSON.parse(String(options?.body))).toEqual({
      email: user.email,
      password: "  Password 2026  ",
      fullName: user.fullName,
      affiliation: "",
    })
    expect(options?.credentials).toBe("same-origin")
  })

  it("показывает ошибку входа и позволяет исправить данные", async () => {
    guest()
    fetchMock
      .mockResolvedValueOnce(
        response({ message: "Неверный email или пароль" }, 401)
      )
      .mockResolvedValueOnce(response(user))
    render(<App />)
    await screen.findByRole("heading", { name: "С возвращением" })
    await userEvent.type(screen.getByLabelText("Email"), user.email)
    await userEvent.type(screen.getByLabelText("Пароль"), "Password-2026")
    await userEvent.click(screen.getByRole("button", { name: "Войти" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Неверный email или пароль"
    )
    await userEvent.click(screen.getByRole("button", { name: "Войти" }))
    expect(await screen.findByText("Анна Соколова")).toBeTruthy()
  })

  it("при сетевой ошибке восстановления предлагает повторить, не выдавая пользователя за гостя", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(response(user))
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    await screen.findByRole("alert")
    expect(screen.queryByLabelText("Пароль")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Повторить" }))
    expect(await screen.findByText("Анна Соколова")).toBeTruthy()
  })

  it("не скрывает аккаунт при неудавшемся выходе", async () => {
    fetchMock
      .mockResolvedValueOnce(response(user))
      .mockRejectedValueOnce(new TypeError("Offline"))
    vi.stubGlobal("fetch", fetchMock)
    render(<App />)
    await screen.findByText("Анна Соколова")
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }))
    await screen.findByRole("alert")
    expect(screen.getByText("Анна Соколова")).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Выйти" }).hasAttribute("disabled")
      ).toBe(false)
    )
  })
})
