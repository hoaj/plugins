import { z } from "zod";
import { defineCommand } from "../runtime/command";
import listBondTable from "../operations/listBondTable";
import { DOMAIN, TABLES, common, header, num, rows } from "../lib/tables";

export default defineCommand({
  name: "variable-rate list",
  summary: "Prices, interest margin (rentetillæg) and today's calculation rate of variable-rate loans paid out today",
  args: z.object({ open: z.boolean().optional().describe("only bonds open for new loan offers") }),
  uses: [listBondTable],
  run: async ({ open }, { call }) => {
    const t = await call(listBondTable, { tableId: TABLES.variablePayout, domain: DOMAIN });
    const loans = rows(t)
      .filter(({ e }) => !open || e.isOpenForOffer)
      .map(({ group, e }) => ({
        group,
        ...common(e),
        term: e.lifetime?.trim() || null,
        offerPrice: num(e.priceRate),
        spotPrice: num(e.spotPriceRatePayment),
        interestMarginPct: num(e.interestMarginRate),
        calculationRatePct: num(e.expectedRate),
      }));
    return { ...header(t), loans };
  },
});
