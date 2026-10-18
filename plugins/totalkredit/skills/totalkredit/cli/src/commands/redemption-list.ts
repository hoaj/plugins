import { z } from "zod";
import { defineCommand, inputFailure } from "../runtime/command";
import listBondTable from "../operations/listBondTable";
import { DOMAIN, TABLES, common, header, num, rows } from "../lib/tables";

export default defineCommand({
  name: "redemption list",
  summary: "Redemption prices (indfrielseskurser) of existing loans, by bond; filter by fondskode or loan type",
  args: z.object({
    fondCode: z.string().min(1).optional().describe("the bond's fondskode (on the loan's terminsopkrævning), e.g. 955299"),
    type: z.string().min(1).optional().describe('loan type group, e.g. "Fast rente", "F-kort", "RenteMax", "CIBOR3", "CIBOR6", "Tilpasningslån"'),
  }),
  uses: [listBondTable],
  run: async ({ fondCode, type }, { call }) => {
    const t = await call(listBondTable, { tableId: TABLES.redemption, domain: DOMAIN });
    let all = rows(t);
    if (type) {
      const want = type.trim().toLowerCase();
      const groups = [...new Set(all.map((r) => r.group))];
      if (!groups.some((g) => g.toLowerCase() === want)) inputFailure(`No loan type "${type}". Types: ${groups.join(", ")}.`);
      all = all.filter((r) => r.group.toLowerCase() === want);
    }
    if (fondCode) {
      const code = fondCode.replace(/\s/g, "");
      all = all.filter((r) => r.e.fondCode?.trim() === code);
      if (all.length === 0) inputFailure(`No bond with fondskode ${fondCode}${type ? ` under "${type}"` : ""}: run \`redemption list\` to see them.`);
    }
    const loans = all.map(({ group, e }) => ({
      group,
      ...common(e),
      green: e.isGreen ?? null,
      redemptionPrice: num(e.redemptionRate),
      spotPrice: num(e.spotPriceRateRedemption),
      interestMarginPct: num(e.interestMarginRate),
      calculationRatePct: num(e.expectedRate),
    }));
    return { ...header(t), loans };
  },
});
