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
import { AdminReviewsScreen, type AdminReview } from "./AdminReviews"
import { AdminActivityScreen } from "./AdminActivity"
import { Cabinet } from "./Cabinet"
const row: AdminReview = {
  id: "review-one",
  bookingId: "booking-one",
  author: { id: "passenger", fullName: "Анна Соколова" },
  recipient: { id: "driver", fullName: "Иван Петров" },
  recipientRole: "DRIVER",
  rating: 4,
  comment: "Комфортная поездка",
  createdAt: "2026-11-04T03:00:00Z",
  hiddenAt: null,
  hiddenReason: null,
  bookingStatus: "COMPLETED",
  rideStatus: "COMPLETED",
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (items: unknown[], total = items.length, current = 1) => ({
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
async function start(hidden = false, total = 1) {
  let current = {
    ...row,
    hiddenAt: hidden ? "2026-11-04T03:00:00Z" : null,
    hiddenReason: hidden ? "Нарушение правил" : null,
  }
  mock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      const hide = String(url).endsWith("/hide")
      current = {
        ...current,
        hiddenAt: hide ? "2026-11-04T04:00:00Z" : null,
        hiddenReason: hide ? JSON.parse(String(init.body)).reason : null,
      }
      return json({ ...current, changed: true })
    }
    const params = new URL(String(url), "http://localhost").searchParams
    const visible = params.get("hidden")
    const items =
      visible === null || Boolean(current.hiddenAt) === (visible === "true")
        ? [current]
        : []
    return json(
      page(items, items.length ? total : 0, Number(params.get("page") || 1))
    )
  })
  vi.stubGlobal("fetch", mock)
  const view = render(<AdminReviewsScreen onExpired={expired} />)
  await screen.findByText(`Всего отзывов: ${total}`)
  return view
}
async function open(hidden = false) {
  await userEvent.click(
    screen.getByRole("button", { name: hidden ? "Восстановить" : "Скрыть" })
  )
}
async function fill() {
  fireEvent.change(screen.getByLabelText("Причина решения"), {
    target: { value: "  Проверен контекст  " },
  })
}
const writes = () =>
  mock.mock.calls.filter(([, init]) => init?.method === "POST")
it.each([false, true])(
  "подтверждает модерацию с причиной (скрыт=%s)",
  async (hidden) => {
    await start(hidden)
    await open(hidden)
    expect(
      screen.getByRole("heading", {
        name: hidden ? "Восстановить отзыв?" : "Скрыть отзыв?",
      })
    ).toBe(document.activeElement)
    expect(writes()).toHaveLength(0)
    await fill()
    await userEvent.click(
      screen.getByRole("button", {
        name: hidden ? "Подтвердить восстановление" : "Подтвердить скрытие",
      })
    )
    await screen.findByText(hidden ? "Отзыв видим" : "Отзыв скрыт")
    expect(writes()[0]?.[0]).toBe(
      `/api/admin/reviews/review-one/${hidden ? "restore" : "hide"}`
    )
    expect(writes()[0]?.[1]?.body).toBe(
      JSON.stringify({ reason: "Проверен контекст" })
    )
  }
)
it("отмена и неверная причина не отправляют POST", async () => {
  await start()
  await open()
  fireEvent.submit(screen.getByRole("form", { name: "Решение по отзыву" }))
  await screen.findByText("Укажите причину от 1 до 500 символов")
  await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
  expect(writes()).toHaveLength(0)
})
it("применяет четыре фильтра, сортировку и даты Екатеринбурга", async () => {
  await start()
  await userEvent.type(
    screen.getByLabelText("Поиск по отзыву, причине или имени"),
    "Анна"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Видимость отзыва"),
    "false"
  )
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
    target: { value: "2026-11-01T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Отзыв до"), {
    target: { value: "2026-11-04T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего отзывов: 1")
  const params = new URL(
    String(mock.mock.calls.at(-1)?.[0]),
    "http://localhost"
  ).searchParams
  expect(Object.fromEntries(params)).toMatchObject({
    q: "Анна",
    hidden: "false",
    recipientRole: "DRIVER",
    ratingMin: "3",
    ratingMax: "5",
    dateFrom: "2026-11-01T08:00:00+05:00",
    dateTo: "2026-11-04T08:00:00+05:00",
  })
  await open()
  await fill()
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText("Нет отзывов по выбранным условиям.")
  expect(String(mock.mock.calls.at(-1)?.[0])).toContain("hidden=false")
})
it("проверяет диапазон оценок без запроса", async () => {
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
  await screen.findByText("Минимальная оценка больше максимальной")
  expect(mock).toHaveBeenCalledTimes(1)
})
it("блокирует двойную отправку и фильтры", async () => {
  await start()
  await open()
  await fill()
  let resolve!: (data: Response) => void
  mock.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  const form = screen.getByRole("form", { name: "Решение по отзыву" })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(writes()).toHaveLength(1)
  expect(
    (screen.getByLabelText("Видимость отзыва") as HTMLSelectElement).closest(
      "fieldset"
    )?.disabled
  ).toBe(true)
  await act(async () => resolve(json({ changed: true })))
  await screen.findByText("Отзыв скрыт и исключён из рейтингов.")
})
it("503 сохраняет причину для безопасного повтора", async () => {
  await start()
  await open()
  await fill()
  mock.mockResolvedValueOnce(json({ message: "Временно недоступно" }, 503))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText("Временно недоступно")
  expect(
    (
      screen.getByLabelText("Причина решения") as HTMLTextAreaElement
    ).value.trim()
  ).toBe("Проверен контекст")
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText("Отзыв скрыт")
})
it("404 закрывает устаревшее подтверждение и перечитывает список", async () => {
  await start()
  await open()
  await fill()
  mock.mockResolvedValueOnce(json({ message: "Отзыв не найден" }, 404))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText("Отзыв не найден")
  await waitFor(() => expect(mock).toHaveBeenCalledTimes(3))
  expect(screen.queryByRole("form", { name: "Решение по отзыву" })).toBeNull()
})
it("после успеха и ошибки GET повторяет только загрузку", async () => {
  await start()
  await open()
  await fill()
  mock
    .mockResolvedValueOnce(json({ changed: true }))
    .mockResolvedValueOnce(json({ message: "Ошибка списка" }, 503))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText("Ошибка списка")
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  await screen.findByText("Всего отзывов: 1")
  expect(writes()).toHaveLength(1)
})
it("403 скрывает данные и команды", async () => {
  await start()
  await open()
  await fill()
  mock.mockResolvedValueOnce(json({ message: "Нет прав" }, 403))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText(/Доступ к модерации запрещён/)
  expect(screen.queryByText(row.comment)).toBeNull()
  expect(screen.queryByRole("button", { name: "Скрыть" })).toBeNull()
})
it("после ухода игнорирует позднюю ошибку сессии", async () => {
  const view = await start()
  await open()
  await fill()
  let resolve!: (data: Response) => void
  mock.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  fireEvent.submit(screen.getByRole("form", { name: "Решение по отзыву" }))
  view.unmount()
  await act(async () => resolve(json({ message: "Вход" }, 401)))
  expect(expired).not.toHaveBeenCalled()
})
it("история показывает причину и отправляет фильтры собственных действий", async () => {
  const id = "11111111-1111-4111-8111-111111111111"
  mock.mockImplementation(async () =>
    json(
      page([
        {
          id: "action",
          action: "review.hidden",
          resourceType: "review",
          resourceId: id,
          reason: "Проверен контекст",
          createdAt: "2026-11-04T03:00:00Z",
        },
      ])
    )
  )
  vi.stubGlobal("fetch", mock)
  render(<AdminActivityScreen onExpired={expired} />)
  await screen.findByText("Всего действий: 1")
  expect(screen.getByRole("heading", { name: "Скрытие отзыва" })).toBeTruthy()
  expect(screen.getByText("Причина: Проверен контекст")).toBeTruthy()
  await userEvent.type(
    screen.getByLabelText("Поиск по причине или объекту"),
    "контекст"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Действие"),
    "review.hidden"
  )
  await userEvent.selectOptions(screen.getByLabelText("Тип объекта"), "review")
  await userEvent.type(screen.getByLabelText("Номер объекта"), id)
  fireEvent.change(screen.getByLabelText("Действие от"), {
    target: { value: "2026-11-01T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего действий: 1")
  const params = new URL(
    String(mock.mock.calls.at(-1)?.[0]),
    "http://localhost"
  ).searchParams
  expect(Object.fromEntries(params)).toMatchObject({
    q: "контекст",
    action: "review.hidden",
    resourceType: "review",
    resourceId: id,
    dateFrom: "2026-11-01T08:00:00+05:00",
  })
  expect(
    screen
      .getByRole("link", { name: "Открыть раздел объекта" })
      .getAttribute("href")
  ).toBe("#/admin/reviews")
})
it("история обрабатывает ошибку, повтор и неверный номер объекта", async () => {
  mock
    .mockResolvedValueOnce(json({ message: "Ошибка истории" }, 503))
    .mockResolvedValue(json(page([])))
  vi.stubGlobal("fetch", mock)
  render(<AdminActivityScreen onExpired={expired} />)
  await screen.findByText("Ошибка истории")
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  await screen.findByText("Нет действий по выбранным условиям.")
  await userEvent.type(screen.getByLabelText("Номер объекта"), "bad")
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Номер объекта должен быть UUID")
  expect(mock).toHaveBeenCalledTimes(2)
})
it.each(["admin/reviews", "admin/activity"])(
  "маршрут %s доступен только администратору",
  async (path) => {
    window.history.replaceState(null, "", `/#/${path}`)
    mock.mockResolvedValue(json(page([])))
    vi.stubGlobal("fetch", mock)
    const props = { onExpired: expired, onSaved: vi.fn() }
    const user = {
      id: "user",
      fullName: "Анна",
      email: "a@example.ru",
      affiliation: null,
    }
    const view = render(
      <Cabinet {...props} user={{ ...user, roles: ["PASSENGER"] }} />
    )
    await screen.findByRole("heading", { name: "Раздел недоступен" })
    expect(mock).not.toHaveBeenCalled()
    view.unmount()
    render(<Cabinet {...props} user={{ ...user, roles: ["ADMIN"] }} />)
    await screen.findByRole("heading", {
      name: path.endsWith("reviews")
        ? "Модерация отзывов"
        : "Мои действия администратора",
    })
    await waitFor(() => expect(mock).toHaveBeenCalledOnce())
    expect(
      screen
        .getByRole("link", {
          name: path.endsWith("reviews") ? "Модерация отзывов" : "Мои действия",
        })
        .getAttribute("aria-current")
    ).toBe("page")
  }
)

it.each(["reviews", "activity"])(
  "истечение сессии на экране %s возвращает к входу",
  async (kind) => {
    mock.mockImplementation(async () =>
      json({ message: "Требуется вход" }, 401)
    )
    vi.stubGlobal("fetch", mock)
    render(
      kind === "reviews" ? (
        <AdminReviewsScreen onExpired={expired} />
      ) : (
        <AdminActivityScreen onExpired={expired} />
      )
    )
    await waitFor(() => expect(expired).toHaveBeenCalledOnce())
  }
)
it("повтор уже выполненной модерации обновляет список без новой команды", async () => {
  await start()
  await open()
  await fill()
  mock.mockResolvedValueOnce(json({ changed: false }))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить скрытие" })
  )
  await screen.findByText("Видимость отзыва уже установлена. Данные обновлены.")
  expect(writes()).toHaveLength(1)
  expect(screen.queryByRole("form", { name: "Решение по отзыву" })).toBeNull()
})
it("история сохраняет фильтр при переходе по страницам и скрывает данные при 403", async () => {
  mock.mockImplementation(async (url) =>
    json(
      page(
        [
          {
            id: "action",
            action: "review.hidden",
            resourceType: "review",
            resourceId: "review",
            reason: "Проверка",
            createdAt: "2026-11-04T03:00:00Z",
          },
        ],
        11,
        Number(
          new URL(String(url), "http://localhost").searchParams.get("page") || 1
        )
      )
    )
  )
  vi.stubGlobal("fetch", mock)
  render(<AdminActivityScreen onExpired={expired} />)
  await screen.findByText("Всего действий: 11")
  await userEvent.selectOptions(
    screen.getByLabelText("Действие"),
    "review.hidden"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего действий: 11")
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await screen.findByText("Страница 2 из 2")
  expect(
    Object.fromEntries(
      new URL(String(mock.mock.calls.at(-1)?.[0]), "http://localhost")
        .searchParams
    )
  ).toMatchObject({ action: "review.hidden", page: "2" })
  mock.mockResolvedValueOnce(json({ message: "Нет прав" }, 403))
  await userEvent.click(
    screen.getByRole("button", { name: "Обновить историю" })
  )
  await screen.findByText(/Доступ к истории запрещён/)
  expect(screen.queryByText("Причина: Проверка")).toBeNull()
})
