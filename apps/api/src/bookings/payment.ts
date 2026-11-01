import { ConflictException } from "@nestjs/common"
import { ApiProperty } from "@nestjs/swagger"
import type { Prisma } from "../generated/prisma/client.js"
import { PaymentStatus } from "../generated/prisma/enums.js"
export const paymentSelect = {
  id: true,
  amountKopecks: true,
  status: true,
  isDemo: true,
  paidAt: true,
  refundedAt: true,
} as const
export class DemoPaymentDto {
  @ApiProperty({ type: String, format: "uuid" }) id!: string
  @ApiProperty({
    type: Number,
    description: "Полная сумма в копейках; не более 8 × 2147483647",
  })
  amountKopecks!: number
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus
  @ApiProperty({ type: Boolean, example: true }) isDemo!: boolean
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  paidAt!: Date | null
  @ApiProperty({ type: String, format: "date-time", nullable: true })
  refundedAt!: Date | null
}
export function serializePayment(
  payment: Prisma.PaymentGetPayload<{ select: typeof paymentSelect }> | null
): DemoPaymentDto | null {
  return payment
    ? { ...payment, amountKopecks: Number(payment.amountKopecks) }
    : null
}
export async function changePayment(
  tx: Prisma.TransactionClient,
  bookingId: string,
  status: "SUCCEEDED" | "CANCELLED" | "REFUNDED",
  actorId: string
) {
  const payment = await tx.payment.findUnique({
    where: { bookingId },
    include: {
      booking: {
        select: { passengerId: true, seats: true, unitPriceKopecks: true },
      },
    },
  })
  if (
    !payment ||
    !payment.isDemo ||
    payment.amountKopecks !==
      BigInt(payment.booking.seats) * BigInt(payment.booking.unitPriceKopecks)
  )
    throw new ConflictException("Данные демонстрационного платежа некорректны")
  if (payment.status === status) return
  if (payment.status !== (status === "REFUNDED" ? "SUCCEEDED" : "PENDING"))
    throw new ConflictException("Недопустимый статус демонстрационного платежа")
  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status,
      ...(status === "SUCCEEDED"
        ? { paidAt: new Date() }
        : status === "REFUNDED"
          ? { refundedAt: new Date() }
          : {}),
    },
  })
  await tx.activityLog.create({
    data: {
      actorId,
      action: `payment.${status.toLowerCase()}`,
      resourceType: "payment",
      resourceId: payment.id,
      details: {
        fromStatus: payment.status,
        toStatus: status,
        amountKopecks: Number(payment.amountKopecks),
        isDemo: true,
      },
    },
  })
  const amount = Number(payment.amountKopecks)
  const rubles = `${Math.floor(amount / 100)},${String(amount % 100).padStart(2, "0")}`
  await tx.notification.create({
    data: {
      userId: payment.booking.passengerId,
      kind: "PAYMENT_UPDATED",
      title:
        status === "REFUNDED"
          ? "Демонстрационный возврат выполнен"
          : status === "SUCCEEDED"
            ? "Демонстрационная оплата выполнена"
            : "Демонстрационный платёж отменён",
      body: `Сумма: ${rubles} ₽. Это имитация, реальные деньги не используются.`,
      link: "#/bookings",
      resourceType: "payment",
      resourceId: payment.id,
    },
  })
}
