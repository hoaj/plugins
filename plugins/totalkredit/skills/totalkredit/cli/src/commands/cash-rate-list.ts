import { z } from "zod";
import { defineCommand } from "../runtime/command";
import listBondTable from "../operations/listBondTable";
import { DOMAIN, TABLES, header, num, rows } from "../lib/tables";

export default defineCommand({
  name: "cash-rate list",
  summary: "Cash rates (kontantrenter) of adjustable-rate loans (Tilpasningslån) paid out today",
  args: z.object({}),
  uses: [listBondTable],
  run: async (_args, { call }) => {
    const t = await call(listBondTable, { tableId: TABLES.cashRate, domain: DOMAIN });
    const loans = rows(t).map(({ group, e }) => ({
      group,
      name: e.name.trim(),
      term: e.lifetime?.trim() || null,
      openForOffer: e.isOpenForOffer,
      cashRatePct: num(e.innerInterestGrossValue),
    }));
    return { ...header(t), loans };
  },
});
