import type { PrismaClient } from "../generated/prisma/client.js"
import type { LocationKind } from "../generated/prisma/enums.js"

type Named = { id: string; name: string }
export type RouteReferenceData = {
  districts: Named[]
  campuses: Named[]
  locations: (Named & {
    address: string
    kind: LocationKind
    districtId: string
    campusId: string | null
  })[]
}

const districtId = (n: number) =>
  `29100000-0000-4000-8000-${String(n).padStart(12, "0")}`
const campusId = (n: number) =>
  `29200000-0000-4000-8000-${String(n).padStart(12, "0")}`
const locationId = (n: number) =>
  `29300000-0000-4000-8000-${String(n).padStart(12, "0")}`

// Адреса корпусов и источники ориентиров перечислены в docs/demo-data.md.
export const ROUTE_REFERENCES: RouteReferenceData = {
  districts: [
    { id: districtId(1), name: "Втузгородок" },
    { id: districtId(2), name: "Центр" },
    { id: districtId(3), name: "Академический" },
    { id: districtId(4), name: "Уралмаш" },
    { id: districtId(5), name: "Ботанический" },
  ],
  campuses: [
    { id: campusId(1), name: "УрФУ — главный учебный корпус, Мира, 19" },
    { id: campusId(2), name: "УрФУ — корпус на Тургенева, 4" },
    { id: campusId(3), name: "УрФУ — корпус на Куйбышева, 48" },
  ],
  locations: [
    {
      id: locationId(1),
      name: "УрФУ — главный учебный корпус",
      address: "Екатеринбург, ул. Мира, 19",
      kind: "CAMPUS",
      districtId: districtId(1),
      campusId: campusId(1),
    },
    {
      id: locationId(2),
      name: "УрФУ — корпус на Тургенева",
      address: "Екатеринбург, ул. Тургенева, 4",
      kind: "CAMPUS",
      districtId: districtId(2),
      campusId: campusId(2),
    },
    {
      id: locationId(3),
      name: "УрФУ — корпус на Куйбышева",
      address: "Екатеринбург, ул. Куйбышева, 48",
      kind: "CAMPUS",
      districtId: districtId(2),
      campusId: campusId(3),
    },
    {
      id: locationId(4),
      name: "Ориентир у главного корпуса УрФУ",
      address: "Екатеринбург, ул. Мира, 19",
      kind: "MEETING_POINT",
      districtId: districtId(1),
      campusId: campusId(1),
    },
    {
      id: locationId(5),
      name: "Академический — Краснолесья / Вильгельма де Геннина",
      address:
        "Екатеринбург, перекрёсток ул. Краснолесья и ул. Вильгельма де Геннина",
      kind: "MEETING_POINT",
      districtId: districtId(3),
      campusId: null,
    },
    {
      id: locationId(6),
      name: "Метро «Уралмаш»",
      address: "Екатеринбург, просп. Космонавтов / ул. Баумана",
      kind: "TRANSIT_STOP",
      districtId: districtId(4),
      campusId: null,
    },
    {
      id: locationId(7),
      name: "Метро «Ботаническая»",
      address: "Екатеринбург, ул. Академика Шварца / ул. Белинского",
      kind: "TRANSIT_STOP",
      districtId: districtId(5),
      campusId: null,
    },
  ],
}

export async function seedRouteReferences(
  prisma: PrismaClient,
  data = ROUTE_REFERENCES
) {
  return prisma.$transaction(async (tx) => {
    const districts = new Map<string, string>()
    const campuses = new Map<string, string>()
    for (const item of data.districts) {
      const existing = await tx.district.findUnique({ where: { id: item.id } })
      const row =
        existing ??
        (await tx.district.upsert({
          where: { name: item.name },
          update: {},
          create: item,
        }))
      districts.set(item.id, row.id)
    }
    for (const item of data.campuses) {
      const existing = await tx.campus.findUnique({ where: { id: item.id } })
      const row =
        existing ??
        (await tx.campus.upsert({
          where: { name: item.name },
          update: {},
          create: item,
        }))
      campuses.set(item.id, row.id)
    }
    for (const item of data.locations) {
      const district = districts.get(item.districtId)
      const campus = item.campusId === null ? null : campuses.get(item.campusId)
      if (!district || campus === undefined)
        throw new Error("Не найдена связь в данных справочника")
      await tx.location.upsert({
        where: { id: item.id },
        update: {},
        create: { ...item, districtId: district, campusId: campus },
      })
    }
    return {
      districts: districts.size,
      campuses: campuses.size,
      locations: data.locations.length,
    }
  })
}
