# Verify Till

Everything here can be checked on Monad testnet (chain 10143) without trusting us.

## Deployed contracts

| Contract | Address | Source |
|---|---|---|
| Till (AUSD) | [`0xeb6c2c519c9bcc4495364c34ac116c20098113d1`](https://testnet.monadvision.com/address/0xeb6c2c519c9bcc4495364c34ac116c20098113d1) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/v2/verify/e3300355-e6e0-40ff-8435-6642865d38f9)) |
| ERC2771Forwarder (OpenZeppelin 5.4, unmodified) | [`0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1`](https://testnet.monadvision.com/address/0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/v2/verify/197e7720-567e-4e95-81d2-336d820b0aba)) |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadvision.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) | [Agora's deployments](https://docs.agora.finance/developer/contract-deployments) |
| Agora AUSD faucet | [`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`](https://testnet.monadvision.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) | Used to fund test accounts |

Deployment transactions: [forwarder](https://testnet.monadvision.com/tx/0x4ec106a8034299c0146d51b18ef56852c693ee1205eb16c93623fa3958625a15), [Till on AUSD](https://testnet.monadvision.com/tx/0x12ec03d3c85cfe1ae59fdb67c29d1b4b181af40584c189ac158b0643f30760d6). An earlier Till on Circle USDC (`0x4720B1FA15a8e3b8AEc7aA6B7b627dCacEaa1b4f`, retired, holds nothing) was replaced by the AUSD deployment on Oct 4.

## One tab, every action, on chain

`bots/proof.mjs` runs a whole tab with fresh wallets and no gas on either side: the client is funded from Agora's AUSD faucet, then every Till action is signed by the client or freelancer and submitted by the relayer through the forwarder. Tab № 6, client `0x828ac92115c7F12AF1C7A37265C600048dd24F53`, freelancer `0x2aAEABf549E313f2cF19d2928Ee95603C218AC0c`.

| # | Step | Transaction | Block | Submit to receipt |
|---|---|---|---|---|
| 1 | Fund a fresh client from Agora's AUSD faucet | [0xf199ad54…](https://testnet.monadvision.com/tx/0xf199ad5476cbf9143f06ce3a2efbb9a8096b8df1779aebcfde65a8cf1c4fce44) | 68,122,091 | 2.61 s |
| 2 | Client sets a profile (gasless) | [0xde698cb9…](https://testnet.monadvision.com/tx/0xde698cb9c1bfb3eb725f1ae3d88eef0c9c65da3b345c82e54b27a63bf4ab80a0) | 68,122,101 | 1.73 s |
| 3 | Freelancer sets a profile (gasless) | [0xbbdb7552…](https://testnet.monadvision.com/tx/0xbbdb75529a49842bacf782cfd819d0d8fa82b2e3d0b1e99825bb323c77838f0d) | 68,122,112 | 1.82 s |
| 4 | Open a tab by invite, $36/h, $1 budget (permit) | [0xa1177529…](https://testnet.monadvision.com/tx/0xa11775299c15c774caae591cce46d1c049e3e6b71c7a452dc748e25cc19fd2aa) | 68,122,120 | 1.63 s |
| 5 | Freelancer claims the invite | [0x2db24eb2…](https://testnet.monadvision.com/tx/0x2db24eb2f89e2354b7f0e3ab35bb9d4fcd5e3856ac5f883722f5c6ce682dfaec) | 68,122,129 | 1.62 s |
| 6 | Freelancer clocks in | [0x28335744…](https://testnet.monadvision.com/tx/0x28335744cf1f318c9010f5b08bda5eeec853d8b840fb073df011cf70c5515360) | 68,122,137 | 1.52 s |
| 7 | Payout 1 while working (anyone can settle) | [0x0d4fc161…](https://testnet.monadvision.com/tx/0x0d4fc16182a400c0f70cab1bdb12e421b7283824675dc9f296f3cced3c75c424) | 68,122,160 | 2.08 s |
| 8 | Payout 2 while working (anyone can settle) | [0xf566b074…](https://testnet.monadvision.com/tx/0xf566b0744d060a5dede75b5caa0cc5b8cd946424104472e728c26e3191d87cb0) | 68,122,186 | 2.51 s |
| 9 | Payout 3 while working (anyone can settle) | [0x4b0faa09…](https://testnet.monadvision.com/tx/0x4b0faa09d35913d8ff5aed2e23d1b81d67a66b838184557f8ae949d665542080) | 68,122,213 | 2.06 s |
| 10 | Client pauses pay (stops the clock) | [0x2a4f4202…](https://testnet.monadvision.com/tx/0x2a4f4202d8ee348e2775bdf8787c675fb12b6a31ada230f94f0382923b24bd50) | 68,122,220 | 1.32 s |
| 11 | Client tops up $0.50 (permit) | [0x1128f388…](https://testnet.monadvision.com/tx/0x1128f3880db9eae191624cbc941d1c772862cf03647ce4fb15795533b806617d) | 68,122,228 | 0.61 s |
| 12 | Client resumes pay | [0xa1a904aa…](https://testnet.monadvision.com/tx/0xa1a904aab9b64fb6b6b262540c61eaaa24217ede7cfe3198ff290b6a3bf7394d) | 68,122,234 | 1.03 s |
| 13 | Freelancer clocks in again | [0xd7dcf7dd…](https://testnet.monadvision.com/tx/0xd7dcf7dd70b1635ea37b46007d3ecad105738e8987109cac3d832848529741dc) | 68,122,240 | 2.03 s |
| 14 | Freelancer clocks out | [0x55780482…](https://testnet.monadvision.com/tx/0x55780482c874061f3ce4e4273fe14eaa621887d3e6e62c62d4d3dd3d2fdd591e) | 68,122,271 | 1.69 s |
| 15 | Final payout | [0x4247b4c8…](https://testnet.monadvision.com/tx/0x4247b4c8e7f1a335c37f1fecf7145db331a021bed2d8a5f5d03103144ebabd4f) | 68,122,277 | 1.32 s |
| 16 | Freelancer cashes out $0.3500 (EIP-3009) | [0xdd564d5d…](https://testnet.monadvision.com/tx/0xdd564d5d1aa5c4b7054d4e328e4866e4ade799e4fd9bfc38a0e5e7b5516ce6cd) | 68,122,283 | 1.34 s |
| 17 | Client closes the tab; unspent budget refunded | [0x0c1d2e6c…](https://testnet.monadvision.com/tx/0x0c1d2e6c8cbbb1415a83a296bd888c4fdfe3a0bf71ffdbc8db84dfe4d3a1f94e) | 68,122,289 | 1.35 s |

Result: the freelancer was paid **$0.350000** for the seconds on the clock and **$1.150000** of the $1.50 budget went back to the client; together exactly the $1.50 deposited. Times are from a laptop in India to Monad's public RPC, including polling for the receipt.

Run it yourself (needs a deployer with MON and a keeper in `keys/wallets.json`):

```bash
TILL=0xeb6c2c519c9bcc4495364c34ac116c20098113d1 FORWARDER=0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1 node bots/proof.mjs
```

## Tests

```bash
cd contracts
forge test                                                    # 53 tests: units, edges, adversary, a 1,000-run fuzz, stateful invariants (the fork rehearsal is skipped off-fork)
forge test --match-contract Fork --fork-url monad_testnet     # Agora AUSD (faucet, permit, transferWithAuthorization) on a Monad fork
```

| Claim | Test |
|---|---|
| Pay accrues per second only while clocked in | `test_paysBySecondAndRefundsTheRest`, `test_noPayWhileClockedOut` |
| Client can pause pay at any moment | `test_clientHoldStopsTheClock` |
| Pay never exceeds the budget; topping up doesn't pay for time past it | `test_budgetCapsPayAndTopUpRestartsTheShift` |
| Only the right people can act on a tab | `test_onlyTheRightPeopleTouchTheClock` |
| Invites can't be stolen from the mempool | `test_inviteClaimCannotBeStolen` |
| Unclaimed invites refund in full | `test_unclaimedInviteRefundsInFull` |
| Many tabs settle in one transaction | `test_settleManyPaysEveryTab` |
| Gasless open with permit through the forwarder | `test_gaslessOpenWithPermitAndClockIn` |
| History is walkable block to block | `test_activityChainLinksEveryBlock` |
| Paid + refunded always equals the budget | `testFuzz_moneyIsConserved`, `testFuzz_topUpAndSettleConserveMoney` |
| After any sequence of opens, clocks, holds, rate changes, top-ups, settles and closes: the contract holds exactly what open tabs still owe, freelancers hold exactly what was paid, and pay never goes down | `TillInvariantTest` (2 invariants, 128 runs × depth 100) |
| Settling a closed tab pays nothing; duplicate and unknown ids in `settleMany` are harmless | `test_settleAfterCloseReturnsZeroAndPaysNothing`, `test_settleManySkipsUnknownIdsAndPaysDuplicatesOnce` |
| Top-ups never pay for idle time and never change pay retroactively | `test_topUpMidShiftKeepsSince`, `test_topUpExactlyAtExhaustionRestartsShift`, `test_topUpAfterExhaustionDoesNotPayForIdleTime` |
| The maximum rate for the rest of time cannot overflow | `test_extremeRateNeverOverflows` |
| The forwarder rejects replays, expired requests and forged senders; a sender suffix is ignored outside the forwarder | `test_forwarderRejectsReplayExpiryAndForgedFrom`, `test_spoofedSenderSuffixIgnoredOutsideForwarder` |
| A front-run or garbage permit never blocks an open that already has an allowance | `test_frontRunPermitDoesNotBlockOpen`, `test_badPermitFallsBackToAllowance` |
| What an AUSD account freeze does to a tab (documented in SECURITY.md) | `test_frozenPayeeLocksRefundAndBreaksBatch`, `test_frozenPayerBlocksCloseButNotSettle` |
| A token or receiver that calls back into Till mid-transfer cannot re-enter `settle`, `settleMany` or `close`; with the hook gone the same close pays and refunds exactly once | `test_settleCannotReenterSettle`, `test_settleCannotReenterClose`, `test_closeCannotReenterSettleOrClose`, `test_settleManyCannotReenter` |
| An invite signature works on its own tab, contract and chain only, and once; a client cannot claim their own invite | `test_inviteSignatureIsBoundToTabContractAndChain`, `test_clientCannotClaimTheirOwnInvite` |
| A rate change never touches a running shift and only prices the next one | `test_rateChangeNeverTouchesARunningShift` |

The web app has an end-to-end test that drives the real UI on the deployed site: faucet, profile, open a tab to a demo freelancer, payouts while watching, pause, close and refund, then an invite joined from a second browser at phone width (`scripts/e2e.cjs`).

## Claim to code

| Claim on the site | Where |
|---|---|
| "Pay builds up every second" | `Till._earned`: `banked + (now - since) * rate / 3600`, capped at the budget |
| "Can only pay you or refund the client" | `Till._settle` pays `payee` only; `Till.close` refunds `payer` only; no owner or admin functions exist |
| "No gas, one signature" | `web/lib/relay.ts` (EIP-712 forward requests, EIP-2612 permit and EIP-3009 transfers on AUSD), `web/app/api/relay/route.ts` |
| "Payouts every few seconds while you watch" | `web/app/tab/[id]/page.tsx` calls `/api/settle` every 6 s for the first two minutes a page is open, then every 20 s, then once a minute; it also settles once when a clock stops |
| Live numbers on the landing page | `web/app/api/live/route.ts` reads every tab's state from the contract (no indexer) |
| Pay stub from chain | `web/lib/hooks.ts` `useHistory` walks `Activity(id, prevBlock)` one exact block at a time |
