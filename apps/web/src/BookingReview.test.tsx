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
import { afterEach, describe, expect, it, vi } from "vitest"
import { BookingReview } from "./BookingReview"
import { BookingsScreen } from "./Bookings"
const fetchMock = vi.fn<typeof fetch>()
const expired = vi.fn()
const existing = {
  id: "review-one",
  rating: 4,
  comment: "Водитель приехал вовремя.",
  createdAt: "2026-11-03T08:30:00Z",
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status })
const page = (items: unknown[] = []) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 1,
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  expired.mockReset()
})
describe.each(["DRIVER", "PASSENGER"] as const)(
  "Форма отзыва получателю %s",
  (role) => {
    const action = role === "DRIVER" ? "Оценить водителя" : "Оценить пассажира"
    const ratingLabel =
      role === "DRIVER" ? "Оценка водителя" : "Оценка пассажира"
    async function start(items: unknown[] = []) {
      fetchMock.mockResolvedValue(json(page(items)))
      vi.stubGlobal("fetch", fetchMock)
      const view = render(
        <BookingReview
          bookingId="booking-one"
          recipientRole={role}
          recipientName="Иван Петров"
          onExpired={expired}
        />
      )
      await screen.findByText(items.length ? "Оценка: 4 из 5" : action)
      return view
    }
    async function fill() {
      await userEvent.click(screen.getByRole("button", { name: action }))
      await userEvent.selectOptions(screen.getByLabelText(ratingLabel), "4")
      fireEvent.change(screen.getByLabelText("Комментарий о поездке"), {
        target: { value: "  Водитель приехал вовремя.  " },
      })
    }
    it("загружает отзыв только по текущей заявке и показывает сохранённую оценку", async () => {
      await start([existing])
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        "/api/me/reviews?direction=sent&bookingId=booking-one&pageSize=1"
      )
      expect(screen.getByText(existing.comment)).toBeTruthy()
      expect(screen.getByText("2026-11-03 13:30 · Екатеринбург")).toBeTruthy()
      expect(screen.queryByRole("button", { name: action })).toBeNull()
    })
    it("отправляет числовую оценку и trim-комментарий, показывает ответ без повторного POST", async () => {
      await start()
      await fill()
      fetchMock.mockResolvedValueOnce(json(existing, 201))
      await userEvent.click(
        screen.getByRole("button", { name: "Отправить отзыв" })
      )
      await screen.findByText("Отзыв отправлен. Спасибо за оценку!")
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        "/api/bookings/booking-one/reviews"
      )
      expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
        method: "POST",
        credentials: "same-origin",
        body: JSON.stringify({ rating: 4, comment: existing.comment }),
      })
      expect(screen.getByText("Оценка: 4 из 5")).toBeTruthy()
      expect(
        screen.queryByRole("button", { name: "Отправить отзыв" })
      ).toBeNull()
    })
    it("отмена закрывает форму без POST и сохраняет введённый текст", async () => {
      await start()
      await fill()
      await userEvent.click(screen.getByRole("button", { name: "Отмена" }))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await userEvent.click(screen.getByRole("button", { name: action }))
      expect(
        (
          screen.getByLabelText("Комментарий о поездке") as HTMLTextAreaElement
        ).value.trim()
      ).toBe(existing.comment)
    })
    it("проверяет оценку, пустой и слишком длинный комментарий без запроса", async () => {
      await start()
      await userEvent.click(screen.getByRole("button", { name: action }))
      const submit = () =>
        fireEvent.submit(screen.getByRole("form", { name: action }))
      submit()
      expect(await screen.findByRole("alert")).toBeTruthy()
      await userEvent.selectOptions(screen.getByLabelText(ratingLabel), "5")
      for (const text of ["   ", "а".repeat(1001)]) {
        fireEvent.change(screen.getByLabelText("Комментарий о поездке"), {
          target: { value: text },
        })
        submit()
        expect(screen.getByRole("alert")).toBeTruthy()
      }
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    it("блокирует двойную отправку до ответа", async () => {
      await start()
      await fill()
      let resolve!: (value: Response) => void
      fetchMock.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        })
      )
      const form = screen.getByRole("form", { name: action })
      fireEvent.submit(form)
      fireEvent.submit(form)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(
        (screen.getByLabelText(ratingLabel) as HTMLSelectElement).closest(
          "fieldset"
        )?.disabled
      ).toBe(true)
      await act(async () => resolve(json(existing, 201)))
      await screen.findByText("Оценка: 4 из 5")
    })
    it.each(["network", "503"])(
      "при ошибке %s сохраняет ввод и позволяет повторить",
      async (failure) => {
        await start()
        await fill()
        if (failure === "network")
          fetchMock.mockRejectedValueOnce(new Error("offline"))
        else
          fetchMock.mockResolvedValueOnce(
            json({ message: "Сервис временно недоступен" }, 503)
          )
        await userEvent.click(
          screen.getByRole("button", { name: "Отправить отзыв" })
        )
        await screen.findByRole("alert")
        expect(
          (
            screen.getByLabelText(
              "Комментарий о поездке"
            ) as HTMLTextAreaElement
          ).value.trim()
        ).toBe(existing.comment)
        fetchMock.mockResolvedValueOnce(json(existing, 201))
        await userEvent.click(
          screen.getByRole("button", { name: "Отправить отзыв" })
        )
        await screen.findByText("Оценка: 4 из 5")
      }
    )
    it("при 409 перечитывает ранее отправленный отзыв и закрывает форму", async () => {
      await start()
      await fill()
      fetchMock
        .mockResolvedValueOnce(json({ message: "Вы уже оставили отзыв" }, 409))
        .mockResolvedValueOnce(json(page([existing])))
      await userEvent.click(
        screen.getByRole("button", { name: "Отправить отзыв" })
      )
      await screen.findByText("Оценка: 4 из 5")
      expect(
        screen.queryByRole("button", { name: "Отправить отзыв" })
      ).toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
    it("скрытый отзыв или устаревшая заявка после 409 не разрешают новый POST", async () => {
      await start()
      await fill()
      fetchMock
        .mockResolvedValueOnce(json({ message: "Отзыв недоступен" }, 409))
        .mockResolvedValueOnce(json(page()))
      await userEvent.click(
        screen.getByRole("button", { name: "Отправить отзыв" })
      )
      expect(await screen.findByRole("alert")).toHaveProperty(
        "textContent",
        expect.stringContaining("повторная оценка недоступна")
      )
      expect(screen.queryByRole("button", { name: action })).toBeNull()
    })
    it("ошибка загрузки не предлагает форму до успешного повтора", async () => {
      fetchMock
        .mockResolvedValueOnce(json({ message: "Ошибка чтения" }, 503))
        .mockResolvedValueOnce(json(page([existing])))
      vi.stubGlobal("fetch", fetchMock)
      render(
        <BookingReview
          bookingId="booking-one"
          recipientRole={role}
          recipientName="Иван Петров"
          onExpired={expired}
        />
      )
      await screen.findByText("Ошибка чтения")
      expect(screen.queryByRole("button", { name: action })).toBeNull()
      await userEvent.click(
        screen.getByRole("button", { name: "Повторить загрузку отзыва" })
      )
      await screen.findByText("Оценка: 4 из 5")
    })
    it("истёкшая сессия при отправке возвращает к входу", async () => {
      await start()
      await fill()
      fetchMock.mockResolvedValueOnce(json({ message: "Требуется вход" }, 401))
      await userEvent.click(
        screen.getByRole("button", { name: "Отправить отзыв" })
      )
      await waitFor(() => expect(expired).toHaveBeenCalledOnce())
    })
    it("после ухода игнорирует позднюю ошибку сессии", async () => {
      const view = await start()
      await fill()
      let resolve!: (response: Response) => void
      fetchMock.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done
        })
      )
      fireEvent.submit(screen.getByRole("form", { name: action }))
      view.unmount()
      await act(async () => resolve(json({ message: "Требуется вход" }, 401)))
      expect(expired).not.toHaveBeenCalled()
    })
    it("отображает комментарий как текст", async () => {
      await start([{ ...existing, comment: '<img src=x onerror="alert(1)">' }])
      expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeTruthy()
      expect(document.querySelector("img")).toBeNull()
    })
  }
)
it.each([false, true])(
  "форма в заявках доступна участникам только завершённой поездки (driver=%s)",
  async (driver) => {
    const ride = {
      id: "ride",
      departureAt: "2026-01-01T03:00:00Z",
      origin: { name: "Уралмаш", address: "Космонавтов" },
      destination: { name: "УрФУ", address: "Мира, 19" },
      driver: { id: "driver", fullName: "Иван Петров" },
      vehicle: { make: "Kia", model: "Rio", color: "Белый" },
    }
    const items = [
      ["COMPLETED", "COMPLETED"],
      ["CONFIRMED", "IN_PROGRESS"],
      ["CANCELLED", "COMPLETED"],
      ["COMPLETED", "PUBLISHED"],
    ].map(([status, rideStatus], i) => ({
      id: `booking-${i}`,
      rideId: "ride",
      status,
      seats: 1,
      unitPriceKopecks: 15000,
      createdAt: "2026-01-01",
      cancellationReason: null,
      passenger: {
        id: "passenger",
        fullName: "Анна Соколова",
        affiliation: null,
      },
      ride: { ...ride, status: rideStatus },
    }))
    fetchMock.mockImplementation(async (url) =>
      String(url).includes("me/reviews")
        ? json(page())
        : json({ items, total: 4, page: 1, pageSize: 10 })
    )
    vi.stubGlobal("fetch", fetchMock)
    render(<BookingsScreen driver={driver} onExpired={expired} />)
    await screen.findByText("Всего заявок: 4")
    expect(
      await screen.findAllByRole("button", {
        name: driver ? "Оценить пассажира" : "Оценить водителя",
      })
    ).toHaveLength(1)
    expect(
      screen.queryByRole("button", {
        name: driver ? "Оценить водителя" : "Оценить пассажира",
      })
    ).toBeNull()
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("me/reviews"))
    ).toHaveLength(1)
  }
)

it("водитель оценивает второго пассажира независимо от отзыва первому", async () => {
  const ride = {
    id: "ride",
    status: "COMPLETED",
    departureAt: "2026-11-03T03:00:00Z",
    origin: { name: "Уралмаш", address: "Космонавтов" },
    destination: { name: "УрФУ", address: "Мира, 19" },
    driver: { id: "driver", fullName: "Иван Петров" },
    vehicle: { make: "Kia", model: "Rio", color: "Белый" },
  }
  const items = ["Анна Соколова", "София Морозова"].map((fullName, index) => ({
    id: `booking-${index}`,
    rideId: "ride",
    status: "COMPLETED",
    seats: 1,
    unitPriceKopecks: 15000,
    createdAt: "2026-11-03",
    cancellationReason: null,
    passenger: {
      id: `passenger-${index}`,
      fullName,
      affiliation: "Студентка УрФУ",
    },
    ride,
  }))
  const saved = { ...existing, comment: "Анна была на месте вовремя." }
  fetchMock.mockImplementation(async (url, init) => {
    if (init?.method === "POST")
      return json(
        { ...existing, comment: "София пришла вовремя.", rating: 5 },
        201
      )
    if (String(url).includes("me/reviews"))
      return json(page(String(url).includes("booking-0") ? [saved] : []))
    return json({ items, total: 2, page: 1, pageSize: 10 })
  })
  vi.stubGlobal("fetch", fetchMock)
  render(<BookingsScreen driver onExpired={expired} />)
  const first = await screen.findByRole("region", {
    name: "Отзыв пассажиру Анна Соколова",
  })
  const second = await screen.findByRole("region", {
    name: "Отзыв пассажиру София Морозова",
  })
  await within(first).findByText(saved.comment)
  expect(
    within(first).queryByRole("button", { name: "Оценить пассажира" })
  ).toBeNull()
  await userEvent.click(
    await within(second).findByRole("button", { name: "Оценить пассажира" })
  )
  await userEvent.selectOptions(
    within(second).getByLabelText("Оценка пассажира"),
    "5"
  )
  await userEvent.type(
    within(second).getByLabelText("Комментарий о поездке"),
    "София пришла вовремя."
  )
  await userEvent.click(
    within(second).getByRole("button", { name: "Отправить отзыв" })
  )
  await within(second).findByText("Оценка: 5 из 5")
  expect(within(first).getByText(saved.comment)).toBeTruthy()
  const writes = fetchMock.mock.calls.filter(
    ([, init]) => init?.method === "POST"
  )
  expect(writes).toHaveLength(1)
  expect(writes[0]?.[0]).toBe("/api/bookings/booking-1/reviews")
  expect(JSON.parse(String(writes[0]?.[1]?.body))).toEqual({
    rating: 5,
    comment: "София пришла вовремя.",
  })
})
