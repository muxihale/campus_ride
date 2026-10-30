import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { App } from "./App"
import { emptySearch, readSearch, searchParams } from "./search-form"
const district = { id: "11111111-1111-4111-8111-111111111111", name: "Уралмаш" }
const campus = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "УрФУ — Мира, 19",
}
const fetchMock = vi.fn<typeof fetch>()
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })
function start(
  query = "",
  loggedIn = false,
  failSearch = false,
  failReferences = false
) {
  window.history.replaceState(null, "", `/#/search${query ? `?${query}` : ""}`)
  fetchMock.mockImplementation(async (input) => {
    const path = String(input)
    if (path.startsWith("/api/rides?") && failSearch) {
      failSearch = false
      throw new TypeError("Offline")
    }
    if (path.startsWith("/api/districts?") && failReferences) {
      failReferences = false
      throw new TypeError("Offline")
    }
    if (path === "/api/auth/me")
      return response(
        loggedIn
          ? {
              id: "driver",
              email: "anna@example.ru",
              fullName: "Анна Соколова",
              affiliation: null,
              roles: ["DRIVER"],
            }
          : { message: "Требуется вход" },
        loggedIn ? 200 : 401
      )
    if (path.startsWith("/api/districts?"))
      return response({ items: [district], total: 1, pageSize: 100, page: 1 })
    if (path.startsWith("/api/campuses?"))
      return response({ items: [campus], total: 1, pageSize: 100, page: 1 })
    if (path.startsWith("/api/rides?"))
      return response({ items: [], total: 3, page: 1, pageSize: 20 })
    throw new Error(`Unexpected URL ${path}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  render(<App />)
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  window.history.replaceState(null, "", "/")
})

describe("Форма публичного поиска", () => {
  it("без входа загружает справочники и сохраняет фильтры в URL, отправляя копейки и свободные места", async () => {
    start()
    await screen.findByRole("option", { name: district.name })
    await userEvent.selectOptions(
      screen.getByLabelText("Направление"),
      "TO_CAMPUS"
    )
    await userEvent.selectOptions(
      screen.getByLabelText("Район отправления"),
      district.id
    )
    await userEvent.selectOptions(
      screen.getByLabelText("Корпус УрФУ"),
      campus.id
    )
    await userEvent.type(screen.getByLabelText("Дата поездки"), "2099-11-09")
    await userEvent.type(screen.getByLabelText("Отправление с"), "08:00")
    await userEvent.type(screen.getByLabelText("Отправление до"), "09:00")
    await userEvent.type(
      screen.getByLabelText("Максимальная цена за место, ₽"),
      "150,15"
    )
    await userEvent.type(screen.getByLabelText("Нужно свободных мест"), "2")
    await userEvent.selectOptions(screen.getByLabelText("Багаж"), "true")
    await userEvent.click(screen.getByRole("button", { name: "Найти поездки" }))
    expect(await screen.findByText("Найдено поездок: 3")).toBeTruthy()
    const params = new URLSearchParams(window.location.hash.split("?")[1])
    expect(Object.fromEntries(params)).toEqual({
      direction: "TO_CAMPUS",
      originDistrictId: district.id,
      campusId: campus.id,
      date: "2099-11-09",
      timeFrom: "08:00",
      timeTo: "09:00",
      maxPriceKopecks: "15015",
      minSeats: "2",
      luggageAllowed: "true",
      page: "1",
    })
    expect(
      fetchMock.mock.calls.some(
        ([url]) => String(url) === `/api/rides?${params}`
      )
    ).toBe(true)
  })
  it("восстанавливает значения из прямой ссылки и при переходах истории", async () => {
    start(
      "direction=FROM_CAMPUS&date=2099-11-09&maxPriceKopecks=0&musicAllowed=false&page=1"
    )
    await screen.findByText("Найдено поездок: 3")
    expect(
      (screen.getByLabelText("Направление") as HTMLSelectElement).value
    ).toBe("FROM_CAMPUS")
    expect(
      (
        screen.getByLabelText(
          "Максимальная цена за место, ₽"
        ) as HTMLInputElement
      ).value
    ).toBe("0.00")
    expect((screen.getByLabelText("Музыка") as HTMLSelectElement).value).toBe(
      "false"
    )
    window.history.replaceState(
      null,
      "",
      "/#/search?direction=TO_CAMPUS&page=1"
    )
    fireEvent(window, new HashChangeEvent("hashchange"))
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Направление") as HTMLSelectElement).value
      ).toBe("TO_CAMPUS")
    )
  })
  it("сбрасывает условия и ссылку", async () => {
    start("q=рюкзак&page=1")
    await screen.findByText("Найдено поездок: 3")
    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить условия" })
    )
    await waitFor(() => expect(window.location.hash).toBe("#/search"))
    expect(
      (screen.getByLabelText("Маршрут или условия") as HTMLInputElement).value
    ).toBe("")
    expect(screen.queryByText("Найдено поездок: 3")).toBeNull()
  })
  it("не отправляет диапазон времени без даты", async () => {
    start()
    await screen.findByRole("option", { name: district.name })
    await userEvent.type(screen.getByLabelText("Отправление с"), "08:00")
    await userEvent.click(screen.getByRole("button", { name: "Найти поездки" }))
    expect((await screen.findByRole("alert")).textContent).toContain(
      "укажите дату"
    )
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith("/api/rides?")
      )
    ).toBe(false)
  })
  it("показывает некорректные параметры ссылки и позволяет сбросить их", async () => {
    start("status=DRAFT&page=1")
    expect((await screen.findByRole("alert")).textContent).toContain(
      "неподдерживаемые"
    )
    await screen.findByRole("option", { name: district.name })
    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить условия" })
    )
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).startsWith("/api/rides?")
      )
    ).toBe(false)
  })
  it("позволяет повторить поиск после сетевой ошибки", async () => {
    start("page=1", false, true)
    await screen.findByRole("alert")
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить поиск" })
    )
    expect(await screen.findByText("Найдено поездок: 3")).toBeTruthy()
  })
  it("позволяет повторить загрузку справочников", async () => {
    start("", false, false, true)
    await screen.findByRole("alert")
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку справочников" })
    )
    expect(
      await screen.findByRole("option", { name: district.name })
    ).toBeTruthy()
  })
  it("сбрасывает ссылку даже при недоступных справочниках", async () => {
    start("status=DRAFT", false, false, true)
    await screen.findByRole("button", {
      name: "Повторить загрузку справочников",
    })
    await userEvent.click(
      screen.getByRole("button", { name: "Сбросить условия" })
    )
    await waitFor(() => expect(window.location.hash).toBe("#/search"))
    expect(
      await screen.findByRole("option", { name: district.name })
    ).toBeTruthy()
  })
  it("доступен водителю и сохраняет переход к кабинету", async () => {
    start("page=1", true)
    await screen.findByText("Найдено поездок: 3")
    expect(
      screen.getByRole("link", { name: "Личный кабинет" }).getAttribute("href")
    ).toBe("#/profile")
  })
})
describe("Параметры поиска", () => {
  it("корректно восстанавливает нулевую цену и false", () => {
    const result = readSearch("maxPriceKopecks=0&smokingAllowed=false&page=1")
    expect(result.error).toBeUndefined()
    expect(searchParams(result.values).get("maxPriceKopecks")).toBe("0")
    expect(searchParams(result.values).get("smokingAllowed")).toBe("false")
  })
  it.each([
    "date=2099-02-30",
    "timeFrom=08:00",
    "date=2099-11-09&timeFrom=09:00&timeTo=08:00",
    "minSeats=9",
    "maxPriceKopecks=-1",
    "direction=wrong",
    "q=a&q=b",
    "pageSize=101",
    "campusId=bad",
  ])("отклоняет ссылку %s", (query) =>
    expect(readSearch(query).error).toBeTruthy()
  )
  it("переводит десятичную цену без округления и сбрасывает страницу", () => {
    const params = searchParams({ ...emptySearch, maxPrice: "0,29" })
    expect(params.get("maxPriceKopecks")).toBe("29")
    expect(params.get("page")).toBe("1")
  })
})
