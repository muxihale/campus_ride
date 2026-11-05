// Пользователь ищет подстроку, а не вводит шаблон PostgreSQL LIKE.
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&")
export const textContains = (value: string) => ({
  contains: escapeLike(value),
  mode: "insensitive" as const,
})
