# Bookings App notes

- This is the independent Goalmatic Bookings App repository.
- Use Yarn 1.22.22. Run `yarn build` for the production source check.
- `preview` is editable. `main` is the Store candidate and remains read-only in Site Builder.
- Keep owner data in installation-bound Goalmatic Tables. Never add a second identity, wallet, Firebase client, provider key, or physical Table ID to browser code.
- The `/book` route is the only anonymous App route. It may call only manifest-declared guest actions through `GoalmaticGuest`.
- Localhost may use clearly labeled browser-local preview data. Hosted builds must fail honestly when the installed or guest runtime is unavailable.
- Calendar reads and writes are allowed only through the declared Goalmatic Google Calendar operations (workspace approval policy, no attendees) and must be proved on a real connected account before release. Payments and guest emails remain unavailable. The only email Bookins sends is the owner daily agenda from the manifest-declared `owner-daily-agenda` workflow (SCHEDULE_INTERVAL -> TABLE_READ `bookings` -> SEND_EMAIL to `USER_EMAIL`); never send email from browser code, and do not claim it works until proved on a real account. Do not use `$appResource` in workflow trigger props; the importer rejects it.
- Guest messages are prefilled WhatsApp/SMS/email links opened in the owner's own apps (`messaging.ts`). Label them "Open WhatsApp", never "Send"; Bookins must not claim delivery.
- Owner time off is a `blocked` booking record; every page and metric must exclude it with `isTimeOff()`.
- Update `README.md`, `docs/ARCHITECTURE.md`, and the App manifest together when resources or capabilities change.
- Messages and campaigns are owner-opened, never automatic. Never claim delivery, sent, open rates, replies, or revenue attribution; say "opened by you". Offers are text the owner honours by hand: Bookins never applies a discount automatically (prices are display-only).
- `marketing_opt_out` contacts must be excluded from every campaign queue, email BCC batch, and CSV export (`campaigns.ts` enforces it; keep tests that prove it). Campaign messages always keep a "Reply STOP to opt out" line. Placeholder `@bookins.invalid` emails are never used as email addresses (phone-only clients may still get WhatsApp or SMS).
- Teams: a member is a person plus their own schedule. The owner is implicit member "You"; single-owner installs must behave exactly as before until the first team member exists. Per-member service copies are tagged in the description trailer (`service-meta.ts`); never show the trailer to owners or guests.
- Interface rules live in `docs/BRAND.md`: semantic tokens only (no raw hex in pages), marigold only for now/today/due, status as shape plus word, sentence case, no eyebrows or middle-dot separators, `<details data-menu>` for menus, and `/book` stays host-first (no Bookins link away from the guest page). Guest copy goes in `i18n/guest.ts` for both languages.
- The `owner-daily-agenda` TRANSFORM_DATA source lives in `scripts/agenda-transform.src.ts` and is transpiled and synced into the manifest by `scripts/sync-agenda-workflow.mjs`. It must not contain a less-than character, double braces, entity text, or at-step tokens (the platform rewrites them in step props). The digest, including reminder links, stays unproven until run on a real account.
