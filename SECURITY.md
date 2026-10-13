# Security

Segundo holds clients' budgets in a contract and pays freelancers by the second. The contract is deployed under Segundo's working name, **Till**, which is the name used for it below. This page lists who can move money, what each piece trusts, and how each attack we could think of is stopped. Every claim points at code or a test.

## Who can move money

| Money | Can only go to | Who can trigger it | Code |
|---|---|---|---|
| A tab's earned pay | The tab's freelancer (`payee`) | Anyone, through `settle` / `settleMany` (the relayer, the demo keeper, or the Chainlink CRE workflow through SegundoKeeper) | `Till._settle` |
| A tab's unspent budget | The client who opened it (`payer`) | The client or the freelancer, through `close` | `Till.close` |
| A new budget or top-up | Into the tab | Only the client's own signature (AUSD permit or approval) | `Till._open`, `Till._topUp` |
| Segundo's 1% fee on a budget or top-up | The treasury `0xAdF0…F62c`, at the amount the client signed | Only the client's own EIP-3009 transfer authorisation, submitted by the relayer | `signFee` in `web/lib/relay.ts`, `web/app/api/relay/route.ts` |
| A fee refund | The client who paid the fee | The treasury's EIP-3009 signature, made by the server only for a failed open or a closed tab, with a nonce derived from that fee or tab | `web/lib/refund.ts` |
| AUSD sent by link, to an email or to an address | The address in the signed authorisation | The sender's signature; for a link, the link's own key | `web/app/api/send/route.ts`, `web/lib/sendlink.ts` |

The contract has no owner, no admin key, no upgrade path and no fee switch. Nobody, including us, can redirect a budget. The fee and its refunds live outside the contract: they are separate AUSD transfers, so they can never touch money already in a tab.

## Trust boundaries

- **Relayer (a pool of keys).** It pays gas and submits signed requests through OpenZeppelin's `ERC2771Forwarder`. `KEEPER_KEY` is key 0 and `RELAYER_KEYS` adds more (`web/lib/pool.ts`); payouts go to a key chosen by tab id and sends by the sender's address, so one person's actions stay in order on one key. A relayer cannot forge a request: the forwarder checks the user's EIP-712 signature and nonce, and `Till` reads the caller from the forwarder only. The worst a relayer can do is refuse to submit, and users can then call `Till` directly from any wallet.
- **Forwarder.** OpenZeppelin v5.4 `ERC2771Forwarder`, unmodified. `Till` trusts exactly one forwarder, fixed at deployment.
- **AUSD.** Agora's AUSD on Monad testnet (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`), checked against docs.agora.finance. Permits and transfer authorisations are verified by AUSD itself (EIP-712 domain "Agora Dollar", version 1). AUSD is an upgradeable, pausable issuer token: if Agora pauses or upgrades it, Till's transfers stop or change with it, which is the trade-off of paying in a regulated dollar.
- **Treasury.** A plain account. Its key (`TREASURY_KEY`) is server-only and only ever signs AUSD transfer authorisations for fee refunds, which the relayer submits; the treasury holds no MON and sends no transaction itself. Nothing in the contract depends on it.
- **Exchange rates.** Shown for reading only (open.er-api.com, cached six hours). They never touch the contract or any amount that moves. The rates the CRE workflow posts on chain are not read by the app.
- **Accounts.** Three ways in, all signing EIP-712 messages only (nobody sends a transaction or holds gas): a **passkey account** made with Mera (the main one, see below), **email** through a Privy embedded wallet, and a **practice wallet**, a browser-only key in `localStorage` for trying the app with test AUSD. The passkey-only site (mera.segundo.world) offers Mera alone and never loads Privy.
- **Privy server API.** Called from one route (`web/app/api/recipient`) with `PRIVY_APP_SECRET`, server-only, to find or create the wallet for an email address. Errors never include the secret (`web/lib/privy-server.ts`).
- **Envio HyperRPC.** Read only. It feeds `/api/stats`, `/api/history`, income statements and the long-tab fallback for fee refunds; it never decides what moves on its own. A wrong answer would show wrong history, and every line links to its transaction so a reader can check it. The API token is server-only and sits in the request URL, which is never logged or put in an error (`web/lib/envio.ts`). Without it, or when HyperRPC fails, the routes fall back to the public RPC and say `source: "rpc"`.
- **Chainlink CRE.** SegundoKeeper can only call `Till.settleMany` / `settle` (which pay freelancers what they have earned, and nothing else) and store exchange rates. See [the CRE receiver](#the-chainlink-cre-receiver).

## Attacks and what stops them

| Attack | What stops it | Proof |
|---|---|---|
| Steal an invite by copying the claim from the mempool | The invite key signs `(contract, chain, tab, claimer)`; a copied signature only works for the original claimer, on that tab, on that Till, on that chain | `test_inviteClaimCannotBeStolen`, `test_inviteSignatureIsBoundToTabContractAndChain` |
| Claim an invite twice | The invite key is wiped on the first claim | `test_inviteClaimCannotBeStolen` |
| A stranger clocks out, pauses or closes someone's tab | Only the payee can clock in; payer or payee for clock-out and close; payer only for hold, rate, top-up | `test_onlyTheRightPeopleTouchTheClock` |
| Freelancer earns past the budget | Earnings are capped at the budget; time past it is never owed, even after a top-up | `test_budgetCapsPayAndTopUpRestartsTheShift` |
| Client changes the rate mid-shift | `setRate` only works while the clock is stopped | `test_onlyTheRightPeopleTouchTheClock` |
| Rounding drift leaves money stuck or overpays | At close, freelancer received plus client refund equals the budget exactly, across 1,000 fuzzed schedules | `testFuzz_moneyIsConserved` |
| Relayer replays a signed request | Forwarder nonces, checked on chain; the app signs each request with a 10-minute deadline the forwarder enforces | OpenZeppelin `ERC2771Forwarder`, `test_forwarderRejectsReplayExpiryAndForgedFrom` |
| Front-running a permit to make `openWithPermit` fail | A failed permit is ignored if the allowance is already there | `Till._permit` |
| Reentrancy through the token | Transient-storage reentrancy guard on every function that moves tokens; state is written before transfers | `ReentrancyGuardTransient`; `TillAdversary.t.sol` re-enters `settle`, `settleMany` and `close` from inside a transfer and every attempt reverts |
| Relayer drained by spam | The relayer only pays for `Till` calls, verifies the signature, estimates the inner call and refuses requests asking for more than 1.5× that estimate (Monad charges the limit), refuses tabs and top-ups under $0.50, rejects a second copy of a request already in flight (keyed by its signature), and paces per signer, per IP address and overall. When MON runs low it keeps gas for the actions that return money: watch-payouts pause below 0.4 MON, new tabs, top-ups, sends and profiles below 0.15, clock-ins below 0.05, and clock-outs, holds, closes, invite claims and fee-refund retries run down to 0.02, about one transaction (`RESERVE` in `web/lib/server.ts`). With a pool, a key below its tier hands the request to the richest key, and an action pauses only when no key has enough. `/api/health` shows the state, the app shows a notice bar and the open form says so before anyone signs; with `AUTO_REFUEL=1` a health check moves 3 test MON from the faucet wallet to the relayer when it falls under the top tier | `web/app/api/relay/route.ts`, `relayerFor` in `web/lib/server.ts` |
| Relayer drained through payouts | `/api/settle` pays at most once per 6 blocks per tab (a throttle every server instance agrees on), skips amounts under half a cent, paces per IP and overall, and stops watch-payouts when the relayer's MON falls below a reserve so clock-ins and closes keep working; the tab page itself slows from every 6 s to every 20 s to once a minute | `web/app/api/settle/route.ts`, `web/app/tab/[id]/page.tsx` |
| Relayer drained through AUSD transfers | `/api/send` relays transfers of at least $0.01 between two different addresses, never into the treasury, the Till, forwarder or AUSD contracts, or any other contract (where it could not come back out), one copy of each authorisation at a time, paced per sender, per IP and overall | `web/app/api/send/route.ts` |
| Faucet drained | One drip per address per hour, six per IP address per hour, 120 an hour per server instance, refused when the wallet already holds 10 AUSD | `web/app/api/faucet/route.ts` |
| Two relayer instances race on a nonce | Within an instance, each key picks its nonces one at a time (the wait for the block runs in parallel); across instances a nonce clash is retried with a fresh nonce and jitter, and a transaction that never lands makes the key re-read its nonce from the chain. A reverted duplicate costs its gas limit and nothing else | `sendAndWait` in `web/lib/server.ts` |
| Logged invite, link or disclosure keys | Invite keys, send-link keys, disclosure request codes and replies all travel after `#`, so they never reach a server log; the install QR code carries the path only | `web/lib/invite.ts`, `web/lib/sendlink.ts`, `web/lib/disclose.ts`, `web/components/InstallApp.tsx` |
| Relayer charges a different fee, or sends it somewhere else | The client signs the exact amount and the treasury as recipient; AUSD checks the signature, so neither can be changed. The relayer also refuses a fee whose `from` isn't the request's signer, whose `to` isn't the treasury, or whose amount is under 1% | `web/app/api/relay/route.ts`, `web/lib/authorization.ts` |
| Open a tab without paying the fee (move the AUSD away between the open and the fee) | The fee is collected **before** the open, and the open is simulated again after the fee lands | `web/app/api/relay/route.ts` |
| Fee kept for a tab that never opened | If the forwarded open or top-up fails after its fee landed, the treasury sends the whole fee back in the same request | `refundFee` in `web/app/api/relay/route.ts` |
| Fee or refund paid twice | Each fee authorisation carries a random 32-byte nonce AUSD accepts once, and a second copy is refused while the first is in flight. Each refund's nonce is derived from the tab (close) or the client's fee nonce (failed open), so AUSD refuses a second refund of the same thing on any instance; a retry for an already-refunded tab answers "already refunded" | `tabRefundNonce`, `feeRefundNonce` in `web/lib/refund.ts`; VERIFY.md shows both nonces on chain |
| Inflate a close-time refund | The refund is `floor(refunded ÷ 100)` from the tab's own `Closed` event, capped at the fees actually found for that tab's fundings and at 1% of its total budget; the treasury signs nothing else | `refundClosedTab` in `web/lib/refund.ts` |
| Use the email lookup to test a list of addresses | Ten lookups a minute and sixty an hour per IP, 600 an hour overall; Segundo doesn't store the email | `web/app/api/recipient/route.ts` |
| A request link that pays someone else | The link is a suggestion only: the open page checks every field, strips control, zero-width and bidirectional characters from the name and note, shows the full address in groups of four with a prompt to check it with the freelancer, and the client still reviews and signs | `web/lib/request.ts`, `web/app/open/page.tsx` |
| A look-alike site asks for a Segundo passkey | The relying party is pinned to `segundo.world`; any other host (except localhost and Vercel previews, which get their own separate accounts) is refused before WebAuthn is called | `relyingParty` in `web/lib/mera.ts` |

## Monad specifics

- **Gas limit is charged, not gas used.** Every transaction the relayer, faucet and bots send uses the chain's own estimate plus 15%. A forwarded request carries the gas the signer asked for (the app asks for the estimate plus 25%), and the relayer refuses anything above 1.5× its own estimate. Nothing uses a blanket limit.
- **Parallel execution.** Pay accrues from timestamps and settles per tab. Till's own shared state is one counter, `tabCount`, written when a tab opens. Every payout also writes the escrow balance slot inside AUSD, which is shared by all tabs; Monad's optimistic execution re-runs the later of two payouts that land in one block, so correctness never depends on ordering.
- **Log queries are capped at 100 blocks on public RPCs.** Each tab stores the block of its last change, and every change emits `Activity(id, prevBlock)`, so a tab's pay stub is read one exact block at a time with no indexer. Long views (statements, revenue) come from Envio HyperRPC, read only.

## The fee path

Clients pay 1% on top of every budget and top-up (`feeFor` in `web/lib/money.ts`: amount ÷ 100, rounded up to the next AUSD unit). In order (`web/app/api/relay/route.ts`):

1. **Signed with the open.** The browser signs the forward request, the AUSD permit and an EIP-3009 `transferWithAuthorization` of the fee to the treasury in one step (`signFee` in `web/lib/relay.ts`, valid for 30 minutes). Passkey, email and practice wallets sign silently, so there is no extra prompt.
2. **Checked and simulated before anything moves.** The relayer refuses a missing fee, a fee from anyone but the signer, to anyone but the treasury, under 1%, or with under two minutes left to run. It checks the wallet holds the budget plus the fee, runs the fee transfer as it will be sent (`estimateGas`) and simulates the open, so a bad, spent or underfunded request is refused before anything moves.
3. **Fee first.** The relayer sends the fee and waits for it to land. If it fails, nothing else is sent.
4. **Then the open or top-up**, simulated again (the wallet or the tab may have changed while the fee landed), then sent through the forwarder.
5. **A failed open gets its whole fee back.** The treasury signs a refund of the full fee to the client, nonce `keccak256("segundo:fee-refund:fee" ‖ client fee nonce)`, and the relayer sends it in the same request; the client is told the fee came back. If that refund itself fails, the server logs `FEE REFUND FAILED` with the amount, client and fee nonce, and the derived nonce means it can only ever be paid once.
6. **At close, 1% of the unspent budget comes back.** After a close lands, the relayer reads the tab's `Closed` event and fundings, computes `floor(refunded ÷ 100)`, caps it at the fees that tab actually paid and at 1% of its whole budget, and sends a treasury-signed refund with nonce `keccak256("segundo:fee-refund:tab" ‖ Till ‖ id)`. If it doesn't go at close, `POST /api/relay {"refund": "<tab id>"}` sends it later; repeating it is harmless.

The demo studios run their own keys and send their fee right after their open (`bots/till-bots.mjs`). The fee and refund transactions are listed in [VERIFY.md](VERIFY.md#the-1-fee-on-chain).

## Send links

`web/lib/sendlink.ts`, `web/app/claim/page.tsx`, `web/components/SendSheet.tsx`.

- **How it works.** The sender's browser makes a fresh secp256k1 key, saves it, then sends the AUSD to the key's address. The link carries the key after `#`. Collecting, and taking back, is that key signing one EIP-3009 transfer of its whole balance; the relayer submits it, so the link's address never needs MON.
- **The link is the money.** Anyone who has the whole link can collect it, so it should go only to the receiver. The claim page reads the amount from the link's balance on Monad, never from the link's text, and says plainly when a link is already collected or was taken back.
- **Where the key is kept.** Only in the sender's browser: `localStorage` under `segundo.links.v1.<sender>` (up to 60 links), so the sender can share a link again or take it back. The key is saved before any money moves, so a page closed mid-send can still be taken back. Anything running in the page, or anyone with the device, can read these keys, as with any browser-held key. The receiver's browser history also keeps the full link until it is collected.
- **No server copy.** The fragment is never sent to a server, and `/api/send` sees only the signed transfer.

## Sending to an email address

`web/app/api/recipient/route.ts`, `web/lib/privy-server.ts`, `web/lib/recipient.ts`.

- The route cleans the address, then asks Privy for that email's user, creating one with a pregenerated Ethereum embedded wallet if there isn't one, and returns the wallet address. The AUSD goes there in an ordinary signed transfer. Privy holds the wallet; the person reaches it by signing in with that email.
- **A typo sends money to whoever owns the typed address.** The send sheet looks the email up first and shows it back, with whether it already has a Segundo account, before the sender signs anything.
- **What a lookup reveals.** The answer includes `existing`, whether that email has signed in to Segundo before (so the sender can be told what the receiver will see). That is one bit per lookup, and lookups are rate limited as above. Each lookup of a new address creates a Privy user, bounded by the same limits.
- Segundo doesn't store the email; it passes it to Privy at the moment of the send. Without `PRIVY_APP_SECRET` the option says it is switched off.

## Passkey accounts (Mera)

`web/lib/mera.ts`, `web/lib/wallet.tsx`, `web/lib/keys.ts`.

- **Where the key comes from.** The passkey's WebAuthn PRF output (32 bytes the authenticator computes from a secret it never releases, the relying party and a salt) becomes BIP-39 entropy, then the key at `m/44'/60'/0'/0/0`. Same passkey, same relying party: same account, on any device the passkey syncs to. The intermediate bytes (PRF output, seed, derived key) are zeroed as soon as Mera's signing session holds its copy.
- **What is stored.** `localStorage` holds the credential id, its transports and the public address. No key material is written anywhere, and no server sees any of it.
- **While unlocked.** The key lives only in page memory, inside Mera's signing session, which zeroes it when it ends. It ends on sign-out, after 15 minutes without a tap or key press, after 5 minutes with the page in the background, and when the page is closed; the next signature asks for the passkey again. Anything running in the page while it is unlocked can ask it to sign, as with any browser wallet; these limits keep that window short. Derived invite and disclosure keys are dropped at the same moment (`segundo:lock`).
- **Pinned relying party.** Passkeys are made and used for `segundo.world` (`NEXT_PUBLIC_RP_ID`) on segundo.world and every subdomain, including mera.segundo.world, so one passkey opens one account on all of them. On `localhost` the relying party is `localhost`; on a `*.vercel.app` preview it is that preview's own hostname, with a note that accounts made there open only there. Any other host is refused with a pointer to segundo.world, so a look-alike site can't ask for a Segundo account's PRF output.
- **Without PRF.** If an authenticator can't do PRF, no account is made and the person is pointed to email sign-in.

### One passkey, four keys

| Key | PRF salt | Becomes | Kept |
|---|---|---|---|
| Wallet | `sha256("mera.prf.salt.v1")` | BIP-39 → secp256k1 | In Mera's signing session until it locks |
| Seal | `sha256("segundo/seal/v1")` | HKDF → AES-256-GCM (non-extractable) | Until the session locks |
| Invite | `sha256("segundo/invite/v1")` | HKDF root, then one secp256k1 key per tab | Root until the session locks |
| Disclose | `sha256("segundo/disclose/v1")` | HKDF → X25519 | Until the session locks |

Different salts give unrelated PRF outputs, so holding one key says nothing about another. When two keys are needed at once (sharing sealed details), one fingerprint prompt evaluates both salts through WebAuthn's second PRF input; nothing is derived from anything else.

- **Invite keys.** `inviteKey = HKDF(PRF(invite salt), salt "segundo/invite/v1", info "tab:" + chain + ":" + Till + ":" + payer + ":" + slot)`, where `slot` is the tab's position in `Till.tabsOf(payer)`. The on-chain protections for invites are unchanged (the key signs `(contract, chain, tab, claimer)` and is wiped on claim). A rebuild tries the slot and its near neighbours and keeps only a key whose address equals the invite address the contract holds, so it can never produce a wrong key. Anyone who holds the passkey can rebuild any unclaimed invite of that account, which is the point.
- **Sealed private details.** `web/lib/seal.ts`, `web/components/SealedDetails.tsx`. A freelancer's legal name, postal address, tax ID and payout account. HKDF-SHA-256 (info `segundo/seal/v1/aes-256-gcm`) into a non-extractable AES-256-GCM key; each seal uses a fresh 12-byte nonce; the account, the passkey's credential id, the format version and the seal time are bound in as additional data (version 2; version 1 envelopes, which bound only the account, still open), and the app refuses an envelope whose account isn't the one signed in. Only ciphertext is kept, in this browser's `localStorage`; the optional backup file is the same ciphertext. Our servers never receive the details, sealed or open. Lose the passkey and the details are gone: there is no recovery copy and no escrow. The envelope shows which account and passkey it belongs to, when it was sealed and roughly how long the contents are.

### Selective disclosure

`web/lib/disclose.ts`, `web/components/Disclosure.tsx`. A freelancer shows a landlord, bank or visa office only the sealed fields they pick, readable by that one verifier, tied to one income statement.

- **The verifier's key.** `/proof/<address>?request=1` makes a one-time X25519 key pair in the verifier's browser; the private half stays in its `localStorage`, the public half travels after `#` as a request code.
- **Who sent it.** The freelancer's wallet key signs a one-line certificate binding their disclosure public key to their account (public, kept in `localStorage`). The verifier's page checks that the signature recovers to the statement's account before it shows anything.
- **Only for this verifier and this statement.** `key = HKDF(X25519(disclosure secret, verifier key), salt "segundo/disclose/v1", info "aes-256-gcm|" + verifier key + "|" + sender key)`, AES-256-GCM with additional data binding the chain, the statement URL, the block the statement was read at and both keys. A reply made for another browser, another statement or another block fails to open, and says so.
- **What it can't do.** Once the verifier has read the details, they have them; there is no revoking a disclosure. The verifier's one-time private key sits unencrypted in their browser until they start a new request. Segundo's server takes no part.

## The Chainlink CRE receiver

`cre/contracts/src/SegundoKeeper.sol` (`0xFEf8…d80D`, Sourcify exact match), `cre/contracts/test/SegundoKeeper.t.sol`.

- **Who can deliver a report.** `onReport` reverts unless the caller is an allowed forwarder: the CRE KeystoneForwarder for Monad testnet (`0xF834…4482`), which delivers DON-signed reports from a deployed workflow, and the MockKeystoneForwarder (`0xB9F7…D192`) used by `cre workflow simulate --broadcast`. `test_rejectsNonForwarder`.
- **Which workflow.** When the owner sets `expectedWorkflowId`, reports carrying any other workflow id are refused (`test_workflowIdCheck`). It is unset while simulating, because the mock forwarder sends no workflow metadata, and the mock forwarder doesn't check DON signatures: while it is on the allowlist, a report delivered through it is not proof of DON consensus. For a deployed workflow the owner sets the workflow id and can drop the mock forwarder (`setForwarder`).
- **What a report can do.** Settle tabs (which only ever pays freelancers what they have earned, and anyone may do it anyway) and store rates. Malformed reports are refused (`test_rejectsMalformedReport`); a report older than the last one has its rates ignored but still settles (`test_staleRatesIgnoredButStillSettles`); one tab that can't be paid is skipped, not fatal (`test_oneBadTabDoesNotBlockTheRest`). The rates are informational: no amount in the app or the contract depends on them.
- **Owner.** SegundoKeeper has an owner (OpenZeppelin `Ownable`) for the forwarder allowlist and the workflow id only (`test_onlyOwnerAdmin`). The owner cannot move AUSD or touch Till's tabs.

## Installable app and Android

`web/public/sw.js`, `web/app/manifest.ts`, `web/components/InstallApp.tsx`, `android/`.

- The service worker **never caches or touches `/api/*`**, ignores anything that isn't a same-origin `GET`, and so never sees a signature or a relayed request.
- Pages are network first, so money on screen is always live; the last good copy of a page (never one with a query string) is shown only when the network is gone, and the offline page says nothing was sent. Built assets are cached by their hashed names. Old caches are deleted when the worker's version changes. It registers in production builds only.
- The Android app is a Trusted Web Activity with no app code of its own: it opens segundo.world in the phone's Chrome, so passkeys, storage and the relying party are the website's. It runs full screen only because `/.well-known/assetlinks.json` lists the package `world.segundo.app` and its signing certificate's SHA-256 fingerprint. The release keystore is kept out of the repository.

## What the audit found and how it is handled

A second review on Oct 4 added 34 tests (`contracts/test/TillEdges.t.sol`: 32 edge cases and a stateful invariant suite), and a third on Oct 11 added 7 adversarial tests (`contracts/test/TillAdversary.t.sol`: reentrancy from inside a transfer, invite replay across tabs, deployments and chains, rate changes against a running shift) and the relayer's reserve tiers, health endpoint and notice bar. Nothing on chain needed changing. On Oct 13 the fee, passkey accounts, sealed details, Envio-backed history and the installable app were added, then send links, email recipients, the four passkey keys with selective disclosure, the CRE receiver, fee-first ordering with refunds, and the relayer key pool, all off chain apart from SegundoKeeper, with the guarantees above. Three things are worth knowing about the contract:

- **Issuer controls on AUSD.** AUSD can freeze accounts. A frozen freelancer blocks `close` on their tab, so the client's refund waits until the freeze lifts (the client can still pause pay); a frozen freelancer also makes a whole `settleMany` batch revert, so the keeper (and SegundoKeeper) falls back to settling tabs one at a time. A frozen client blocks `close`, but `settle` still pays the freelancer. `test_frozenPayeeLocksRefundAndBreaksBatch`, `test_frozenPayerBlocksCloseButNotSettle`.
- **Unsolicited tabs.** Anyone can open a tab to any address and `tabsOf` has no limit. The app and the bots read the whole id list (one call) and then the tabs in batches of 80, and the demo freelancers only clock in on tabs of at least $0.50, one per freelancer every few seconds. Thousands of dust tabs sent to one address would slow its pages down; a paged `tabsOf` and a payee-side accept step are on the v2 list. `test_dustTabsBloatPayeeTabList`.
- **Rounding.** Pay rounds down once per shift, losing under a millionth of a dollar each time; settling often loses nothing because pay is recomputed from the start of the shift. `test_roundingLossIsUnderOneUnitPerShift`, `test_frequentSettlesLoseNothingToRounding`.

The stateful suite (`TillInvariantTest`) drives random opens, clock-ins and outs, holds, rate changes, top-ups, settles, batch settles, closes and time jumps, and checks after every action that the contract holds exactly what open tabs still owe, that freelancers hold exactly what was paid, that `paid ≤ earned ≤ budget`, and that pay never goes down.

**The relayer is best-effort testnet infrastructure.** Its limits are per server instance and signing costs nothing, so a determined spammer can still burn the relayer's MON. The worst case is that the gasless path pauses, in the order above; the contract is unaffected and anyone can call it directly from a funded wallet. What it costs, from the relayer's own receipts on Oct 13: a payout 97,673 gas, a forwarded open 512,162, a fee or refund transfer 113,517 (about 0.01 MON for a payout at 102 gwei). `GET /api/health` reports the relayer's and faucet's balances, and `node bots/topup.mjs keeper=10` moves test MON between the project's wallets.

Two behaviours a careful reader will notice are deliberate and documented rather than bugs:

- **The rate can change between a freelancer reading it and clocking in.** `setRate` only works while the clock is stopped, so no shift changes price midway, but a client could lower the rate in the moment before a clock-in. The tab page shows the current rate next to the Clock in button, read from the chain. A v2 `clockIn(id, expectedRate)` would make the check atomic.
- **A top-up resumes a shift that ran out of budget.** If a freelancer stays clocked in after the budget is spent, nothing accrues, and a later top-up pays from the moment it lands (never for the idle stretch: `test_topUpAfterExhaustionDoesNotPayForIdleTime`). The app clocks the freelancer out when a budget runs out while the page is open, and the demo bots do the same.

## Out of scope for the hackathon

- Disputes about the quality of work. Segundo pays for time on the clock; either side can stop at any second, so the most either can lose is the seconds since the last check.
- Proof that the freelancer was actually working while clocked in. The client watches the tab live and can pause pay at once.
- Real cash-outs. `/cashout` sends test AUSD to a demo partner wallet; no partner is signed and no real money moves.
- Mainnet deployment. Segundo runs on Monad testnet with test AUSD.

## Reporting

Open an issue on the repository or email rohanboradevit@gmail.com.
