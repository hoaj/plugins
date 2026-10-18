// From captures/bill-list/ListFilteredBills.shape.json. The frontend's @sort and @filter
// literals were redacted in the Capture and are left out; the site returns newest first
// without them. Amounts are integers scaled by 10^exponent.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

const money = z.object({ exponent: z.number(), amount: z.string() });

export default defineOperation({
  name: "ListFilteredBills",
  effect: "read",
  graphql: `query ListFilteredBills($accountId: String!, $offset: Int, $limit: Int) {
  listFilteredBills(accountId: $accountId) @limit(offset: $offset, limit: $limit) {
    invoiceNumber
    nominalBillTime
    paymentDueDate { day month year }
    netAmount { exponent amount }
    taxAmount { exponent amount }
    outstandingDebtAmount { exponent amount }
    billType { displayName }
  }
}`,
  variables: z.object({ accountId: z.string().min(1), offset: z.number().int().min(0), limit: z.number().int().min(1) }),
  response: z.object({
    extensions: z.object({ listFilteredBills: z.object({ totalCount: z.number() }) }).optional(),
    data: z.object({
      listFilteredBills: z.array(
        z.object({
          invoiceNumber: z.string(),
          nominalBillTime: z.string().nullable(),
          paymentDueDate: z.object({ day: z.number(), month: z.number(), year: z.number() }).nullable(),
          netAmount: money,
          taxAmount: money.nullable(),
          outstandingDebtAmount: money.nullable(),
          billType: z.object({ displayName: z.string() }).nullable(),
        }),
      ),
    }),
  }),
  needs: {
    accountId: { from: "eCareListBillingAccountsFD", pick: (r) => r.data.eCareListBillingAccountsFD[0]?.billingAccount.id },
    offset: { value: 0 },
    limit: { value: 1 },
  },
});
