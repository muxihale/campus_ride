import { configure } from "@testing-library/react"

// Полный набор запускается параллельно; холодная загрузка jsdom может занимать больше секунды.
configure({ asyncUtilTimeout: 3000 })
