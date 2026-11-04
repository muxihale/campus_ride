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
import { AdminUsersScreen, type AdminUser } from "./AdminUsers"
import { Cabinet } from "./Cabinet"
const target: AdminUser = {
  id: "target",
  fullName: "Анна Соколова",
  email: "anna@example.ru",
  affiliation: "Студент УрФУ",
  roles: ["PASSENGER", "DRIVER"],
  status: "ACTIVE",
  createdAt: "2026-11-04T03:00:00Z",
  updatedAt: "2026-11-04T03:00:00Z",
}
const own: AdminUser = {
  ...target,
  id: "admin",
  fullName: "Администратор",
  email: "admin@example.ru",
  roles: ["ADMIN"],
}
const result = {
  id: target.id,
  status: "BLOCKED",
  changed: true,
  cancelledRides: 1,
  cancelledBookings: 2,
  revokedSessions: 3,
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (items = [target, own], total = items.length, current = 1) => ({
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
async function start(items = [target, own], total = items.length) {
  let rows = items
  mock.mockImplementation(async (url, init) => {
    if (init?.method === "POST") {
      const blocked = String(url).endsWith("/block")
      rows = rows.map((row) =>
        row.id === target.id
          ? { ...row, status: blocked ? "BLOCKED" : "ACTIVE" }
          : row
      )
      return json({ ...result, status: blocked ? "BLOCKED" : "ACTIVE" })
    }
    const parsed = new URL(String(url), "http://localhost")
    const filtered = parsed.searchParams.get("status")
      ? rows.filter((row) => row.status === parsed.searchParams.get("status"))
      : rows
    return json(
      page(
        filtered,
        parsed.searchParams.get("status") ? filtered.length : total,
        Number(parsed.searchParams.get("page") || 1)
      )
    )
  })
  vi.stubGlobal("fetch", mock)
  const view = render(<AdminUsersScreen userId="admin" onExpired={expired} />)
  await screen.findByText(`Всего пользователей: ${total}`)
  return view
}
async function open() {
  await userEvent.click(screen.getByRole("button", { name: "Заблокировать" }))
}
async function reason() {
  fireEvent.change(screen.getByLabelText("Причина решения"), {
    target: { value: "  Нарушение правил  " },
  })
}
const writes = () =>
  mock.mock.calls.filter(([, init]) => init?.method === "POST")
it("показывает профиль, все роли, время и запрещает действие над собой", async () => {
  await start()
  expect(screen.getByText("Роли: Пассажир, Водитель")).toBeTruthy()
  expect(
    screen.getAllByText("Регистрация: 2026-11-04 08:00 · Екатеринбург")
  ).toHaveLength(2)
  expect(
    screen.getByText("Ваш аккаунт. Изменение блокировки недоступно.")
  ).toBeTruthy()
  expect(screen.getAllByRole("button", { name: "Заблокировать" })).toHaveLength(
    1
  )
})
it("отправляет поиск, четыре фильтра и даты Екатеринбурга", async () => {
  await start()
  await userEvent.type(
    screen.getByLabelText("Поиск по имени или email"),
    "Анна"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Роль пользователя"),
    "DRIVER"
  )
  await userEvent.selectOptions(
    screen.getByLabelText("Статус аккаунта"),
    "ACTIVE"
  )
  await userEvent.type(
    screen.getByLabelText("Принадлежность к университету"),
    "УрФУ"
  )
  fireEvent.change(screen.getByLabelText("Регистрация от"), {
    target: { value: "2026-11-01T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Регистрация до"), {
    target: { value: "2026-11-04T08:00" },
  })
  await userEvent.selectOptions(
    screen.getByLabelText("Сортировка пользователей"),
    "nameAsc"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего пользователей: 2")
  const url = new URL(String(mock.mock.calls.at(-1)?.[0]), "http://localhost")
  expect(Object.fromEntries(url.searchParams)).toMatchObject({
    q: "Анна",
    role: "DRIVER",
    status: "ACTIVE",
    affiliation: "УрФУ",
    registeredFrom: "2026-11-01T08:00:00+05:00",
    registeredTo: "2026-11-04T08:00:00+05:00",
    sort: "nameAsc",
    page: "1",
  })
})
it("проверяет обратный диапазон без запроса", async () => {
  await start()
  fireEvent.change(screen.getByLabelText("Регистрация от"), {
    target: { value: "2026-11-04T08:00" },
  })
  fireEvent.change(screen.getByLabelText("Регистрация до"), {
    target: { value: "2026-11-01T08:00" },
  })
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Начало диапазона регистрации позже конца")
  expect(mock).toHaveBeenCalledTimes(1)
})
it("показывает последствия и отменяет подтверждение без POST", async () => {
  await start()
  await open()
  expect(
    screen.getByRole("heading", { name: "Заблокировать пользователя?" })
  ).toBe(document.activeElement)
  expect(screen.getByText(/Все сессии завершатся/)).toBeTruthy()
  await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
  expect(writes()).toHaveLength(0)
  expect(
    screen.queryByRole("form", { name: "Изменение блокировки" })
  ).toBeNull()
})
it("блокирует после ввода причины, обновляет список и показывает результат", async () => {
  await start()
  await open()
  await reason()
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить блокировку" })
  )
  await screen.findByText("Статус: Заблокирован")
  expect(writes()[0]?.[0]).toBe("/api/admin/users/target/block")
  expect(writes()[0]?.[1]?.body).toBe(
    JSON.stringify({ reason: "Нарушение правил" })
  )
  expect(
    screen.getByText(
      "Пользователь заблокирован. Отменено поездок: 1, заявок: 2. Завершено сессий: 3."
    )
  ).toBeTruthy()
})
it("разблокирует с предупреждением о новом входе и без восстановления участий", async () => {
  await start([{ ...target, status: "BLOCKED" }])
  await userEvent.click(screen.getByRole("button", { name: "Разблокировать" }))
  expect(screen.getByText(/Старые сессии, отменённые поездки/)).toBeTruthy()
  await reason()
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить разблокировку" })
  )
  await screen.findByText("Статус: Активен")
  expect(writes()[0]?.[0]).toBe("/api/admin/users/target/unblock")
})
it.each(["   ", "а".repeat(501)])(
  "проверяет причину длиной %s без POST",
  async (value) => {
    await start()
    await open()
    fireEvent.change(screen.getByLabelText("Причина решения"), {
      target: { value },
    })
    fireEvent.submit(screen.getByRole("form", { name: "Изменение блокировки" }))
    await screen.findByText("Укажите причину от 1 до 500 символов")
    expect(writes()).toHaveLength(0)
  }
)
it("не отправляет второй POST и блокирует фильтры, пока идёт запрос", async () => {
  await start([target], 11)
  await open()
  await reason()
  let resolve!: (data: Response) => void
  mock.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  const form = screen.getByRole("form", { name: "Изменение блокировки" })
  fireEvent.submit(form)
  fireEvent.submit(form)
  expect(writes()).toHaveLength(1)
  expect(
    (
      screen.getByLabelText("Поиск по имени или email") as HTMLInputElement
    ).closest("fieldset")?.disabled
  ).toBe(true)
  expect(
    (screen.getByRole("button", { name: "Далее" }) as HTMLButtonElement)
      .disabled
  ).toBe(true)
  await act(async () => resolve(json(result)))
  await screen.findByText(/Пользователь заблокирован\./)
})
it.each(["network", "503"])(
  "при ошибке %s сохраняет причину для повтора",
  async (failure) => {
    await start()
    await open()
    await reason()
    if (failure === "network") mock.mockRejectedValueOnce(new Error("offline"))
    else mock.mockResolvedValueOnce(json({ message: "Недоступно" }, 503))
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить блокировку" })
    )
    await screen.findByRole("alert")
    expect(
      (
        screen.getByLabelText("Причина решения") as HTMLTextAreaElement
      ).value.trim()
    ).toBe("Нарушение правил")
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить блокировку" })
    )
    await screen.findByText("Статус: Заблокирован")
  }
)
it.each([404, 409])(
  "при %s закрывает устаревшее подтверждение и перечитывает список",
  async (status) => {
    await start()
    await open()
    await reason()
    mock.mockResolvedValueOnce(json({ message: "Данные изменились" }, status))
    await userEvent.click(
      screen.getByRole("button", { name: "Подтвердить блокировку" })
    )
    await screen.findByText("Данные изменились")
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(3))
    expect(
      screen.queryByRole("form", { name: "Изменение блокировки" })
    ).toBeNull()
  }
)
it("сохраняет фильтр после блокировки и удаляет несовпадающего пользователя из выдачи", async () => {
  await start([target])
  await userEvent.selectOptions(
    screen.getByLabelText("Статус аккаунта"),
    "ACTIVE"
  )
  await userEvent.click(
    screen.getByRole("button", { name: "Применить фильтры" })
  )
  await screen.findByText("Всего пользователей: 1")
  await open()
  await reason()
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить блокировку" })
  )
  await screen.findByText("Нет пользователей по выбранным условиям.")
  expect(String(mock.mock.calls.at(-1)?.[0])).toContain("status=ACTIVE")
})
it("после успеха и ошибки обновления повторяет только GET", async () => {
  await start()
  await open()
  await reason()
  mock
    .mockResolvedValueOnce(json(result))
    .mockResolvedValueOnce(json({ message: "Ошибка списка" }, 503))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить блокировку" })
  )
  await screen.findByText("Ошибка списка")
  expect(screen.getByText(/Пользователь заблокирован\./)).toBeTruthy()
  await userEvent.click(
    screen.getByRole("button", { name: "Повторить загрузку" })
  )
  await screen.findByText("Всего пользователей: 2")
  expect(writes()).toHaveLength(1)
})
it("403 при мутации скрывает список и запрещает дальнейшие действия", async () => {
  await start()
  await open()
  await reason()
  mock.mockResolvedValueOnce(json({ message: "Нет прав" }, 403))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить блокировку" })
  )
  await screen.findByText(/Доступ к управлению пользователями запрещён/)
  expect(screen.queryByText(target.email)).toBeNull()
  expect(screen.queryByRole("button", { name: "Заблокировать" })).toBeNull()
})
it("401 возвращает к входу, поздняя ошибка после ухода игнорируется", async () => {
  const view = await start()
  await open()
  await reason()
  mock.mockResolvedValueOnce(json({ message: "Вход" }, 401))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить блокировку" })
  )
  await waitFor(() => expect(expired).toHaveBeenCalledOnce())
  view.unmount()
  expired.mockReset()
  const second = await start()
  await open()
  await reason()
  let resolve!: (value: Response) => void
  mock.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  fireEvent.submit(screen.getByRole("form", { name: "Изменение блокировки" }))
  second.unmount()
  await act(async () => resolve(json({ message: "Вход" }, 401)))
  expect(expired).not.toHaveBeenCalled()
})
it("пагинация и сброс фильтров возвращают первую страницу", async () => {
  await start([target], 11)
  await userEvent.click(screen.getByRole("button", { name: "Далее" }))
  await screen.findByText("Страница 2 из 2")
  await userEvent.click(
    screen.getByRole("button", { name: "Сбросить фильтры" })
  )
  await screen.findByText("Страница 1 из 2")
})
it.each(["PASSENGER", "DRIVER", "ADMIN"] as const)(
  "доступ к маршруту пользователей для роли %s",
  async (role) => {
    window.history.replaceState(null, "", "/#/admin/users")
    mock.mockResolvedValue(json(page()))
    vi.stubGlobal("fetch", mock)
    render(
      <Cabinet
        user={{
          id: "admin",
          fullName: "Анна",
          email: "a@example.ru",
          roles: [role],
          affiliation: null,
        }}
        onExpired={expired}
        onSaved={vi.fn()}
      />
    )
    if (role === "ADMIN") {
      await screen.findByText("Всего пользователей: 2")
      expect(
        screen
          .getByRole("link", { name: "Пользователи" })
          .getAttribute("aria-current")
      ).toBe("page")
    } else {
      await screen.findByRole("heading", { name: "Раздел недоступен" })
      expect(mock).not.toHaveBeenCalled()
    }
  }
)

it("повтор уже выполненного решения показывает актуальный статус без повторной команды", async () => {
  await start()
  await open()
  await reason()
  mock
    .mockResolvedValueOnce(
      json({
        ...result,
        changed: false,
        cancelledRides: 0,
        cancelledBookings: 0,
        revokedSessions: 0,
      })
    )
    .mockResolvedValueOnce(json(page([{ ...target, status: "BLOCKED" }])))
  await userEvent.click(
    screen.getByRole("button", { name: "Подтвердить блокировку" })
  )
  await screen.findByText(
    "Статус пользователя уже установлен. Данные обновлены."
  )
  await screen.findByText("Статус: Заблокирован")
  expect(writes()).toHaveLength(1)
})
