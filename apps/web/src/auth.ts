export type User = {
  id: string
  email: string
  fullName: string
  affiliation: string | null
  roles: ("PASSENGER" | "DRIVER" | "ADMIN")[]
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function authRequest<T>(path: string, body?: unknown): Promise<T> {
  return apiRequest<T>(
    `auth/${path}`,
    body === undefined ? "GET" : "POST",
    body
  )
}

export async function apiRequest<T>(
  path: string,
  method = "GET",
  body?: unknown
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/${path}`, {
      method,
      credentials: "same-origin",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error(
      "Не удалось связаться с сервером. Проверьте подключение и повторите попытку."
    )
  }
  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as {
      message?: unknown
    } | null
    const message = data?.message
    throw new ApiError(
      response.status,
      response.status === 429
        ? "Слишком много попыток. Подождите минуту и попробуйте снова."
        : typeof message === "string"
          ? message
          : Array.isArray(message) &&
              message.every((item) => typeof item === "string")
            ? message.join(". ")
            : "Не удалось выполнить запрос. Попробуйте позже."
    )
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
