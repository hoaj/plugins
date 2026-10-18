// From captures/{fixed-rate-list,variable-rate-list,cash-rate-list,redemption-list}/GET-api-bondinformation-table.shape.json.
// One endpoint serves every rate table on /boliglan/kurser-og-priser/; `tableId` picks the table.
// Entry fields differ per table, so each is optional here and the command maps what its table has.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

const entry = z.object({
  name: z.string(),
  lifetime: z.string().optional(),
  fondCode: z.string().optional(),
  isOpenForOffer: z.boolean(),
  // Danish number strings ("101,02", "4,54 %"); "" when the table has no value for this bond.
  priceRate: z.string().optional(),
  spotPriceRatePayment: z.string().optional(),
  spotPriceRateRedemption: z.string().optional(),
  redemptionRate: z.string().optional(),
  effectiveRate: z.string().optional(),
  interestMarginRate: z.string().optional(),
  expectedRate: z.string().optional(),
  innerInterestGrossValue: z.string().optional(),
  isGreen: z.boolean().optional(),
  nasdaqUrl: z.string().nullable().optional(),
});

export default defineOperation({
  name: "GET /api/bondinformation/table",
  effect: "read",
  rest: { method: "GET", path: "/api/bondinformation/table", query: (v) => ({ tableId: v.tableId, domain: v.domain }) },
  variables: z.object({
    tableId: z.string().min(1),
    domain: z.string().min(1),
  }),
  response: z.object({
    title: z.string(),
    disclaimer: z.string().nullable().optional(),
    groups: z.array(z.object({ name: z.string(), entries: z.array(entry) })),
    lastUpdatedTimestamp: z.string().nullable().optional(),
    nextUpdateTimestamp: z.string().nullable().optional(),
    alarmBanner: z.object({ description: z.string().nullable().optional() }).nullable().optional(),
  }),
  needs: {
    tableId: { value: "privat-udbetaling-af-laan-aktuelle-kurser-kunder" },
    domain: { value: "totalkredit" },
  },
});
