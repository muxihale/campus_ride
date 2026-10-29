import { describe, expect, it, vi, afterEach } from "vitest"
import {
  departureFromInput,
  ekaterinburgInput,
  kopecksToRubles,
  rublesToKopecks,
} from "./ride-form"
afterEach(() => vi.useRealTimers())
describe("Время Екатеринбурга и цена поездки", () => {
  it("отображает UTC в Екатеринбурге, включая смену даты", () => {
    expect(ekaterinburgInput("2026-11-09T03:00:00Z")).toBe("2026-11-09T08:00")
    expect(ekaterinburgInput("2026-11-08T22:30:00Z")).toBe("2026-11-09T03:30")
  })
  it("отправляет время с +05:00 и запрещает несуществующие и прошлые даты", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-08T00:00:00Z"))
    expect(departureFromInput("2026-11-09T08:00")).toBe(
      "2026-11-09T08:00:00+05:00"
    )
    expect(() => departureFromInput("2027-02-30T08:00")).toThrow()
    expect(() => departureFromInput("2026-11-07T08:00")).toThrow("будущем")
    expect(() => departureFromInput("bad")).toThrow()
  })
  it.each([
    ["0", 0],
    ["150,15", 15015],
    ["0.29", 29],
    ["21474836.47", 2147483647],
  ] as const)("переводит %s рублей в %s целых копеек", (input, expected) => {
    expect(rublesToKopecks(input)).toBe(expected)
    expect(rublesToKopecks(kopecksToRubles(expected))).toBe(expected)
  })
  it.each(["-1", "1.001", "1e3", "NaN", "", "21474836.48"])(
    "отклоняет неверную цену %s",
    (value) => expect(() => rublesToKopecks(value)).toThrow()
  )
})
