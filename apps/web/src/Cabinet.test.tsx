import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import type { Profile } from "./Profile"

const profile: Profile = {
  id: "anna",
  email: "anna@example.ru",
  fullName: "Анна Соколова",
  phone: "+79123456789",
  affiliation: "Студент УрФУ",
  roles: ["PASSENGER"],
}
const fetchMock = vi.fn<typeof fetch>()
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status })
}
function start(path = "profile", roles = profile.roles) {
  window.history.replaceState(null, "", `/#/${path}`)
  fetchMock.mockResolvedValueOnce(response({ ...profile, roles }))
  vi.stubGlobal("fetch", fetchMock)
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  window.history.replaceState(null, "", "/")
})

describe("Кабинеты и профиль", () => {
  it("загружает профиль по прямой ссылке, сохраняет поля и обновляет имя в шапке", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(profile))
      .mockResolvedValueOnce(
        response({ ...profile, fullName: "Анна Иванова", phone: null })
      )
    render(<App />)
    const name = await screen.findByLabelText("Имя и фамилия")
    expect((name as HTMLInputElement).value).toBe(profile.fullName)
    expect((screen.getByLabelText("Email") as HTMLInputElement).readOnly).toBe(
      true
    )
    await userEvent.clear(name)
    await userEvent.type(name, "Анна Иванова")
    await userEvent.clear(screen.getByLabelText("Телефон"))
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" })
    )
    expect(await screen.findByText("Профиль сохранён.")).toBeTruthy()
    expect(screen.getByText("Анна Иванова")).toBeTruthy()
    const [url, options] = fetchMock.mock.calls[2]!
    expect(url).toBe("/api/me")
    expect(options?.method).toBe("PATCH")
    expect(JSON.parse(String(options?.body))).toEqual({
      fullName: "Анна Иванова",
      phone: null,
      affiliation: "Студент УрФУ",
    })
    expect(
      screen
        .getByRole("link", { name: "Мой профиль" })
        .getAttribute("aria-current")
    ).toBe("page")
  })

  it("показывает разделы обеих ролей и переключает кабинеты по ссылкам", async () => {
    start("passenger", ["PASSENGER", "DRIVER"])
    render(<App />)
    const driver = await screen.findByRole("link", { name: "Кабинет водителя" })
    expect(screen.getByRole("link", { name: "Кабинет пассажира" })).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Администрирование" })).toBeNull()
    await userEvent.click(driver)
    expect(
      await screen.findByRole("heading", { name: "Кабинет водителя" })
    ).toBeTruthy()
    expect(
      screen.getByText("Заявки пассажиров и статистика появятся позже.")
    ).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("скрывает чужие разделы и не открывает их по прямой ссылке", async () => {
    start("driver", ["ADMIN"])
    render(<App />)
    expect(
      await screen.findByRole("link", { name: "Администрирование" })
    ).toBeTruthy()
    expect(screen.queryByRole("link", { name: "Кабинет водителя" })).toBeNull()
    expect(
      screen.getByRole("heading", { name: "Раздел недоступен" })
    ).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("повторяет загрузку после сбоя сервера", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(
        response({ message: "Профиль временно недоступен" }, 503)
      )
      .mockResolvedValueOnce(response(profile))
    render(<App />)
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Профиль временно недоступен"
    )
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку" })
    )
    expect(await screen.findByLabelText("Имя и фамилия")).toBeTruthy()
  })

  it("сохраняет введённые значения при ошибке валидации и разрешает повторную отправку", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(profile))
      .mockResolvedValueOnce(
        response({ message: ["Укажите корректный телефон"] }, 400)
      )
      .mockResolvedValueOnce(response(profile))
    render(<App />)
    const phone = await screen.findByLabelText("Телефон")
    await userEvent.clear(phone)
    await userEvent.type(phone, "неверный")
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" })
    )
    await screen.findByRole("alert")
    expect((phone as HTMLInputElement).value).toBe("неверный")
    await userEvent.clear(phone)
    await userEvent.type(phone, profile.phone!)
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" })
    )
    expect(await screen.findByText("Профиль сохранён.")).toBeTruthy()
  })

  it("при истечении сессии во время сохранения возвращает форму входа", async () => {
    start()
    fetchMock
      .mockResolvedValueOnce(response(profile))
      .mockResolvedValueOnce(response({ message: "Сессия истекла" }, 401))
    render(<App />)
    await screen.findByLabelText("Имя и фамилия")
    await userEvent.click(
      screen.getByRole("button", { name: "Сохранить изменения" })
    )
    expect(
      await screen.findByRole("heading", { name: "С возвращением" })
    ).toBeTruthy()
    expect(screen.getByText("Сессия истекла. Войдите снова.")).toBeTruthy()
    expect(
      screen.queryByRole("navigation", { name: "Личный кабинет" })
    ).toBeNull()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
  })
})
