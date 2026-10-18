import { z } from "zod";
import { defineCommand } from "../runtime/command";
import listFtpdProducts from "../operations/listFtpdProducts";
import { toDate, toNumber } from "../lib/format";

type Product = z.output<typeof listFtpdProducts.response>["data"]["listFtpdProducts"][number];

const priceOf = (p: Product, type: string): number | null => {
  const values = (p.productPrice ?? []).filter((x) => x.priceType === type).map((x) => toNumber(x.price?.valueIncludingTaxRounded));
  return values.some((v) => v !== null) ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null;
};
const nameOf = (p: Product) => p.productOffering?.name ?? p.name;

export default defineCommand({
  name: "subscription show",
  summary: "Your subscriptions with add-ons and monthly price incl. VAT (active ones unless --all)",
  args: z.object({ all: z.boolean().default(false).describe("include disconnected subscriptions and add-ons") }),
  uses: [listFtpdProducts],
  run: async ({ all }, { call, session }) => {
    const products = (await call(listFtpdProducts, { customerId: session.ids.customerId!, exposeTotalPrice: true })).data.listFtpdProducts;
    const shown = (p: Product) => all || p.status !== "DISCONNECTED";
    const subscriptions = products
      .filter((p) => p.parentProductId === null && shown(p))
      .map((root) => {
        const tree = products.filter((p) => p.rootProductId === root.id);
        const addons = tree.filter((p) => p.id !== root.id && shown(p));
        // "Total RC" is the sum of the recurring charges in the subscription's tree.
        const monthly = priceOf(root, "Total RC") ?? (tree.some((p) => priceOf(p, "RC") !== null)
          ? tree.filter(shown).reduce((sum, p) => sum + (priceOf(p, "RC") ?? 0), 0)
          : null);
        return {
          id: root.id,
          name: nameOf(root),
          status: root.status,
          since: toDate(root.startDate),
          endsOn: toDate(root.terminationDate),
          monthlyDKK: monthly,
          addons: addons.map((p) => ({ name: nameOf(p), status: p.status, monthlyDKK: priceOf(p, "RC") })),
        };
      });
    return {
      subscriptions,
      monthlyTotalDKK: subscriptions
        .filter((s) => s.status !== "DISCONNECTED")
        .reduce((sum, s) => sum + (s.monthlyDKK ?? 0), 0),
    };
  },
});
