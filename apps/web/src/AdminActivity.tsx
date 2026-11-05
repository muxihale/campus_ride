import { ActivityScreen } from "./Activity"
export function AdminActivityScreen({ onExpired }: { onExpired: () => void }) {
  return (
    <ActivityScreen administrative roles={["ADMIN"]} onExpired={onExpired} />
  )
}
