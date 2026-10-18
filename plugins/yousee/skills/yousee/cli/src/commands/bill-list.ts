import { z } from "zod";
import { defineCommand } from "../runtime/command";
import eCareListBillingAccountsFD from "../operations/eCareListBillingAccountsFD";
import ListFilteredBills from "../operations/ListFilteredBills";
import { toDKK, toDate, ymd } from "../lib/format";

export default defineCommand({
  name: "bill list",
  summary: "Your bills across all billing accounts, newest first, with amount incl. VAT and what is still outstanding",
  args: z.object({ limit: z.coerce.number().int().min(1).max(100).default(12).describe("how many bills to show (default 12)") }),
  uses: [eCareListBillingAccountsFD, ListFilteredBills],
  run: async ({ limit }, { call, session }) => {
    const accounts = (await call(eCareListBillingAccountsFD, { customerId: session.ids.customerId! })).data
      .eCareListBillingAccountsFD.map((a) => a.billingAccount.id);
    let totalCount = 0;
    const bills = [];
    for (const account of accounts) {
      const res = await call(ListFilteredBills, { accountId: account, offset: 0, limit });
      totalCount += res.extensions?.listFilteredBills.totalCount ?? res.data.listFilteredBills.length;
      for (const b of res.data.listFilteredBills) {
        const net = toDKK(b.netAmount) ?? 0;
        const vat = toDKK(b.taxAmount) ?? 0;
        bills.push({
          invoiceNumber: b.invoiceNumber,
          account,
          billDate: toDate(b.nominalBillTime),
          dueDate: ymd(b.paymentDueDate),
          totalDKK: Math.round((net + vat) * 100) / 100,
          vatDKK: vat,
          outstandingDKK: toDKK(b.outstandingDebtAmount) ?? 0,
          type: b.billType?.displayName ?? null,
        });
      }
    }
    bills.sort((a, b) => (b.billDate ?? "").localeCompare(a.billDate ?? ""));
    return { bills: bills.slice(0, limit), totalCount };
  },
});
