// The site this CLI skill wraps. Totalkredit's rate tables are public: the API answers
// without a cookie or token, so there is no login and no bootstrap.
import { defineSite, type Auth } from "./runtime/site";

export default defineSite({
  plugin: "totalkredit",
  skill: "totalkredit",
  repo: "hoaj/plugins",
  version: "0.1.0",
  generatedWith: "0.10.0",
  origin: "https://www.totalkredit.dk",
  auth: "none" as Auth,
  needsChrome: false,
});
