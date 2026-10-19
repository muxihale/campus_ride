import { useState } from "react"
import { ArrowUpRight, CarFront, LoaderCircle, MapPin } from "lucide-react"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

type Connection = "idle" | "loading" | "connected" | "error"

export function App() {
  const [connection, setConnection] = useState<Connection>("idle")

  async function checkConnection() {
    setConnection("loading")
    try {
      const response = await fetch("/api/health", {
        signal: AbortSignal.timeout(5000),
      })
      if (!response.ok) throw new Error("API недоступен")
      const body: unknown = await response.json()
      if (
        typeof body !== "object" ||
        body === null ||
        !("status" in body) ||
        body.status !== "ok" ||
        !("service" in body) ||
        body.service !== "campusride-api"
      )
        throw new Error("Неожиданный ответ API")
      setConnection("connected")
    } catch {
      setConnection("error")
    }
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-6xl flex-col px-6 sm:px-10">
      <header className="flex items-center justify-between gap-4 border-b py-6">
        <a
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight"
        >
          <CarFront className="size-6" aria-hidden="true" />
          CampusRide
        </a>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="size-4" aria-hidden="true" />
          Екатеринбург · УрФУ
        </span>
      </header>
      <main className="flex flex-1 items-center py-16 sm:py-24">
        <section className="max-w-2xl">
          <p className="mb-5 text-sm text-muted-foreground">
            Учебный проект · Начальная настройка
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
            В университет —<br />
            по пути друг с другом.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            Совместные поездки студентов и сотрудников УрФУ. Здесь появятся
            поиск попутчиков, бронирование мест и личные кабинеты.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button
              onClick={() => void checkConnection()}
              disabled={connection === "loading"}
            >
              {connection === "loading" && (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              )}
              {connection === "loading"
                ? "Проверяем…"
                : "Проверить подключение"}
            </Button>
            <a
              href="/api/docs"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Документация API
              <ArrowUpRight aria-hidden="true" />
            </a>
          </div>
          <p
            className="mt-4 min-h-12 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {connection === "idle" &&
              "Проверка отправит запрос к серверу CampusRide."}
            {connection === "loading" && "Ожидаем ответ сервера…"}
            {connection === "connected" &&
              "Связь с API установлена. Поиск и бронирование ещё в разработке."}
            {connection === "error" &&
              "Сервер недоступен. Проверьте, что API запущен, и повторите попытку."}
          </p>
        </section>
      </main>
      <footer className="border-t py-5 text-xs text-muted-foreground">
        Демонстрационный сервис. Не является официальным сервисом УрФУ.
      </footer>
    </div>
  )
}
