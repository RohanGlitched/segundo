# Security

Segundo holds clients' budgets in a contract and pays freelancers by the second. The contract is deployed under Segundo's working name, **Till**, which is the name used for it below. This page lists who can move money, what each piece trusts, and how each attack we could think of is stopped. Every claim points at code or a test.

## Who can move money

| Money | Can only go to | Who can trigger it | Code |
|---|---|---|---|
| A tab's earned pay | The tab's freelancer (`payee`) | Anyone, through `settle` / `settleMany` | `Till._settle` |
| A tab's unspent budget | The client who opened it (`payer`) | The client or the freelancer, through `close` | `Till.close` |
| A new budget or top-up | Into the tab | Only the client's own signature (AUSD permit or approval) | `Till._open`, `Till._topUp` |
| Segundo's 1% fee on a budget or top-up | The treasury `0xAdF0…F62c`, at the amount the client signed | Only the client's own EIP-3009 transfer authorisation, submitted by the relayer | `signFee` in `web/lib/relay.ts`, `web/app/api/relay/route.ts` |

The contract has no owner, no admin key, no upgrade path and no fee switch. Nobody, including us, can redirect a budget. The fee lives outside the contract: it is a separate AUSD transfer the client signs, so it can never touch money already in a tab.

## Trust boundaries

- **Relayer (keeper key).** It pays gas and submits signed requests through OpenZeppelin's `ERC2771Forwarder`. It cannot forge a request: the forwarder checks the user's EIP-712 signature and nonce, and `Till` reads the caller from the forwarder only. The worst a relayer can do is refuse to submit, and users can then call `Till` directly from any wallet.
- **Forwarder.** OpenZeppelin v5.4 `ERC2771Forwarder`, unmodified. `Till` trusts exactly one forwarder, fixed at deployment.
- **AUSD.** Agora's AUSD on Monad testnet (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`), checked against docs.agora.finance. Permits and transfer authorisations are verified by AUSD itself (EIP-712 domain "Agora Dollar", version 1). AUSD is an upgradeable, pausable issuer token: if Agora pauses or upgrades it, Till's transfers stop or change with it, which is the trade-off of paying in a regulated dollar.
- **Exchange rates.** Shown for reading only (open.er-api.com, cached six hours). They never touch the contract or any amount that moves.
- **Accounts.** Three ways in, all signing EIP-712 messages only (nobody sends a transaction or holds gas): a **passkey account** made with Mera (the main one, see below), **email** through a Privy embedded wallet, and a **practice wallet**, a browser-only key in `localStorage` for trying the app with test AUSD.
- **Envio HyperRPC.** Read only. It feeds `/api/stats`, `/api/history` and income statements; it never decides what moves. A wrong answer would show wrong history, and every line links to its transaction so a reader can check it. The API token is server-only and sits in the request URL, which is never logged or put in an error (`web/lib/envio.ts`). Without it, or when HyperRPC fails, the routes fall back to the public RPC and say `source: "rpc"`.
- **Treasury.** A plain account whose key is kept out of the repository. It only receives fees; nothing in the app or the contract depends on it.

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
| Relayer drained by spam | The relayer only pays for `Till` calls, verifies the signature, estimates the inner call and refuses requests asking for more than 1.5× that estimate (Monad charges the limit), refuses tabs and top-ups under $0.50, rejects a second copy of a request already in flight (keyed by its signature), and paces per signer, per IP address and overall. When its MON runs low it keeps gas for the actions that return money: watch-payouts pause below 0.4 MON, new tabs, top-ups, sends and profiles below 0.15, clock-ins below 0.05, and clock-outs, holds, closes and invite claims run down to 0.02, about one transaction (`RESERVE` in `web/lib/server.ts`; `/api/health` shows the state, the app shows a notice bar and the open form says so before anyone signs; with `AUTO_REFUEL=1` a health check moves 3 test MON from the faucet wallet to the relayer when it falls under the top tier) | `web/app/api/relay/route.ts` |
| Relayer drained through payouts | `/api/settle` pays at most once per 6 blocks per tab (a throttle every server instance agrees on), skips amounts under half a cent, paces per IP and overall, and stops watch-payouts when the relayer's MON falls below a reserve so clock-ins and closes keep working; the tab page itself slows from every 6 s to every 20 s to once a minute | `web/app/api/settle/route.ts`, `web/app/tab/[id]/page.tsx` |
| Relayer drained through AUSD transfers | `/api/send` relays transfers of at least $0.01 between two different addresses, never into the Till, forwarder or AUSD contracts (where it could not come back out), one copy of each authorisation at a time, paced per sender, per IP and overall | `web/app/api/send/route.ts` |
| Faucet drained | One drip per address per hour, six per IP address per hour, 120 an hour per server instance, refused when the wallet already holds 10 AUSD | `web/app/api/faucet/route.ts` |
| Two relayer instances race on a nonce | Sends from one key are serialised within an instance and retried with a fresh nonce across instances; a reverted duplicate costs its gas limit and nothing else | `web/lib/server.ts` |
| Logged invite keys | The invite key travels after `#` in the link, so it never reaches a server log; the install QR code carries the path only, never the `#` part | `web/lib/invite.ts`, `web/components/InstallApp.tsx` |
| Relayer charges a different fee, or sends it somewhere else | The client signs the exact amount and the treasury as recipient; AUSD checks the signature, so neither can be changed. The relayer also refuses a fee whose `from` isn't the request's signer, whose `to` isn't the treasury, or whose amount is under 1% | `web/app/api/relay/route.ts`, `web/lib/authorization.ts` |
| Fee taken for a tab that never opened | The fee is sent only after the forwarded open or top-up has landed; if that call fails, the fee authorisation is never submitted and expires after 30 minutes | `web/app/api/relay/route.ts` |
| Fee replayed or charged twice | Each authorisation carries a random 32-byte nonce that AUSD accepts once; the relayer also refuses a second copy while the first is in flight | AUSD (EIP-3009), `inFlight` in `web/app/api/relay/route.ts` |

## Monad specifics

- **Gas limit is charged, not gas used.** Every transaction the relayer, faucet and bots send uses the chain's own estimate plus 15%. A forwarded request carries the gas the signer asked for (the app asks for the estimate plus 25%), and the relayer refuses anything above 1.5× its own estimate. Nothing uses a blanket limit.
- **Parallel execution.** Pay accrues from timestamps and settles per tab. Till's own shared state is one counter, `tabCount`, written when a tab opens. Every payout also writes the escrow balance slot inside AUSD, which is shared by all tabs; Monad's optimistic execution re-runs the later of two payouts that land in one block, so correctness never depends on ordering.
- **Log queries are capped at 100 blocks on public RPCs.** Each tab stores the block of its last change, and every change emits `Activity(id, prevBlock)`, so a tab's pay stub is read one exact block at a time with no indexer. Long views (statements, revenue) come from Envio HyperRPC, read only.

## The fee path

Clients pay 1% on top of every budget and top-up (`feeFor` in `web/lib/money.ts`: amount ÷ 100, rounded up to the next AUSD unit). In order:

1. **Signed with the open.** The browser signs the forward request, the AUSD permit and an EIP-3009 `transferWithAuthorization` of the fee to the treasury in one step (`signFee` in `web/lib/relay.ts`, valid for 30 minutes). Passkey, email and practice wallets sign silently, so there is no extra prompt.
2. **Checked and simulated before anything moves.** The relayer refuses a missing fee, a fee from anyone but the signer, to anyone but the treasury, under 1%, or with under two minutes left to run. It checks the wallet holds the budget plus the fee, then runs the fee transfer as the keeper will send it (`estimateGas`), so a bad, spent or underfunded authorisation is refused before the tab is opened.
3. **Collected after the open lands.** Only once the forwarded open or top-up has its receipt does the relayer send the fee, as its own transaction.
4. **A failed fee is logged, not retried.** If the fee transfer fails after the tab opened (for example, the client moved the AUSD in between), the tab stands, the client is told nothing more is needed, and the server logs `FEE NOT COLLECTED` with the tab's transaction. The worst case is a lost 1%, never a stuck tab or a double charge.
5. **The fee is not refunded with unspent budget.** Closing a tab returns every unspent cent of the budget; the fee was a separate transfer and stays with the treasury. The open form shows the fee before anyone signs.

The demo studios pay the fee the same way (`bots/till-bots.mjs`). The fee transfers are listed in [VERIFY.md](VERIFY.md#the-1-fee-on-chain).

## Passkey accounts (Mera)

`web/lib/mera.ts`, `web/lib/wallet.tsx`.

- **Where the key comes from.** The passkey's WebAuthn PRF output (32 bytes the authenticator computes from a secret it never releases, the site and a salt) becomes BIP-39 entropy, then the key at `m/44'/60'/0'/0/0`. Same passkey, same site: same account, on any device the passkey syncs to. The intermediate bytes (PRF output, seed, derived key) are zeroed as soon as Mera's signing session holds its copy.
- **What is stored.** `localStorage` holds the credential id, its transports and the public address. No key material is written anywhere, and no server sees any of it.
- **While unlocked.** The key lives only in page memory, inside Mera's signing session, which zeroes it when it ends. It ends on sign-out, after 15 minutes without a tap or key press, after 5 minutes with the page in the background, and when the page is closed; the next signature asks for the passkey again. Anything running in the page while it is unlocked can ask it to sign, as with any browser wallet; these limits keep that window short.
- **Bound to the site.** A passkey belongs to the domain it was made on, so an account made on till-pay.vercel.app and one made on segundo.world are different accounts. Passkeys only work on https (or localhost).
- **Without PRF.** If an authenticator can't do PRF, no account is made and the person is pointed to email sign-in.

## Sealed private details

`web/lib/seal.ts`, `web/components/SealedDetails.tsx`. A freelancer's legal name, postal address, tax ID and payout account, for their own invoices and income statements.

- **Key.** A second PRF evaluation with its own salt, `sha256("segundo/seal/v1")`, then HKDF-SHA-256 (info `segundo/seal/v1/aes-256-gcm`) into a non-extractable AES-256-GCM key. A different salt gives an unrelated output, so the sealing key shares nothing with the wallet key: holding one says nothing about the other. Unsealing is its own passkey prompt.
- **Storage.** Only ciphertext is kept, in this browser's `localStorage`. The optional backup file is the same ciphertext. Our servers never receive the details, sealed or open.
- **Integrity.** Each seal uses a fresh 12-byte nonce, and the account address is bound in as additional data, so a sealed file can't be passed off as another account's; the app also refuses an envelope whose account isn't the one signed in.
- **While open.** The sealing key is kept until the session locks (same limits as above); on lock, the key is dropped and anything showing the details clears itself. Unsealed details printed on an income statement appear on the owner's device only.
- **Lose the passkey and the details are gone.** There is no recovery copy and no escrow, by design: nobody, including us, can open them. Clearing site data removes the local copy; the backup file opens again with the same passkey.
- **Not hidden.** The envelope shows which account and passkey it belongs to, when it was sealed and roughly how long the contents are. Only passkey accounts can seal; email and practice wallets have no passkey to unlock with.

## Installable app

`web/public/sw.js`, `web/app/manifest.ts`, `web/components/InstallApp.tsx`.

- The service worker **never caches or touches `/api/*`**, ignores anything that isn't a same-origin `GET`, and so never sees a signature or a relayed request.
- Pages are network first, so money on screen is always live; the last good copy of a page (never one with a query string) is shown only when the network is gone, and the offline page says nothing was sent. Built assets are cached by their hashed names. Old caches are deleted when the worker's version changes.
- It registers in production builds only.

## What the audit found and how it is handled

A second review on Oct 4 added 34 tests (`contracts/test/TillEdges.t.sol`: 32 edge cases and a stateful invariant suite), and a third on Oct 11 added 7 adversarial tests (`contracts/test/TillAdversary.t.sol`: reentrancy from inside a transfer, invite replay across tabs, deployments and chains, rate changes against a running shift) and the relayer's reserve tiers, health endpoint and notice bar. Nothing on chain needed changing. On Oct 13 the fee, passkey accounts, sealed details, Envio-backed history and the installable app were added, all off chain, with the guarantees above. Three things are worth knowing about the contract:

- **Issuer controls on AUSD.** AUSD can freeze accounts. A frozen freelancer blocks `close` on their tab, so the client's refund waits until the freeze lifts (the client can still pause pay); a frozen freelancer also makes a whole `settleMany` batch revert, so the keeper falls back to settling tabs one at a time. A frozen client blocks `close`, but `settle` still pays the freelancer. `test_frozenPayeeLocksRefundAndBreaksBatch`, `test_frozenPayerBlocksCloseButNotSettle`.
- **Unsolicited tabs.** Anyone can open a tab to any address and `tabsOf` has no limit. The app and the bots read the whole id list (one call) and then the tabs in batches of 80, and the demo freelancers only clock in on tabs of at least $0.50, one per freelancer every few seconds. Thousands of dust tabs sent to one address would slow its pages down; a paged `tabsOf` and a payee-side accept step are on the v2 list. `test_dustTabsBloatPayeeTabList`.
- **Rounding.** Pay rounds down once per shift, losing under a millionth of a dollar each time; settling often loses nothing because pay is recomputed from the start of the shift. `test_roundingLossIsUnderOneUnitPerShift`, `test_frequentSettlesLoseNothingToRounding`.

The stateful suite (`TillInvariantTest`) drives random opens, clock-ins and outs, holds, rate changes, top-ups, settles, batch settles, closes and time jumps, and checks after every action that the contract holds exactly what open tabs still owe, that freelancers hold exactly what was paid, that `paid ≤ earned ≤ budget`, and that pay never goes down.

**The relayer is best-effort testnet infrastructure.** Its limits are per server instance and signing costs nothing, so a determined spammer can still burn the keeper's MON. The worst case is that the gasless path pauses, in the order above; the contract is unaffected and anyone can call it directly from a funded wallet. What it costs: at 100 gwei a payout is about 0.01 MON, so a judge watching a tab for an hour spends about 0.3 MON of the keeper's gas, and a relayed open about 0.045 MON. `GET /api/health` reports the relayer's and faucet's balances, and `node bots/topup.mjs keeper=10` moves test MON between the project's wallets.

Two behaviours a careful reader will notice are deliberate and documented rather than bugs:

- **The rate can change between a freelancer reading it and clocking in.** `setRate` only works while the clock is stopped, so no shift changes price midway, but a client could lower the rate in the moment before a clock-in. The tab page shows the current rate next to the Clock in button, read from the chain. A v2 `clockIn(id, expectedRate)` would make the check atomic.
- **A top-up resumes a shift that ran out of budget.** If a freelancer stays clocked in after the budget is spent, nothing accrues, and a later top-up pays from the moment it lands (never for the idle stretch: `test_topUpAfterExhaustionDoesNotPayForIdleTime`). The app clocks the freelancer out when a budget runs out while the page is open, and the demo bots do the same.

## Out of scope for the hackathon

- Disputes about the quality of work. Segundo pays for time on the clock; either side can stop at any second, so the most either can lose is the seconds since the last check.
- Proof that the freelancer was actually working while clocked in. The client watches the tab live and can pause pay at once.
- Mainnet deployment. Segundo runs on Monad testnet with test AUSD.

## Reporting

Open an issue on the repository or email rohanboradevit@gmail.com.
