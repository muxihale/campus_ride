import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import { ApiError, apiRequest } from "./auth"
import type { Page } from "./ride-data"
export function useAdminPage<T>(
  path: string,
  query: string,
  page: number,
  revision: number,
  setPage: Dispatch<SetStateAction<number>>,
  onExpired: () => void
) {
  const key = `${path}|${query}|${page}|${revision}`
  const [result, setResult] = useState<{
    key: string
    data?: Page<T>
    error?: string
    status?: number
  }>({ key: "" })
  const loading = result.key !== key
  useEffect(() => {
    let active = true
    apiRequest<Page<T>>(
      `${path}?${query}${query ? "&" : ""}page=${page}&pageSize=10`
    )
      .then((data) => {
        if (!active) return
        const last = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (page > last) setPage(last)
        else setResult({ key, data })
      })
      .catch((cause: unknown) => {
        if (!active) return
        if (cause instanceof ApiError && cause.status === 401) onExpired()
        else
          setResult({
            key,
            error:
              cause instanceof Error
                ? cause.message
                : "Не удалось загрузить данные",
            status: cause instanceof ApiError ? cause.status : undefined,
          })
      })
    return () => {
      active = false
    }
  }, [path, query, page, revision, key, setPage, onExpired])
  return {
    loading,
    data: !loading ? result.data : undefined,
    error: !loading ? result.error : undefined,
    forbidden: !loading && result.status === 403,
  }
}
