import { z } from "zod";
import { defineCommand } from "../runtime/command";
import eCareListBillingAccountsFD from "../operations/eCareListBillingAccountsFD";
import listFilteredDiscountUsageConsumption from "../operations/listFilteredDiscountUsageConsumption";
import { toDate, toNumber } from "../lib/format";

export default defineCommand({
  name: "usage show",
  summary: "Mobile usage per allowance (data, talk, SMS) in the current period, or every period with --history",
  args: z.object({ history: z.boolean().default(false).describe("show every period, not only the current one") }),
  uses: [eCareListBillingAccountsFD, listFilteredDiscountUsageConsumption],
  run: async ({ history }, { call, session }) => {
    const accounts = (await call(eCareListBillingAccountsFD, { customerId: session.ids.customerId! })).data.eCareListBillingAccountsFD;
    const first = accounts[0]?.billingAccount.id;
    if (!first) return { allowances: [] };
    // The list is the customer's whichever billing account is passed, so one call covers all.
    const rows = (await call(listFilteredDiscountUsageConsumption, { accountId: first })).data.listFilteredDiscountUsageConsumption;
    const now = Date.now();
    const current = (r: (typeof rows)[number]) => Date.parse(r.startTime) <= now && (!r.endTime || Date.parse(r.endTime) > now);
    const allowances = rows
      .filter((r) => history || current(r))
      .map((r) => ({
        name: r.displayName,
        line: r.productInstanceName,
        used: toNumber(r.totalDiscountedUsage),
        remaining: toNumber(r.remainingDiscountedUsage),
        limit: toNumber(r.mainThresholdAmount),
        periodStart: toDate(r.startTime),
        periodEnd: toDate(r.endTime),
      }))
      .sort((a, b) => (b.periodStart ?? "").localeCompare(a.periodStart ?? "") || a.name.localeCompare(b.name));
    return { allowances };
  },
});
