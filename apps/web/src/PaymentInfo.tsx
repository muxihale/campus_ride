import { ekaterinburgInput, kopecksToRubles } from "./ride-form"
export type DemoPayment = {
  id: string
  amountKopecks: number
  status: string
  isDemo: boolean
  paidAt: string | null
  refundedAt: string | null
}
const names: Record<string, string> = {
  PENDING: "Ожидает подтверждения",
  SUCCEEDED: "Оплачен",
  CANCELLED: "Отменён без списания",
  REFUNDED: "Полностью возвращён",
  FAILED: "Ошибка имитации",
}
export function PaymentInfo({ payment }: { payment?: DemoPayment | null }) {
  return (
    <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
      <p className="font-medium">
        Демонстрационные оплата и возврат. Реальные деньги не используются.
      </p>
      {payment ? (
        <>
          <p>Демо-платёж: {names[payment.status] ?? payment.status}</p>
          <p>
            Сумма демо-платежа:{" "}
            {kopecksToRubles(payment.amountKopecks).replace(".", ",")} ₽
          </p>
          {payment.paidAt && (
            <p>
              Демо-оплата: {ekaterinburgInput(payment.paidAt).replace("T", " ")}{" "}
              · Екатеринбург
            </p>
          )}
          {payment.refundedAt && (
            <p>
              Полный демо-возврат:{" "}
              {ekaterinburgInput(payment.refundedAt).replace("T", " ")} ·
              Екатеринбург
            </p>
          )}
        </>
      ) : (
        <p>Данные платежа пока недоступны. Обновите список заявок.</p>
      )}
    </div>
  )
}
