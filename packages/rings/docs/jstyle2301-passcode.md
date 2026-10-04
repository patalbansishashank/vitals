# J-Style 2301 firmware V0789: where the `0x3C` passcode comes from

Plan 04, item 1, "one thing to verify" (R19). Evidence read on 2026-10-04 from Lumen Health,
the owner's local research collector (Python, under `~/Documents`), and the Vitals port.
The passcode value itself is never quoted here; it lives only in `passcode.ts`.

## Verdict

**Undecidable with the evidence on disk between (a) one constant shipped inside the vendor app
and (b-set) a value the vendor app itself wrote to the ring once.** Hypothesis **(c) per account,
issued by the server** has the least support: the only server response captured names a boolean
`usePassword` and no password-like field. Hypothesis **(b-derived) from serial, MAC or a ring-side
default read over BLE** is ruled out for the ring side: the vendor app sent the `0x3C` write as its
very first write, to an emulated ring that exposed nothing but FFF6/FFF7, so nothing was read from
the ring first. A derivation from the advertised address or name alone cannot be excluded without
inspecting the value, which this note deliberately does not do.

Whatever the source, **the vendor app learnt it silently**: right after the OTA to V0789 the owner
restarted the vendor app and it "connect[ed], authenticate[d], and sync[ed]" with no prompt. So a
silent path exists for the vendor app. Whether Vitals' constant reproduces it on a *second* ring
depends on (a) versus (b-set), which one ring cannot distinguish.

## Evidence (file + line, quoted where safe)

1. Lumen `docs/*-v0789-transition.md` (file name carries the vendor brand), lines 64-66:
   "when the server's `usePassword` flag is enabled, it sends a 16-byte `0x3C` authentication
   command containing the saved/candidate password and waits for a `0x3C 0x01` success response
   before reading health history."
2. Same file, lines 20-24, the firmware-config response fields: "`cdnUrl`, `latestFirmwareVersion`,
   `updateAvailable`, `forceUpdate`, and `usePassword`". A boolean, no value. Argues against (c).
3. Same file, lines 59-62: on the first unauthenticated connection V0789 "did not answer the
   existing ... history requests. Restarting [the vendor app] allowed the official app to connect,
   authenticate, and sync" with no user input. The app already knew the value one minute after
   the firmware that first required it. Argues for (a) or (b-set), against "asked the person".
4. Same file, lines 70-77 (the emulator): the Linux adapter "advertised the ring's normal address,
   name, manufacturer marker, and FFF0 service"; the fake ring "exposed only FFF6 write, FFF7
   notify, and their CCCD"; the app's "first application write was the expected 16-byte `0x3C`
   authentication command." Nothing was read from the ring before the write, so the value is not
   negotiated with, nor read from, the ring. Rules out b-derived-from-ring and a ring-side default.
5. Same file, line 79: "The credential is eight printable ASCII characters." Nothing more is public.
6. Research collector `README.md`, lines 17-19: the tool "deliberately cannot ... change a
   password, rename the ring, alter device binding". `protocol.py`, lines 3-5: mutating commands
   "(rename, password changes, and device binding) are intentionally not" implemented. So the
   J-Style 2301 SDK does have a *change-password* command. The ring stores a settable value; the
   vendor app could in principle have set it (b-set) or be sending the factory/app default (a).
7. Research collector `protocol.py`, line 71, and Lumen `JStyle2301Protocol.kt`, line 67: `0x3C`
   is "non-mutating, connection-scoped" authentication; it is re-sent on every connection and
   accepts 1-14 printable ASCII characters (Kotlin `require` on lines 69-71).
8. Captured server traffic: the private OkHttp log in the research baselines is 0 bytes; the
   private logcat has no vendor identifier containing "password". No decompiled vendor sources
   (`com.jstyle.blesdk2301`, `SetDevicePassword`, `GetDevicePassword`, `candidatePassword`) exist
   anywhere on disk; the Lumen plan notes (`plan/optimization-1/00-orientation.md`, line 136) say
   the decompiled apps were never checked in. The "saved/candidate" wording survives only as a
   paraphrase in evidence 1.
9. Vitals R10 (`plan/01-after-launch/research/R10-android-estimators.md`, line 401) already asked
   the same question and left it open: "can any non-owner user obtain it (it comes from [the
   vendor]'s server `usePassword` config)?" The flag comes from the server; the value's origin was
   never established.

## How the vendor app obtains and uses it (as far as the notes show)

server `get-ring-config` -> `usePassword: true` -> app picks its *saved* value, else a *candidate*
-> 16-byte `0x3C` + ASCII value + checksum on FFF6 -> ring answers `3c 01` (accepted) or `3c 00`
(rejected) on FFF7 -> history opcodes `0x51..0x66` are answered only after `3c 01`.
"Saved or candidate" reads most naturally as: *candidate* = the value to try when none has been
confirmed for this ring (an app-shipped default or a value the app intends to set), *saved* = the
value confirmed by a `3c 01`. Neither word implies a per-account value from the server.

## A second V0789 ring under each hypothesis

| Hypothesis | Vitals' constant on another V0789 ring | What the vendor app would do |
|---|---|---|
| (a) one app-shipped constant | `3c 01`, history flows, nothing to set up | same constant, same result |
| (b-set) app sets a value per ring | `3c 00` on a ring the vendor app already bound; `3c 01` only if that ring's value happens to equal the default | would send change-password after binding; the value is in the app's local store |
| (b-derived) from address/name | `3c 00` unless the derivation happens to match | derive and send |
| (c) server per account | `3c 00` | fetch under the person's account; not visible in the one captured response |

## Factory reset and OTA

- OTA V0525 -> V0789 *introduced* the requirement on the owner's ring; the value accepted after the
  OTA was recovered later by the emulator and still works, so the OTA itself did not change it.
- Factory reset: no evidence on disk. From general knowledge, unverified against this ring: in
  J-Style SDK generations that carry a device password, the ring keeps a set value across power
  cycles and a reset returns it to the vendor default; the 2301 SDK's exact set/get opcodes, and
  whether the current value can be read back, were not found anywhere on disk.

## Recommendation for Vitals

**Option 1: keep the constant.** On a V0789 ring treat `3c 00`, or no `3c` reply within the
authentication timeout, as "this ring needs a one-time setup" in the sync report only. No UI field,
no hint (decision 13). V0525 and unknown profiles keep skipping authentication. Nothing else to do
until a second ring exists; on the owner's ring the constant is proven against hardware.

Option 2 (silent derivation): none found. Nothing is read from the ring before `0x3C`, and the
server sends only a boolean. The one path that *could* make a bound second ring work silently is
the SDK's change-password command (evidence 6): write the constant as the ring's new password
first. It is a mutating command whose opcode is not verified on disk, it would only help under
(b-set), and the plan forbids guessing mutating opcodes; do not implement it without the owner.

Option 3 (stop and tell the owner) is not needed now: the constant is correct for the only ring
Vitals has, the shared/per-ring question changes nothing a person sees (decision 13), and the
"needs one-time setup" line in the report is the whole fallback.

## What a second V0789 ring would prove

1. Fresh ring, never bound to any vendor account: Vitals sends the constant. `3c 01` kills (c)
   and (b-set) for factory rings and makes (a) or a factory default the answer. `3c 00` means the
   value is not a factory default.
2. The same second ring after the vendor app binds it under the *owner's* account, then Vitals
   again: `3c 01` -> not per ring; `3c 00` -> the vendor app set a per-ring value (b-set).
3. The same ring bound under a *different* account: `3c 01` -> not per account; `3c 00` with
   step 2 passing -> per account (c).
4. Factory-reset that ring from the vendor app and repeat step 1: tells whether a reset returns
   the ring to a default the constant matches.
5. Optional, read-only: with HCI snoop working on a phone, check whether the vendor app ever
   sends a write other than `0x3C` before `3c 01` on a fresh ring (that write would be
   set-password). No value is needed from the capture, only the opcode sequence.
Each step is pass/fail on `3c 01` versus `3c 00`; none requires reading or printing the value.
