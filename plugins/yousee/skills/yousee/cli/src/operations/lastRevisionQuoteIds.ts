// From captures/order-list/lastRevisionQuoteIds.shape.json. Without $state it returns the
// latest revision of every order (quote) the customer has.
import { z } from "zod";
import { defineOperation } from "../runtime/operation";

export default defineOperation({
  name: "lastRevisionQuoteIds",
  effect: "read",
  graphql: `query lastRevisionQuoteIds($customerId: String!, $state: [String!]) {
  lastRevisionQuoteIds(customerId: $customerId, state: $state)
}`,
  variables: z.object({ customerId: z.string().min(1), state: z.array(z.string()).optional() }),
  response: z.object({ data: z.object({ lastRevisionQuoteIds: z.array(z.string()) }) }),
  needs: { customerId: { from: "session", key: "customerId" } },
});
