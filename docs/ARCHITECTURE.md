# Bookings architecture

## Product boundary

Bookings owns the owner dashboard, guest booking page, schedule rules, service visibility, booking copy, and migration mapping. Goalmatic owns identity, account selection, installation bindings, Tables, public grant admission, platform execution, audit, credits, integrations, and App lifecycle.

## Records

- `profiles` stores the public display name, bio, photo, timezone, and current public-link metadata.
- `schedules` stores recurring weekly windows, timezone, slot interval, notice, horizon, and revision.
- `services` stores the offering, duration, display price, schedule binding, visibility, status, and revision.
- `bookings` stores a service snapshot, UTC range, timezone, guest contact, notes, status, reference, and unique reservation key.

Contacts are derived from bookings in v1. The App has no separate wallet, provider-token store, or App-only identity.

## Capacity rule

One schedule represents one bookable resource. Services on that schedule must be no longer than its slot interval. The booking adapter derives `scheduleId|startsAt` as a unique reservation key. Goalmatic Tables creates the record and uniqueness marker in one transaction, so two guests cannot confirm the same schedule slot. Cancellation changes the reservation key to `released:<bookingId>` while retaining history.

## Public boundary

The pinned App manifest declares `/book` and three named guest actions. The installed owner runtime is not injected on that route. An owner creates an expiring grant for one installation and release. The raw token is exchanged from the URL fragment into an HttpOnly cookie. Guest calls cannot supply account, installation, release, physical Table, or provider IDs. Site Builder injects the grant subject and installation-bound Table IDs before invoking the bounded Goalmatic booking adapter.

## Provider truth

Bookings v0.2.0 guarantees on-screen confirmation, owner dashboard visibility, and a read-only Contacts view derived from booking history. A non-zero price is informational and described as arranged with the owner. Email delivery, Calendar writes, online payment, payout, guest cancellation, and rescheduling are not claimed until their provider paths are connected and proved.

## Uninstall and release

Uninstall revokes App sessions and public grants before detaching bindings. Data is retained for 30 days and remains exposed as Tables after uninstall unless the owner explicitly deletes eligible App-provisioned data.

Private testing and Store publication are separate. Production must promote the exact tested build and artifact digest without rebuilding.
