// From captures/order-list/getOrderDetails.shape.json. The frontend also asks for prices,
// delivery contacts and order item characteristics; the CLI reads the order's state, its
// items and each shipment's expected date and tracking link.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

export default defineOperation({
  name: "getOrderDetails",
  effect: "read",
  graphql: `query getOrderDetails($id: ID!, $exposeNotAppliedDiscounts: Boolean, $exposeRootQuoteItems: Boolean) {
  getQuote(id: $id, exposeNotAppliedDiscounts: $exposeNotAppliedDiscounts, exposeRootQuoteItems: $exposeRootQuoteItems) {
    id
    name
    number
    state
    quoteDate
    updatedWhen
    externalRefs {
      origin {
        ... on ProductOrder {
          shipmentItem { expectedDeliveryDate trackingUrl }
        }
      }
    }
    quoteItem {
      action
      parentQuoteItemId
      productOffering { name }
    }
  }
}`,
  variables: z.object({
    id: z.string().min(1),
    exposeNotAppliedDiscounts: z.boolean().optional(),
    exposeRootQuoteItems: z.boolean().optional(),
  }),
  response: z.object({
    data: z.object({
      getQuote: z.object({
        id: z.string(),
        name: z.string().nullable(),
        number: z.string().nullable(),
        state: z.string(),
        quoteDate: z.string().nullable(),
        updatedWhen: z.string().nullable(),
        externalRefs: z
          .array(
            z.object({
              origin: z
                .object({
                  shipmentItem: z
                    .array(z.object({ expectedDeliveryDate: z.string().nullable(), trackingUrl: z.string().nullable() }))
                    .nullable()
                    .optional(),
                })
                .nullable(),
            }),
          )
          .nullable(),
        quoteItem: z
          .array(
            z.object({
              action: z.string().nullable(),
              parentQuoteItemId: z.string().nullable(),
              productOffering: z.object({ name: z.string() }).nullable(),
            }),
          )
          .nullable(),
      }),
    }),
  }),
  needs: { id: { from: "lastRevisionQuoteIds", pick: (r) => r.data.lastRevisionQuoteIds[0] } },
});
