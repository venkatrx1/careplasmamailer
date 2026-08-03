// Cloudflare Pages "Advanced Mode" entry point. This project exists solely to
// run the mailer — there's no static site to preserve here — so a root-level
// _worker.js (which takes over all routing) is fine, unlike in the main
// careplasma site's repo.
export { default } from "./index.js";
