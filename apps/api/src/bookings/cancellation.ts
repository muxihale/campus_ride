import type { Prisma } from "../generated/prisma/client.js"
import { changePayment } from "./payment.js"
export async function cancelReservation(
  tx: Prisma.TransactionClient,
  booking: { id: string; status: string; passengerId: string },
  actorId: string,
  reason: string | null,
  driverId: string,
  rideCancelled = false
) {
  await changePayment(
    tx,
    booking.id,
    booking.status === "CONFIRMED" ? "REFUNDED" : "CANCELLED",
    actorId
  )
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: "CANCELLED",
      cancellationReason: reason,
      statusEvents: {
        create: {
          actorId,
          fromStatus: booking.status as "PENDING" | "CONFIRMED",
          toStatus: "CANCELLED",
          reason,
        },
      },
    },
  })
  await tx.activityLog.create({
    data: {
      actorId,
      action: "booking.cancelled",
      resourceType: "booking",
      resourceId: booking.id,
      details: { fromStatus: booking.status, toStatus: "CANCELLED", reason },
    },
  })
  await tx.notification.create({
    data: {
      userId: rideCancelled ? booking.passengerId : driverId,
      kind: rideCancelled ? "RIDE_CANCELLED" : "BOOKING_CANCELLED",
      title: rideCancelled
        ? "Водитель отменил поездку"
        : "Пассажир отменил заявку",
      body: `${reason ? `Причина: ${reason}. ` : ""}Места освобождены. Если демонстрационный платёж был выполнен, сумма полностью возвращена. Реальные деньги не используются.`,
      resourceType: "booking",
      resourceId: booking.id,
      link: rideCancelled ? "#/bookings" : "#/ride-bookings",
    },
  })
}
