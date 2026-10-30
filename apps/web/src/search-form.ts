import { ekaterinburgISO, kopecksToRubles, rublesToKopecks } from "./ride-form"
export type SearchFilters = {
  q: string
  direction: string
  originDistrictId: string
  campusId: string
  date: string
  timeFrom: string
  timeTo: string
  maxPrice: string
  minSeats: string
  musicAllowed: string
  luggageAllowed: string
  smokingAllowed: string
}
export const emptySearch: SearchFilters = {
  q: "",
  direction: "",
  originDistrictId: "",
  campusId: "",
  date: "",
  timeFrom: "",
  timeTo: "",
  maxPrice: "",
  minSeats: "",
  musicAllowed: "",
  luggageAllowed: "",
  smokingAllowed: "",
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
export function searchParams(values: SearchFilters): URLSearchParams {
  if (values.q.trim().length > 100)
    throw new Error("Поисковый запрос должен быть не длиннее 100 символов")
  if (!["", "TO_CAMPUS", "FROM_CAMPUS"].includes(values.direction))
    throw new Error("Выберите корректное направление")
  for (const value of [values.originDistrictId, values.campusId])
    if (value && !uuid.test(value))
      throw new Error("Некорректный район или корпус в ссылке")
  for (const key of [
    "musicAllowed",
    "luggageAllowed",
    "smokingAllowed",
  ] as const)
    if (!["", "true", "false"].includes(values[key]))
      throw new Error("Некорректное условие поездки в ссылке")
  if (values.date) ekaterinburgISO(`${values.date}T00:00`)
  if ((values.timeFrom || values.timeTo) && !values.date)
    throw new Error("Для поиска по времени укажите дату")
  for (const value of [values.timeFrom, values.timeTo])
    if (value && !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value))
      throw new Error("Укажите время в формате ЧЧ:ММ")
  if (values.timeFrom && values.timeTo && values.timeFrom > values.timeTo)
    throw new Error("Начало времени не может быть позже конца")
  if (values.minSeats && !/^[1-8]$/.test(values.minSeats))
    throw new Error("Число свободных мест должно быть от 1 до 8")
  const params = new URLSearchParams()
  for (const key of [
    "q",
    "direction",
    "originDistrictId",
    "campusId",
    "date",
    "timeFrom",
    "timeTo",
    "minSeats",
    "musicAllowed",
    "luggageAllowed",
    "smokingAllowed",
  ] as const)
    if (values[key].trim()) params.set(key, values[key].trim())
  if (values.maxPrice.trim())
    params.set("maxPriceKopecks", String(rublesToKopecks(values.maxPrice)))
  params.set("page", "1")
  return params
}
export function readSearch(query: string): {
  values: SearchFilters
  error?: string
} {
  const params = new URLSearchParams(query)
  const values = { ...emptySearch }
  for (const key of Object.keys(values) as (keyof SearchFilters)[])
    if (key !== "maxPrice") values[key] = params.get(key) ?? ""
  try {
    const allowed = [
      ...Object.keys(values).filter((key) => key !== "maxPrice"),
      "maxPriceKopecks",
      "page",
      "pageSize",
      "sort",
    ]
    for (const key of params.keys())
      if (!allowed.includes(key) || params.getAll(key).length !== 1)
        throw new Error(
          "Ссылка содержит неподдерживаемые или повторные параметры"
        )
    const price = params.get("maxPriceKopecks")
    if (price !== null) {
      if (!/^\d+$/.test(price) || Number(price) > 2147483647)
        throw new Error("Некорректная цена в ссылке")
      values.maxPrice = kopecksToRubles(Number(price))
    }
    searchParams(values)
    for (const [key, max] of [
      ["page", 1000000],
      ["pageSize", 100],
    ] as const) {
      const value = params.get(key)
      if (
        value !== null &&
        (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)
      )
        throw new Error("Некорректная страница в ссылке")
    }
    if (
      params.has("sort") &&
      !["departureAsc", "departureDesc", "priceAsc", "priceDesc"].includes(
        params.get("sort")!
      )
    )
      throw new Error("Некорректная сортировка в ссылке")
    return { values }
  } catch (cause) {
    return {
      values,
      error:
        cause instanceof Error
          ? cause.message
          : "Некорректные параметры поиска",
    }
  }
}
