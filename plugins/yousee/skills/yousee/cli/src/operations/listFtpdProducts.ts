// From captures/subscription-show/listFtpdProducts.shape.json. The frontend also asks for
// addresses, barrings, characteristics and offering details; the CLI reads none of them.
// Its @limit literal was redacted in the Capture, and its @filter is left out: without a
// filter the call returns every product, active and disconnected.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

const price = z.object({
  priceType: z.string(),
  price: z.object({ valueIncludingTaxRounded: z.string().nullable() }).nullable(),
});

export default defineOperation({
  name: "listFtpdProducts",
  effect: "read",
  graphql: `query listFtpdProducts($customerId: ID!, $exposeTotalPrice: Boolean) {
  listFtpdProducts(customerId: $customerId, exposeTotalPrice: $exposeTotalPrice) @limit(limit: 500) {
    id
    status
    name
    parentProductId
    rootProductId
    startDate
    terminationDate
    productOffering { name }
    productPrice { priceType price { valueIncludingTaxRounded } }
  }
}`,
  variables: z.object({ customerId: z.string().min(1), exposeTotalPrice: z.boolean() }),
  response: z.object({
    data: z.object({
      listFtpdProducts: z.array(
        z.object({
          id: z.string(),
          status: z.string(),
          name: z.string(),
          parentProductId: z.string().nullable(),
          rootProductId: z.string(),
          startDate: z.string().nullable(),
          terminationDate: z.string().nullable(),
          productOffering: z.object({ name: z.string() }).nullable(),
          productPrice: z.array(price).nullable(),
        }),
      ),
    }),
  }),
  needs: {
    customerId: { from: "session", key: "customerId" },
    exposeTotalPrice: { value: true },
  },
});
