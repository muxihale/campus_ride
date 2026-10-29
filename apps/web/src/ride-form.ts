export function ekaterinburgInput(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Yekaterinburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value))
  const part = (type: string) => parts.find((item) => item.type === type)!.value
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
}
export function ekaterinburgISO(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Укажите дату и время отправления")
  const iso = `${value}:00+05:00`
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime()) || ekaterinburgInput(date) !== value)
    throw new Error("Укажите корректную дату и время")
  return iso
}
export function departureFromInput(value: string): string {
  const iso = ekaterinburgISO(value)
  const date = new Date(iso)
  if (date.getTime() <= Date.now())
    throw new Error("Отправление должно быть в будущем")
  return iso
}
export function rublesToKopecks(value: string): number {
  const normalized = value.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    throw new Error("Укажите цену в рублях, не более двух знаков после запятой")
  const [rubles, fraction = ""] = normalized.split(".")
  const result = Number(rubles) * 100 + Number(fraction.padEnd(2, "0"))
  if (!Number.isSafeInteger(result) || result > 2147483647)
    throw new Error("Цена должна быть от 0 до 21 474 836,47 ₽")
  return result
}
export function kopecksToRubles(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`
}
