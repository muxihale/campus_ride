import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import {
  SearchResults,
  RideDetailsPending,
  type PublicRide,
} from "./SearchResults"
import { App } from "./App"
const ride: PublicRide = {
  id: "11111111-1111-4111-8111-111111111111",
  origin: { id: "a", name: "Уралмаш", address: "Площадь Первой Пятилетки" },
  destination: { id: "b", name: "УрФУ", address: "Мира, 19" },
  departureAt: "2099-11-09T03:30:00.000Z",
  seatsTotal: 4,
  availableSeats: 2,
  priceKopecks: 15015,
  conditions: "Небольшой рюкзак",
  musicAllowed: true,
  luggageAllowed: true,
  smokingAllowed: false,
  driver: { id: "d", fullName: "Анна Соколова" },
  vehicle: { make: "Kia", model: "Rio", color: "Белый" },
}
const query =
  "q=Уралмаш&date=2099-11-09&musicAllowed=false&page=2&pageSize=1&sort=priceAsc"
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
function show(items = [ride], total = 3, page = 2) {
  render(
    <SearchResults data={{ items, total, page, pageSize: 1 }} query={query} />
  )
}
it("показывает маршрут, адреса, время Екатеринбурга, цену и реальный остаток", () => {
  show()
  expect(screen.getByRole("heading", { name: "Уралмаш → УрФУ" })).toBeTruthy()
  for (const text of [
    "150,15 ₽ за место",
    "2099-11-09 08:30 · Екатеринбург",
    "Водитель: Анна Соколова",
    "Посадка: Площадь Первой Пятилетки",
    "Высадка: Мира, 19",
    "Kia Rio · Белый",
    "Небольшой рюкзак",
  ])
    expect(screen.getByText(text)).toBeTruthy()
  expect(screen.getByText("2", { selector: "strong" })).toBeTruthy()
})
it("сохраняет фильтры и размер страницы при пагинации", async () => {
  show()
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  const params = new URLSearchParams(window.location.hash.split("?")[1])
  expect(params.get("page")).toBe("3")
  expect(params.get("musicAllowed")).toBe("false")
  expect(params.get("pageSize")).toBe("1")
  expect(params.get("sort")).toBe("priceAsc")
})
it("при сортировке возвращается на первую страницу с прежними фильтрами", async () => {
  show()
  await userEvent.selectOptions(
    screen.getByLabelText("Сортировка результатов"),
    "departureDesc"
  )
  const params = new URLSearchParams(window.location.hash.split("?")[1])
  expect(params.get("page")).toBe("1")
  expect(params.get("sort")).toBe("departureDesc")
  expect(params.get("date")).toBe("2099-11-09")
})
it("подготавливает ссылку на детали с точным возвратом к результатам", () => {
  show()
  const href = screen
    .getByRole("link", { name: /^Подробнее:/ })
    .getAttribute("href")!
  expect(href.startsWith(`#/ride/${ride.id}?`)).toBe(true)
  cleanup()
  render(<RideDetailsPending query={href.split("?")[1]!} />)
  expect(
    screen
      .getByRole("link", { name: "Вернуться к результатам" })
      .getAttribute("href")
  ).toBe(`#/search?${new URLSearchParams(query)}`)
})
it("различает пустой поиск и опустевшую страницу", async () => {
  show([], 0, 1)
  expect(screen.getByText("Поездки не найдены")).toBeTruthy()
  expect(
    (screen.getByRole("button", { name: "Назад" }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  expect(
    (screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  cleanup()
  show([], 2, 3)
  await userEvent.click(
    screen.getByRole("button", { name: "К первой странице" })
  )
  expect(
    new URLSearchParams(window.location.hash.split("?")[1]).get("page")
  ).toBe("1")
})
it("показывает бесплатную поездку и ограничивает навигацию первой страницы", () => {
  show([{ ...ride, priceKopecks: 0 }], 1, 1)
  expect(screen.getByText("Бесплатно")).toBeTruthy()
  expect(
    (screen.getByRole("button", { name: "Назад" }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  expect(
    (screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
})
it("не восстанавливает некорректные параметры возврата", () => {
  render(<RideDetailsPending query="search=unknown%3Dvalue" />)
  expect(screen.getByRole("link").getAttribute("href")).toBe("#/search")
})

it("анонимный поиск получает карточки из API и сохраняет состояние после перехода туда и обратно", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input)
    if (path === "/api/auth/me")
      return new Response(JSON.stringify({ message: "Требуется вход" }), {
        status: 401,
      })
    if (path.startsWith("/api/rides?"))
      return new Response(
        JSON.stringify({ items: [ride], total: 1, page: 1, pageSize: 20 })
      )
    return new Response(
      JSON.stringify({ items: [], total: 0, page: 1, pageSize: 100 })
    )
  })
  vi.stubGlobal("fetch", fetchMock)
  window.history.replaceState(
    null,
    "",
    "/#/search?date=2099-11-09&sort=priceAsc&page=1"
  )
  render(<App />)
  await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
  await userEvent.click(screen.getByRole("link", { name: /^Подробнее:/ }))
  await screen.findByRole("heading", { name: "Карточка поездки" })
  await userEvent.click(
    screen.getByRole("link", { name: "Вернуться к результатам" })
  )
  await screen.findByRole("heading", { name: "Уралмаш → УрФУ" })
  expect(
    (screen.getByLabelText("Дата поездки") as HTMLInputElement).value
  ).toBe("2099-11-09")
  expect(
    (screen.getByLabelText("Сортировка результатов") as HTMLSelectElement).value
  ).toBe("priceAsc")
  expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/rides?")
    ).length
  ).toBe(2)
})
