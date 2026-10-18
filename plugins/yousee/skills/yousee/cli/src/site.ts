// Mit YouSee: www.yousee.dk redirects to yousee.dk, whose shop app calls one GraphQL endpoint
// with a bearer from login.yousee.dk (PingFederate), signed in with MitID (signicat-id.mitid.dk).
// Never store personal data.
import { z } from "zod";
import { defineSite, type Auth } from "./runtime/site";

// The post-login response also carries name, address, email and phone; only the chain root is kept.
const postLoginResponse = z.object({ personalInfo: z.object({ customerId: z.string().min(1) }) });

export default defineSite({
  plugin: "yousee",
  skill: "yousee",
  repo: "hoaj/plugins",
  version: "0.1.1",
  generatedWith: "0.9.1",
  origin: "https://yousee.dk",
  graphqlPath: "/shop/api/graphql-server/graphql",
  auth: "login" as Auth,
  needsChrome: true,
  login: {
    startUrl: "https://selvbetjening.yousee.dk/",
    hosts: ["login.yousee.dk", "signicat-id.mitid.dk", "www.mitid.dk"],
    tokenRequest: "/shop/api/graphql-server/graphql",
    timeoutMs: 600_000,
    postLogin: async (ctx) => {
      const claims = ctx.decodeJwt(ctx.headers.authorization ?? "") as { ciam_id?: unknown; individual_id?: unknown };
      if (typeof claims.ciam_id !== "string" || typeof claims.individual_id !== "string")
        throw new Error("access token has no ciam_id/individual_id claims");
      const res = await ctx.fetch(`${ctx.origin}/shop/api/session-management/post-login`, {
        method: "POST",
        headers: { ...ctx.headers, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ ciamId: claims.ciam_id, individualId: claims.individual_id }),
      });
      if (!res.ok) throw new Error(`post-login answered HTTP ${res.status}`);
      const { personalInfo } = postLoginResponse.parse(await res.json());
      return { customerId: personalInfo.customerId };
    },
  },
  // Non-GET requests the pages send that change no data, so check --writes lets them through:
  // the shop's session setup around sign-in.
  readOnlyRequests: ["/shop/api/session-management/pre-login", "/shop/api/session-management/post-login"],
  accounts: async () => [],
});
