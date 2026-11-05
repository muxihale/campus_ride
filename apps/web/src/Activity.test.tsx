import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { ActivityScreen } from "./Activity"
import { Cabinet } from "./Cabinet"
import type { User } from "./auth"
const id = "11111111-1111-4111-8111-111111111111"
const row = {
  id: "event",
  action: "review.created",
  resourceType: "review",
  resourceId: id,
  reason: null as string | null,
  createdAt: "2026-11-05T03:00:00Z",
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (items = [row], total = items.length, current = 1) => ({
  items,
  total,
  page: current,
  pageSize: 10,
})
const mock = vi.fn<typeof fetch>(),
  expired = vi.fn()
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  mock.mockReset()
  expired.mockReset()
  window.history.replaceState(null, "", "/")
})
async function start(
  items = [row],
  roles: User["roles"] = ["PASSENGER"],
  total = items.length
) {
  mock.mockImplementation(async (url) =>
    json(
      page(
        items,
        total,
        Number(
          new URL(String(url), "http://localhost").searchParams.get("page") || 1
        )
      )
    )
  )
  vi.stubGlobal("fetch", mock)
  const view = render(<ActivityScreen roles={roles} onExpired={expired} />)
  await screen.findByText(`Всего действий: ${total}`)
  return view
}
it("загружает собственную историю, переводит события и показывает время Екатеринбурга", async () => {
  await start()
  expect(mock.mock.calls[0]?.[0]).toBe("/api/me/activity?page=1&pageSize=10")
  expect(
    screen.getByRole("heading", { name: "История моих действий" })
  ).toBeTruthy()
  expect(screen.getByRole("heading", { name: "Создание отзыва" })).toBeTruthy()
  expect(screen.getByText("2026-11-05 08:00 · Екатеринбург")).toBeTruthy()
  expect(screen.getByText("Дополнительная причина не указана.")).toBeTruthy()
  expect(
    screen.getByRole("link", { name: "Открыть отзывы" }).getAttribute("href")
  ).toBe("#/reviews")
})
it("применяет поиск, действие, объект и даты без передачи автора", async () => {
  await start()
  await userEvent.type(
    screen.getByLabelText("Поиск по причине или объекту"),
    "перенос"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Действие"),
    "booking.cancelled"
  )
  await userEvent.selectOptions(screen.getByLabelText("Тип объекта"), "booking")
  await userEvent.type(screen.getByLabelText("Номер объекта"), id)
  fireEvent.change(screen.getByLabelText("Действие от"), {
    target: { value: "2026-11-01T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Действие до"), {
    target: { value: "2026-11-05T08:00" },
  })
  await userEvent.selectOptions(
    screen.getByLabelText("Сортировка действий"),
    "oldest"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего действий: 1")
  expect(
    Object.fromEntries(
      new URL(String(mock.mock.calls.at(-1)?.[0]), "http://localhost")
        .searchParams
    )
  ).toEqual({
    q: "перенос",
    action: "booking.cancelled",
    resourceType: "booking",
    resourceId: id,
    dateFrom: "2026-11-01T08:00:00+05:00",
    dateTo: "2026-11-05T08:00:00+05:00",
    sort: "oldest",
    page: "1",
    pageSize: "10",
  })
})
it("проверяет UUID и обратный диапазон без запроса", async () => {
  await start()
  await userEvent.type(screen.getByLabelText("Номер объекта"), "bad")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Номер объекта должен быть UUID")
  await userEvent.clear(screen.getByLabelText("Номер объекта"))
  fireEvent.change(screen.getByLabelText("Действие от"), {
    target: { value: "2026-11-05T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Действие до"), {
    target: { value: "2026-11-01T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Начало диапазона позже конца")
  expect(mock).toHaveBeenCalledTimes(1)
})
it("сохраняет фильтры на страницах и сбрасывает их на первую", async () => {
  await start([row], ["PASSENGER"], 11)
  await userEvent.selectOptions(
    screen.getByLabelText("Действие"),
    "review.created"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего действий: 11")
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await screen.findByText("Страница 2 из 2")
  expect(
    new URL(
      String(mock.mock.calls.at(-1)?.[0]),
      "http://localhost"
    ).searchParams.get("action")
  ).toBe("review.created")
  await userEvent.click(
    screen.getByRole("button", { name: "Сбросить фильтры" })
  )
  await screen.findByText("Страница 1 из 2")
  expect(String(mock.mock.calls.at(-1)?.[0])).toBe(
    "/api/me/activity?page=1&pageSize=10"
  )
})
it("при сокращении выдачи выбирает существующую страницу", async () => {
  await start([row], ["PASSENGER"], 11)
  mock.mockImplementation(async () => json(page([row], 1)))
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await screen.findByText("Страница 1 из 1")
  expect(String(mock.mock.calls.at(-1)?.[0])).toContain("page=1")
})
it("показывает пустой результат и причину как текст", async () => {
  const first = await start([])
  expect(screen.getByText("Нет действий по выбранным условиям.")).toBeTruthy()
  first.unmount()
  await start([{ ...row, reason: '<img src=x onerror="alert(1)">' }])
  expect(
    screen.getByText('Причина: <img src=x onerror="alert(1)">')
  ).toBeTruthy()
  expect(document.querySelector("img")).toBeNull()
})
it.each(["network", "503"])(
  "ошибка %s допускает повтор GET с сохранением фильтра",
  async (failure) => {
    await start()
    await userEvent.selectOptions(
      screen.getByLabelText("Действие"),
      "review.created"
    )
    if (failure === "network") mock.mockRejectedValueOnce(new Error("offline"))
    else mock.mockResolvedValueOnce(json({ message: "Ошибка истории" }, 503))
    await userEvent.click(
      screen.getByRole("button", { name: "Применить фильтры" })
    )
    await screen.findByRole("alert")
    await userEvent.click(
      screen.getByRole("button", { name: "Повторить загрузку" })
    )
    await screen.findByText("Всего действий: 1")
    expect(String(mock.mock.calls.at(-1)?.[0])).toContain(
      "action=review.created"
    )
  }
)
it("401 возвращает к входу, а 403 скрывает записи", async () => {
  mock.mockResolvedValueOnce(json({ message: "Вход" }, 401))
  vi.stubGlobal("fetch", mock)
  const view = render(
    <ActivityScreen roles={["PASSENGER"]} onExpired={expired} />
  )
  await waitFor(() => expect(expired).toHaveBeenCalledOnce())
  view.unmount()
  mock.mockResolvedValueOnce(json({ message: "Нет роли" }, 403))
  render(<ActivityScreen roles={["PASSENGER"]} onExpired={expired} />)
  await screen.findByText(
    "Доступ к истории запрещён. Проверьте права аккаунта."
  )
  expect(screen.queryByRole("list", { name: "Мои действия" })).toBeNull()
})
it("после ухода не обрабатывает поздний ответ", async () => {
  let resolve!: (value: Response) => void
  mock.mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  vi.stubGlobal("fetch", mock)
  const view = render(
    <ActivityScreen roles={["PASSENGER"]} onExpired={expired} />
  )
  view.unmount()
  await act(async () => resolve(json({ message: "Вход" }, 401)))
  expect(expired).not.toHaveBeenCalled()
})
it("водитель открывает свои поездки, а пользователь с двумя ролями выбирает список заявок", async () => {
  const rideEvent = {
    ...row,
    id: "ride-event",
    action: "ride.completed",
    resourceType: "ride",
  }
  const first = await start([rideEvent], ["DRIVER"])
  expect(
    screen
      .getByRole("link", { name: "Открыть мои поездки" })
      .getAttribute("href")
  ).toBe("#/rides")
  expect(screen.queryByRole("link", { name: "Открыть мои заявки" })).toBeNull()
  first.unmount()
  await start(
    [{ ...row, action: "payment.refunded", resourceType: "payment" }],
    ["PASSENGER", "DRIVER"]
  )
  expect(
    screen
      .getByRole("link", { name: "Открыть мои заявки" })
      .getAttribute("href")
  ).toBe("#/bookings")
  expect(
    screen
      .getByRole("link", { name: "Открыть заявки пассажиров" })
      .getAttribute("href")
  ).toBe("#/ride-bookings")
})
it("прошлая административная роль не даёт ссылок на закрытые разделы", async () => {
  await start(
    [{ ...row, action: "user.blocked", resourceType: "user" }],
    ["PASSENGER"]
  )
  expect(
    screen.getByRole("heading", { name: "Блокировка пользователя" })
  ).toBeTruthy()
  expect(
    screen.queryByRole("link", { name: "Открыть пользователей" })
  ).toBeNull()
})
it.each(["PASSENGER", "DRIVER", "ADMIN"] as const)(
  "общий экран доступен в кабинете роли %s",
  async (role) => {
    window.history.replaceState(null, "", "/#/activity")
    mock.mockImplementation(async () => json(page()))
    vi.stubGlobal("fetch", mock)
    render(
      <Cabinet
        user={{
          id: "user",
          fullName: "Анна",
          email: "a@example.ru",
          roles: [role],
          affiliation: null,
        }}
        onExpired={expired}
        onSaved={vi.fn()}
      />
    )
    await screen.findByText("Всего действий: 1")
    expect(
      screen
        .getByRole("link", { name: "История действий" })
        .getAttribute("aria-current")
    ).toBe("page")
    const records = screen.getByRole("list", { name: "Мои действия" })
    expect(
      within(records).getByRole("heading", { name: "Создание отзыва" })
    ).toBeTruthy()
    expect(mock.mock.calls[0]?.[0]).toBe("/api/me/activity?page=1&pageSize=10")
  }
)
