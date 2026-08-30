# Bookings

Bookings is a Goalmatic App for service configuration, weekly availability, secure public booking links, appointment management, and contact history derived from bookings.

Owners use their existing Goalmatic identity and selected account. The App stores profiles, schedules, services, and bookings in installation-bound Goalmatic Tables. Guests enter through an expiring public grant that exposes only the declared booking actions.

## Local development

Create a Web Key in **Site Builder > App Store > Local development**. Copy the
checked-in example and set the key:

```bash
cp .env.example .env.local
# Set VITE_GOALMATIC_API_KEY in .env.local.
yarn install --frozen-lockfile
yarn dev
```

Keep using the normal Vite command. A `gmw_dev_...` key connects this source to
isolated development Tables. The App uses the signed-in workspace's real shared
credits. A `gmw_prod_...` key connects the same local source to the current Store
release permissions, production App data, connected accounts, provider actions,
and real credits. To change environments, change only
`VITE_GOALMATIC_API_KEY`. You do not need a Goalmatic CLI, proxy, or custom
command.

The Web Key is a public App identifier, not an account credential. Goalmatic
sign-in and the App consent screen authorize protected data and credit use.
Production-local keys accept only exact registered loopback origins. The consent
screen requires an explicit production warning confirmation. Never put a private
account key or provider secret in a `VITE_*` variable. Never commit `.env.local`.

If no Web Key is configured, Bookings uses browser-local preview data and labels
it clearly. If a configured key is invalid or its origin is not allowed, startup
fails visibly instead of falling back to sample data. Hosted builds never use
preview data.

## Build

```bash
yarn build
```

## Source and releases

`preview` is the editable branch. `main` is the read-only Store candidate. A push updates source and previews only. Production changes through the App Store release flow using an immutable tested build.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for records, trust boundaries, and release limits.
