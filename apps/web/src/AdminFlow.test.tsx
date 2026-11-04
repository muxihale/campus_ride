import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, expect, it, vi } from "vitest"
import { App } from "./App"
const admin = {
  id: "admin",
  fullName: "Мария Орлова",
  email: "admin@example.ru",
  affiliation: null,
  roles: ["ADMIN"],
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.replaceState(null, "", "/")
})
it("администратор блокирует и разблокирует пользователя, скрывает и восстанавливает отзыв и видит историю", async () => {
  let blocked = false,
    hidden = false
  const history: {
    id: string
    action: string
    resourceType: string
    resourceId: string
    reason: string
    createdAt: string
  }[] = []
  const page = (items: unknown[]) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 10,
  })
  const mock = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url), "http://localhost").pathname
    if (path === "/api/auth/me") return json(admin)
    if (path === "/api/admin/users")
      return json(
        page([
          {
            id: "target",
            fullName: "Анна Соколова",
            email: "anna@example.ru",
            affiliation: "Студент УрФУ",
            roles: ["PASSENGER"],
            status: blocked ? "BLOCKED" : "ACTIVE",
            createdAt: "2026-11-04T03:00:00Z",
            updatedAt: "2026-11-04T03:00:00Z",
          },
        ])
      )
    if (path === "/api/admin/reviews")
      return json(
        page([
          {
            id: "review",
            bookingId: "booking",
            author: { id: "target", fullName: "Анна Соколова" },
            recipient: { id: "driver", fullName: "Иван Петров" },
            recipientRole: "DRIVER",
            rating: 4,
            comment: "Комфортная поездка",
            createdAt: "2026-11-04T03:00:00Z",
            hiddenAt: hidden ? "2026-11-04T04:00:00Z" : null,
            hiddenReason: hidden ? "Нарушение правил" : null,
            bookingStatus: "COMPLETED",
            rideStatus: "COMPLETED",
          },
        ])
      )
    if (path === "/api/admin/activity")
      return json(page([...history].reverse()))
    if (path === "/api/notifications")
      return json(
        page(
          history
            .filter((item) => item.action.startsWith("review."))
            .slice(-1)
            .map((item) => ({
              id: item.id,
              kind: "SYSTEM",
              title:
                item.action === "review.hidden"
                  ? "Отзыв скрыт администратором"
                  : "Отзыв восстановлен администратором",
              body: `Причина: ${item.reason}`,
              link: "#/admin/reviews",
              resourceType: "review",
              resourceId: "review",
              createdAt: item.createdAt,
              readAt: null,
            }))
        )
      )
    if (init?.method === "POST") {
      const reason = JSON.parse(String(init.body)).reason as string
      if (path.includes("/admin/users/")) {
        blocked = path.endsWith("/block")
        history.push({
          id: `event-${history.length}`,
          action: blocked ? "user.blocked" : "user.unblocked",
          resourceType: "user",
          resourceId: "target",
          reason,
          createdAt: "2026-11-04T04:00:00Z",
        })
        return json({
          changed: true,
          status: blocked ? "BLOCKED" : "ACTIVE",
          cancelledRides: 0,
          cancelledBookings: blocked ? 1 : 0,
          revokedSessions: blocked ? 1 : 0,
        })
      }
      if (path.includes("/admin/reviews/")) {
        hidden = path.endsWith("/hide")
        history.push({
          id: `event-${history.length}`,
          action: hidden ? "review.hidden" : "review.restored",
          resourceType: "review",
          resourceId: "review",
          reason,
          createdAt: "2026-11-04T04:00:00Z",
        })
        return json({
          changed: true,
          hiddenAt: hidden ? "2026-11-04T04:00:00Z" : null,
        })
      }
    }
    throw new Error(`Неожиданный запрос ${url}`)
  })
  vi.stubGlobal("fetch", mock)
  window.history.replaceState(null, "", "/#/admin/users")
  render(<App />)
  await screen.findByText("Всего пользователей: 1")
  async function decide(button: string, confirm: string, reason: string) {
    await userEvent.click(await screen.findByRole("button", { name: button }))
    await userEvent.type(screen.getByLabelText("Причина решения"), reason)
    await userEvent.click(screen.getByRole("button", { name: confirm }))
  }
  await decide(
    "Заблокировать",
    "Подтвердить блокировку",
    "Нарушение правил поездок"
  )
  await screen.findByText("Статус: Заблокирован")
  expect(blocked).toBe(true)
  await decide(
    "Разблокировать",
    "Подтвердить разблокировку",
    "Проверка завершена"
  )
  await screen.findByText("Статус: Активен")
  expect(blocked).toBe(false)
  await userEvent.click(screen.getByRole("link", { name: "Модерация отзывов" }))
  await screen.findByText("Комфортная поездка")
  await decide("Скрыть", "Подтвердить скрытие", "Нарушение правил общения")
  await screen.findByText("Отзыв скрыт")
  await userEvent.click(screen.getByRole("link", { name: "Уведомления" }))
  await screen.findByRole("heading", { name: "Отзыв скрыт администратором" })
  await userEvent.click(
    screen.getByRole("link", { name: "Открыть связанный раздел" })
  )
  await screen.findByRole("heading", { name: "Модерация отзывов" })
  await decide(
    "Восстановить",
    "Подтвердить восстановление",
    "Контекст проверен"
  )
  await screen.findByText("Отзыв видим")
  await userEvent.click(screen.getByRole("link", { name: "Мои действия" }))
  await screen.findByText("Всего действий: 4")
  for (const name of [
    "Блокировка пользователя",
    "Разблокировка пользователя",
    "Скрытие отзыва",
    "Восстановление отзыва",
  ])
    expect(screen.getByRole("heading", { name })).toBeTruthy()
  expect(screen.getByText("Причина: Контекст проверен")).toBeTruthy()
  expect(
    mock.mock.calls.filter(([, init]) => init?.method === "POST")
  ).toHaveLength(4)
  expect(history.map((item) => item.action)).toEqual([
    "user.blocked",
    "user.unblocked",
    "review.hidden",
    "review.restored",
  ])
}, 15000)
