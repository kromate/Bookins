# Bookings App notes

- This is the independent Goalmatic Bookings App repository.
- Use Yarn 1.22.22. Run `yarn build` for the production source check.
- `preview` is editable. `main` is the Store candidate and remains read-only in Site Builder.
- Keep owner data in installation-bound Goalmatic Tables. Never add a second identity, wallet, Firebase client, provider key, or physical Table ID to browser code.
- The `/book` route is the only anonymous App route. It may call only manifest-declared guest actions through `GoalmaticGuest`.
- Localhost may use clearly labeled browser-local preview data. Hosted builds must fail honestly when the installed or guest runtime is unavailable.
- Payments, Calendar writes, and email delivery are unavailable until a real connected-provider flow is implemented and proved.
- Update `README.md`, `docs/ARCHITECTURE.md`, and the App manifest together when resources or capabilities change.
