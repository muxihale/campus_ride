import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { ReviewsScreen } from "./Reviews"
import { Cabinet } from "./Cabinet"
const mock = vi.fn<typeof fetch>(),
  expired = vi.fn()
const row = {
  id: "one",
  rating: 4,
  comment: "Комфортная поездка",
  createdAt: "2026-11-03T03:00:00Z",
  recipientRole: "DRIVER",
  author: { fullName: "Анна Соколова" },
  recipient: { fullName: "Иван Петров" },
}
const ratings = {
  driver: { average: 4.5, count: 2 },
  passenger: { average: null, count: 0 },
}
const page = (items = [row], total = items.length, current = 1) => ({
  items,
  total,
  page: current,
  pageSize: 10,
})
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mock.mockReset()
  expired.mockReset()
  window.history.replaceState(null, "", "/")
})
async function start(data = page()) {
  mock.mockImplementation(async (url) =>
    json(String(url).endsWith("ratings") ? ratings : data)
  )
  vi.stubGlobal("fetch", mock)
  const view = render(<ReviewsScreen userId="user" onExpired={expired} />)
  await screen.findByText(`Всего отзывов: ${data.total}`)
  return view
}
it("показывает полученные отзывы и раздельные рейтинги без контактов", async () => {
  await start()
  expect(screen.getByText("От: Анна Соколова")).toBeTruthy()
  expect(screen.getByText("4,5 из 5 · Отзывов: 2")).toBeTruthy()
  expect(screen.getByText("Пока нет оценок · Отзывов: 0")).toBeTruthy()
  expect(screen.getByText("2026-11-03 08:00 · Екатеринбург")).toBeTruthy()
  expect(mock.mock.calls.map(([url]) => url)).toContain(
    "/api/me/reviews?direction=received&page=1&pageSize=10"
  )
})
it("применяет направление, поиск, роль, оценки и даты Екатеринбурга", async () => {
  await start()
  await userEvent.type(
    screen.getByLabelText("Поиск по тексту или имени"),
    "Анна"
  )
  await userEvent.selectOptions(screen.getByLabelText("Раздел отзывов"), "sent")
  await userEvent.selectOptions(
    screen.getByLabelText("Роль получателя"),
    "DRIVER"
  )
  fireEvent.change(screen.getByLabelText("Оценка от"), {
    target: { value: "3" },
  })
  fireEvent.change(screen.getByLabelText("Оценка до"), {
    target: { value: "5" },
  })
  fireEvent.change(screen.getByLabelText("Отзыв от"), {
    target: { value: "2026-11-03T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Отзыв до"), {
    target: { value: "2026-11-04T08:00" },
  })
  await userEvent.selectOptions(
    screen.getByLabelText("Сортировка отзывов"),
    "oldest"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Кому: Иван Петров")
  const url = new URL(
    String(
      mock.mock.calls.find(([url]) =>
        String(url).includes("direction=sent")
      )?.[0]
    ),
    "http://localhost"
  )
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    q: "Анна",
    direction: "sent",
    recipientRole: "DRIVER",
    ratingMin: "3",
    ratingMax: "5",
    dateFrom: "2026-11-03T08:00:00+05:00",
    dateTo: "2026-11-04T08:00:00+05:00",
    sort: "oldest",
    page: "1",
  })
})
it("проверяет диапазоны без отправки запросов", async () => {
  await start()
  fireEvent.change(screen.getByLabelText("Оценка от"), {
    target: { value: "5" },
  })
  fireEvent.change(screen.getByLabelText("Оценка до"), {
    target: { value: "2" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Минимальная оценка больше максимальной"
  )
  expect(mock).toHaveBeenCalledTimes(2)
})
it("переходит по страницам с сохранением запроса и сбрасывает фильтры", async () => {
  await start(page([row], 11))
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await waitFor(() =>
    expect(
      mock.mock.calls.some(([url]) =>
        String(url).includes("direction=received&page=2")
      )
    ).toBe(true)
  )
  await screen.findByText("Страница 2 из 2")
  await userEvent.click(
    screen.getByRole("button", { name: "Сбросить фильтры" })
  )
  await screen.findByText("Страница 1 из 2")
})
it("показывает пустой список и безопасно выводит HTML в отзыве", async () => {
  const view = await start(page([]))
  expect(screen.getByText("Нет отзывов по выбранным условиям.")).toBeTruthy()
  view.unmount()
  await start(page([{ ...row, comment: "<script>alert(1)</script>" }]))
  expect(screen.getByText("<script>alert(1)</script>")).toBeTruthy()
  expect(document.querySelector("script")).toBeNull()
})
it("ошибка загрузки позволяет повторить запрос", async () => {
  mock.mockImplementation(async (url) =>
    String(url).endsWith("ratings")
      ? json(ratings)
      : json({ message: "Временно недоступно" }, 503)
  )
  vi.stubGlobal("fetch", mock)
  render(<ReviewsScreen userId="user" onExpired={expired} />)
  await screen.findByText("Временно недоступно")
  mock.mockImplementation(async (url) =>
    json(String(url).endsWith("ratings") ? ratings : page())
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  await screen.findByText("Всего отзывов: 1")
})
it("при 401 вызывает вход, а поздний ответ после ухода игнорирует", async () => {
  mock.mockResolvedValue(json({ message: "Вход" }, 401))
  vi.stubGlobal("fetch", mock)
  const first = render(<ReviewsScreen userId="user" onExpired={expired} />)
  await waitFor(() => expect(expired).toHaveBeenCalledOnce())
  first.unmount()
  expired.mockReset()
  let resolve!: (value: Response) => void
  mock.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const second = render(<ReviewsScreen userId="user" onExpired={expired} />)
  second.unmount()
  await act(async () => resolve(json({ message: "Вход" }, 401)))
  expect(expired).not.toHaveBeenCalled()
})
it.each(["PASSENGER", "DRIVER", "ADMIN"] as const)(
  "раздел доступен роли %s по ссылке уведомления",
  async (role) => {
    window.history.replaceState(null, "", "/#/reviews")
    mock.mockImplementation(async (url) =>
      json(String(url).endsWith("ratings") ? ratings : page())
    )
    vi.stubGlobal("fetch", mock)
    render(
      <Cabinet
        user={{
          id: "user",
          fullName: "Анна",
          email: "anna@example.ru",
          affiliation: null,
          roles: [role],
        }}
        onExpired={expired}
        onSaved={vi.fn()}
      />
    )
    await screen.findByRole("heading", { name: "Мои отзывы и рейтинги" })
    expect(
      screen
        .getByRole("link", { name: "Отзывы и рейтинги" })
        .getAttribute("aria-current")
    ).toBe("page")
    await screen.findByText("Всего отзывов: 1")
  }
)
