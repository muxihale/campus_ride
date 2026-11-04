import type { Prisma } from "../generated/prisma/client.js"
import { cancelReservation } from "../bookings/cancellation.js"
export async function cancelRide(
  tx: Prisma.TransactionClient,
  ride: {
    id: string
    driverId: string
    status: "DRAFT" | "PUBLISHED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED"
  },
  actorId: string,
  reason: string,
  administrative = false
) {
  const bookings = await tx.booking.findMany({
    where: { rideId: ride.id, status: { in: ["PENDING", "CONFIRMED"] } },
    orderBy: { id: "asc" },
    select: { id: true, status: true, passengerId: true },
  })
  for (const booking of bookings)
    await cancelReservation(
      tx,
      booking,
      actorId,
      reason,
      ride.driverId,
      true,
      administrative
    )
  await tx.ride.update({
    where: { id: ride.id },
    data: {
      status: "CANCELLED",
      cancellationReason: reason,
      statusEvents: {
        create: {
          actorId,
          fromStatus: ride.status,
          toStatus: "CANCELLED",
          reason,
        },
      },
    },
  })
  await tx.activityLog.create({
    data: {
      actorId,
      action: "ride.cancelled",
      resourceType: "ride",
      resourceId: ride.id,
      details: {
        fromStatus: ride.status,
        toStatus: "CANCELLED",
        reason,
        cancelledBookings: bookings.length,
      },
    },
  })
  await tx.notification.create({
    data: {
      userId: ride.driverId,
      kind: "RIDE_CANCELLED",
      title: "Поездка отменена",
      body: `Причина: ${reason}. Активные заявки отменены; успешные демонстрационные платежи полностью возвращены.`,
      link: "#/rides",
      resourceType: "ride",
      resourceId: ride.id,
    },
  })

  return bookings.length
}
