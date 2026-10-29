import { apiRequest } from "./auth"
export type RideLocation = { id: string; name: string; address: string }
export type RideVehicle = {
  id: string
  make: string
  model: string
  registrationNumber: string
  passengerSeats: number
}
export type Ride = {
  id: string
  status: string
  vehicleId: string
  originId: string
  destinationId: string
  departureAt: string
  seatsTotal: number
  priceKopecks: number
  conditions: string
  musicAllowed: boolean
  luggageAllowed: boolean
  smokingAllowed: boolean
  stops: { locationId: string }[]
}
export type Page<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export const rideStatusNames: Record<string, string> = {
  DRAFT: "Черновик",
  PUBLISHED: "Опубликована",
  IN_PROGRESS: "В пути",
  COMPLETED: "Завершена",
  CANCELLED: "Отменена",
}
export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = []
  for (let page = 1; ; page++) {
    const result = await apiRequest<Page<T>>(
      `${path}?pageSize=100&page=${page}`
    )
    items.push(...result.items)
    if (page * result.pageSize >= result.total || result.items.length === 0)
      return items
  }
}
