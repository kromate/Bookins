# Bookings

Bookings is a Goalmatic App for service configuration, weekly availability, secure public booking links, and appointment management.

Owners use their existing Goalmatic identity and selected account. The App stores profiles, schedules, services, and bookings in installation-bound Goalmatic Tables. Guests enter through an expiring public grant that exposes only the declared booking actions.

## Local development

```bash
yarn install --frozen-lockfile
yarn dev
```

Localhost uses browser-local preview data and labels it clearly. Hosted builds never fall back to preview data.

## Build

```bash
yarn build
```

## Source and releases

`preview` is the editable branch. `main` is the read-only Store candidate. A push updates source and previews only. Production changes through the App Store release flow using an immutable tested build.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for records, trust boundaries, and release limits.
