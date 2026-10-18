// Shared by the rate commands: table ids, the common output header and Danish number parsing.
import type { z } from "zod";
import type listBondTable from "../operations/listBondTable";

export type BondTable = z.output<typeof listBondTable.response>;
export type BondEntry = BondTable["groups"][number]["entries"][number];

// The `tableId`s the kurser-og-priser page loads.
export const TABLES = {
  fixedPayout: "privat-udbetaling-af-laan-aktuelle-kurser-kunder",
  variablePayout: "privat-udbetaling-af-variabel-laan-aktuelle-kurser-kunder",
  cashRate: "privat-udbetaling-af-laan-kontantrenter-raadgivere-og-kunder",
  redemption: "indfrielse-af-laan-aktuelle-kurser-og-terminstillaeg-kunder",
} as const;

export const DOMAIN = "totalkredit";

// "101,02" -> 101.02, "4,54 %" -> 4.54, "1.234,5" -> 1234.5, "" or anything unreadable -> null.
// A dot is a thousands separator only next to a decimal comma; alone it stays a decimal point.
export const num = (s: string | null | undefined): number | null => {
  if (s == null) return null;
  let t = s.replace(/[%\s ]/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const text = (s: string | null | undefined): string | null => (s && s.trim() !== "" ? s.trim() : null);

export const header = (t: BondTable) => ({
  title: t.title,
  disclaimer: text(t.disclaimer),
  notice: text(t.alarmBanner?.description),
  updatedAt: text(t.lastUpdatedTimestamp),
  nextUpdateAt: text(t.nextUpdateTimestamp),
});

// Every entry with the name of its group ("Fast rente", "F-kort", ...).
export const rows = (t: BondTable) =>
  t.groups.flatMap((g) => g.entries.map((e) => ({ group: g.name.trim(), e })));

export const common = (e: BondEntry) => ({
  name: e.name.trim(),
  fondCode: text(e.fondCode),
  openForOffer: e.isOpenForOffer,
  nasdaqUrl: text(e.nasdaqUrl),
});
