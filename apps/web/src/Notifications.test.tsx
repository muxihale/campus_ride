import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { NotificationsScreen, type Notification } from "./Notifications"
const item: Notification = {
  id: "notification",
  kind: "BOOKING_CONFIRMED",
  title: "Заявка подтверждена",
  body: "Уралмаш → УрФУ. Мест: 2.",
  link: "#/bookings",
  resourceType: "booking",
  resourceId: "booking",
  createdAt: "2026-10-31T03:00:00Z",
  readAt: null,
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (items = [item], total = items.length, current = 1) => ({
  items,
  total,
  page: current,
  pageSize: 10,
})
const fetchMock = vi.fn<typeof fetch>(),
  onExpired = vi.fn()
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  onExpired.mockReset()
})
async function start(data = page()) {
  fetchMock.mockImplementation(async () => json(data))
  vi.stubGlobal("fetch", fetchMock)
  render(<NotificationsScreen onExpired={onExpired} />)
  await screen.findByText(`Всего уведомлений: ${data.total}`)
}
it("показывает уведомление, время Екатеринбурга и ссылку на связанный раздел", async () => {
  await start()
  expect(screen.getByRole("heading", { name: item.title })).toBeTruthy()
  expect(screen.getByText("2026-10-31 08:00 · Екатеринбург")).toBeTruthy()
  expect(
    screen
      .getByRole("link", { name: "Открыть связанный раздел" })
      .getAttribute("href")
  ).toBe("#/bookings")
})
it("сохраняет false, фильтры и переводит даты в Екатеринбург", async () => {
  await start()
  await userEvent.type(
    screen.getByLabelText("Поиск по уведомлениям"),
    "Уралмаш"
  )
  await userEvent.selectOptions(screen.getByLabelText("Прочтение"), "false")
  await userEvent.selectOptions(
    screen.getByLabelText("Тип уведомления"),
    "BOOKING_CONFIRMED"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Объект уведомления"),
    "booking"
  )
  fireEvent.change(screen.getByLabelText("Получено от"), {
    target: { value: "2026-10-31T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  const params = new URLSearchParams(
    String(fetchMock.mock.calls[1]![0]).split("?")[1]
  )
  expect(Object.fromEntries(params)).toEqual({
    q: "Уралмаш",
    read: "false",
    kind: "BOOKING_CONFIRMED",
    resourceType: "booking",
    dateFrom: "2026-10-31T08:00:00+05:00",
    page: "1",
    pageSize: "10",
  })
})
it("помечает прочитанным через PATCH и обновляет список", async () => {
  await start()
  fetchMock
    .mockResolvedValueOnce(json({ ...item, readAt: "2026-10-31T04:00:00Z" }))
    .mockResolvedValueOnce(
      json(page([{ ...item, readAt: "2026-10-31T04:00:00Z" }]))
    )
  await userEvent.click(
    screen.getByRole("button", { name: "Отметить прочитанным" })
  )
  await screen.findByText("Прочитано")
  expect(fetchMock.mock.calls[1]![0]).toBe(
    "/api/notifications/notification/read"
  )
  expect(fetchMock.mock.calls[1]![1]?.method).toBe("PATCH")
  expect(
    screen.queryByRole("button", { name: "Отметить прочитанным" })
  ).toBeNull()
})
it("не скрывает непрочитанное уведомление при ошибке отметки", async () => {
  await start()
  fetchMock.mockRejectedValueOnce(new TypeError("Offline"))
  await userEvent.click(
    screen.getByRole("button", { name: "Отметить прочитанным" })
  )
  await screen.findByRole("alert")
  expect(screen.getByText("Новое")).toBeTruthy()
})
it("показывает пустой список и отсутствие совпадений", async () => {
  await start(page([]))
  expect(screen.getByText("У вас пока нет уведомлений.")).toBeTruthy()
  await userEvent.selectOptions(screen.getByLabelText("Прочтение"), "false")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  expect(
    await screen.findByText("Нет уведомлений по выбранным условиям.")
  ).toBeTruthy()
})
it("возвращает вход при истечении сессии", async () => {
  fetchMock.mockResolvedValue(json({ message: "Войдите" }, 401))
  vi.stubGlobal("fetch", fetchMock)
  render(<NotificationsScreen onExpired={onExpired} />)
  await waitFor(() => expect(onExpired).toHaveBeenCalledOnce())
})
it("повторяет загрузку после сбоя", async () => {
  fetchMock
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockImplementation(async () => json(page()))
  vi.stubGlobal("fetch", fetchMock)
  render(<NotificationsScreen onExpired={onExpired} />)
  await screen.findByRole("alert")
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  await screen.findByText("Всего уведомлений: 1")
})
it("не открывает произвольные ссылки из данных", async () => {
  await start(page([{ ...item, link: "https://other.test" }]))
  expect(screen.queryByRole("link")).toBeNull()
})
it("сохраняет фильтры при пагинации и сбрасывает страницу при сбросе", async () => {
  await start(page([item], 21))
  await userEvent.selectOptions(screen.getByLabelText("Прочтение"), "false")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего уведомлений: 21")
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await waitFor(() =>
    expect(String(fetchMock.mock.calls.at(-1)![0])).toContain(
      "read=false&page=2"
    )
  )
  await screen.findByText("Всего уведомлений: 21")
  await userEvent.click(
    screen.getByRole("button", { name: "Сбросить фильтры" })
  )
  await waitFor(() =>
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(
      "/api/notifications?page=1&pageSize=10"
    )
  )
})

it("уведомление об отзыве открывает раздел отзывов", async () => {
  await start(
    page([
      {
        ...item,
        kind: "REVIEW_RECEIVED",
        title: "Вы получили новый отзыв",
        body: "Вас оценили как водителя. Оценка: 5 из 5.",
        link: "#/reviews",
        resourceType: "review",
      },
    ])
  )
  expect(
    screen
      .getByRole("link", { name: "Открыть связанный раздел" })
      .getAttribute("href")
  ).toBe("#/reviews")
  expect(
    screen.getByRole("heading", { name: "Вы получили новый отзыв" })
  ).toBeTruthy()
})

it.each(["#/profile", "#/admin", "#/rides"])(
  "уведомление о блокировке или отмене открывает %s",
  async (link) => {
    await start(
      page([
        {
          ...item,
          kind: "SYSTEM",
          title: "Изменение блокировки",
          resourceType: "user",
          link,
        },
      ])
    )
    expect(
      screen
        .getByRole("link", { name: "Открыть связанный раздел" })
        .getAttribute("href")
    ).toBe(link)
  }
)

it("уведомление о модерации открывает экран администратора", async () => {
  await start(
    page([
      {
        ...item,
        kind: "SYSTEM",
        title: "Отзыв скрыт администратором",
        resourceType: "review",
        link: "#/admin/reviews",
      },
    ])
  )
  expect(
    screen
      .getByRole("link", { name: "Открыть связанный раздел" })
      .getAttribute("href")
  ).toBe("#/admin/reviews")
})
