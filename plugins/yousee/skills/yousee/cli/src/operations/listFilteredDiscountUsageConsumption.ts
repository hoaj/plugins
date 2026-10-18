// From captures/usage-show/listFilteredDiscountUsageConsumption.shape.json. The list is the
// customer's, whichever billing account is passed: one row per allowance per period.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

export default defineOperation({
  name: "listFilteredDiscountUsageConsumption",
  effect: "read",
  graphql: `query listFilteredDiscountUsageConsumption($accountId: String!) {
  listFilteredDiscountUsageConsumption(accountId: $accountId) {
    productInstanceName
    displayName
    startTime
    endTime
    remainingDiscountedUsage
    mainThresholdAmount
    totalDiscountedUsage
  }
}`,
  variables: z.object({ accountId: z.string().min(1) }),
  response: z.object({
    data: z.object({
      listFilteredDiscountUsageConsumption: z.array(
        z.object({
          productInstanceName: z.string().nullable(),
          displayName: z.string(),
          startTime: z.string(),
          endTime: z.string().nullable(),
          remainingDiscountedUsage: z.string().nullable(),
          mainThresholdAmount: z.union([z.string(), z.number()]).nullable(),
          totalDiscountedUsage: z.string().nullable(),
        }),
      ),
    }),
  }),
  needs: {
    accountId: { from: "eCareListBillingAccountsFD", pick: (r) => r.data.eCareListBillingAccountsFD[0]?.billingAccount.id },
  },
});
