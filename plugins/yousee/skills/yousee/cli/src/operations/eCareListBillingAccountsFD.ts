// From captures/bill-list/eCareListBillingAccountsFD.shape.json. The frontend also asks for
// contacts, addresses and account details; the CLI reads only each billing account's id,
// which ListFilteredBills and listFilteredDiscountUsageConsumption take as accountId.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

export default defineOperation({
  name: "eCareListBillingAccountsFD",
  effect: "read",
  graphql: `query eCareListBillingAccountsFD($customerId: String!) {
  eCareListBillingAccountsFD(customerId: $customerId) {
    billingAccount { id }
  }
}`,
  variables: z.object({ customerId: z.string().min(1) }),
  response: z.object({
    data: z.object({
      eCareListBillingAccountsFD: z.array(z.object({ billingAccount: z.object({ id: z.string() }) })),
    }),
  }),
  needs: { customerId: { from: "session", key: "customerId" } },
});
