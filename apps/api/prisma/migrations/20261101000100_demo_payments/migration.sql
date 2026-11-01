-- Восемь мест по максимально допустимой цене не помещаются в integer.
ALTER TABLE "Payment" ALTER COLUMN "amountKopecks" TYPE bigint;

-- Сохраняем историю уже существующих заявок без повторных списаний и уведомлений.
INSERT INTO "Payment" ("id", "bookingId", "amountKopecks", "status", "isDemo", "paidAt", "refundedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), b."id", b."seats"::bigint * b."unitPriceKopecks",
  (CASE WHEN b."status" IN ('CONFIRMED', 'COMPLETED') THEN 'SUCCEEDED'
    WHEN b."status" = 'CANCELLED' AND e."paidAt" IS NOT NULL THEN 'REFUNDED'
    WHEN b."status" IN ('REJECTED', 'CANCELLED') THEN 'CANCELLED' ELSE 'PENDING' END)::"PaymentStatus",
  true,
  CASE WHEN b."status" IN ('CONFIRMED', 'COMPLETED') THEN COALESCE(e."paidAt", b."updatedAt")
    WHEN b."status" = 'CANCELLED' THEN e."paidAt" ELSE NULL END,
  CASE WHEN b."status" = 'CANCELLED' AND e."paidAt" IS NOT NULL THEN b."updatedAt" ELSE NULL END,
  b."createdAt", b."updatedAt"
FROM "Booking" b
LEFT JOIN "Payment" p ON p."bookingId" = b."id"
LEFT JOIN LATERAL (SELECT min("createdAt") AS "paidAt" FROM "BookingStatusEvent" WHERE "bookingId" = b."id" AND "toStatus" = 'CONFIRMED') e ON true
WHERE p."id" IS NULL;
