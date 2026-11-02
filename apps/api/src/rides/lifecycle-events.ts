import type { Prisma } from "../generated/prisma/client.js"

export async function recordRideLifecycle(
  tx: Prisma.TransactionClient,
  driverId: string,
  rideId: string,
  completed: boolean,
  passengerIds: string[],
  timestamp: Date
) {
  const title = completed ? "Поездка завершена" : "Поездка началась"
  await tx.activityLog.create({
    data: {
      actorId: driverId,
      action: completed ? "ride.completed" : "ride.started",
      resourceType: "ride",
      resourceId: rideId,
      details: {
        fromStatus: completed ? "IN_PROGRESS" : "PUBLISHED",
        toStatus: completed ? "COMPLETED" : "IN_PROGRESS",
        timestamp: timestamp.toISOString(),
      },
    },
  })
  for (const userId of new Set([driverId, ...passengerIds])) {
    await tx.notification.create({
      data: {
        userId,
        kind: completed ? "RIDE_COMPLETED" : "RIDE_STARTED",
        title,
        body: completed
          ? "Поездка завершена. Подтверждённые заявки перенесены в историю."
          : "Водитель начал поездку. Новые бронирования и обычная отмена недоступны.",
        link: userId === driverId ? "#/rides" : "#/bookings",
        resourceType: "ride",
        resourceId: rideId,
      },
    })
  }
}
