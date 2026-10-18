import { z } from "zod";
import { defineCommand } from "../runtime/command";
import lastRevisionQuoteIds from "../operations/lastRevisionQuoteIds";
import getOrderDetails from "../operations/getOrderDetails";
import { toDate } from "../lib/format";

export default defineCommand({
  name: "order list",
  summary: "Your orders, newest first, with status, items and expected delivery",
  args: z.object({ limit: z.coerce.number().int().min(1).max(50).default(10).describe("how many orders to show (default 10)") }),
  uses: [lastRevisionQuoteIds, getOrderDetails],
  run: async ({ limit }, { call, session }) => {
    const ids = (await call(lastRevisionQuoteIds, { customerId: session.ids.customerId! })).data.lastRevisionQuoteIds;
    const orders = [];
    for (const id of ids) {
      const q = (await call(getOrderDetails, { id })).data.getQuote;
      const shipments = (q.externalRefs ?? []).flatMap((r) => r.origin?.shipmentItem ?? []);
      orders.push({
        id: q.id,
        number: q.number,
        name: q.name,
        status: q.state,
        date: toDate(q.quoteDate),
        updated: toDate(q.updatedWhen),
        items: (q.quoteItem ?? [])
          .filter((i) => i.parentQuoteItemId === null)
          .map((i) => ({ name: i.productOffering?.name ?? null, action: i.action })),
        deliveries: shipments.map((s) => ({ expectedDate: toDate(s.expectedDeliveryDate), trackingUrl: s.trackingUrl })),
      });
    }
    orders.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
    return { orders: orders.slice(0, limit) };
  },
});
