# Verify Segundo

Everything here can be checked on Monad testnet (chain 10143) without trusting us. The contract is deployed under Segundo's working name, **Till**, so that is the name you will see on MonadVision and Sourcify (and in the forwarder's EIP-712 domain).

## Deployed contracts

| Contract | Address | Source |
|---|---|---|
| Till (AUSD) | [`0xeb6c2c519c9bcc4495364c34ac116c20098113d1`](https://testnet.monadvision.com/address/0xeb6c2c519c9bcc4495364c34ac116c20098113d1) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/v2/verify/e3300355-e6e0-40ff-8435-6642865d38f9)) |
| ERC2771Forwarder (OpenZeppelin 5.4, unmodified) | [`0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1`](https://testnet.monadvision.com/address/0xB0Af71Dfb11df900B2B1a63De0D156e7f035B4D1) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/v2/verify/197e7720-567e-4e95-81d2-336d820b0aba)) |
| AUSD (Agora) | [`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`](https://testnet.monadvision.com/address/0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC) | [Agora's deployments](https://docs.agora.finance/developer/contract-deployments) |
| SegundoKeeper (Chainlink CRE receiver) | [`0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D`](https://testnet.monadvision.com/address/0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D) | Verified on Sourcify, exact match ([job](https://sourcify-api-monad.blockvision.org/verify-ui/jobs/430e8de2-2f2a-4cbe-97fc-83604b0676a7)); source in `cre/contracts` |
| Segundo treasury | [`0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c`](https://testnet.monadvision.com/address/0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c) | A plain account; receives the 1% client fee and signs its refunds |
| Segundo relayer (key 0) | [`0xe77f8062f66767428b1786709E079cABd01ABF40`](https://testnet.monadvision.com/address/0xe77f8062f66767428b1786709E079cABd01ABF40) | Sends every gasless action, the fee and refunds |
| Demo payout partner (cash-out) | [`0x092178787c772cbF67c2560B38D9F4f3454677e6`](https://testnet.monadvision.com/address/0x092178787c772cbF67c2560B38D9F4f3454677e6) | A plain wallet standing in for a licensed partner on testnet |
| Agora AUSD faucet | [`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`](https://testnet.monadvision.com/address/0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C) | Used to fund test accounts |

Deployment transactions: [forwarder](https://testnet.monadvision.com/tx/0x4ec106a8034299c0146d51b18ef56852c693ee1205eb16c93623fa3958625a15), [Till on AUSD](https://testnet.monadvision.com/tx/0x12ec03d3c85cfe1ae59fdb67c29d1b4b181af40584c189ac158b0643f30760d6). An earlier Till on Circle USDC (`0x4720B1FA15a8e3b8AEc7aA6B7b627dCacEaa1b4f`, retired, holds nothing) was replaced by the AUSD deployment on Oct 4.

## One tab, every action, on chain

`bots/proof.mjs` runs a whole tab with fresh wallets and no gas on either side: the client is funded from Agora's AUSD faucet, then every contract action is signed by the client or freelancer and submitted by the relayer through the forwarder. Tab № 6, client `0x828ac92115c7F12AF1C7A37265C600048dd24F53`, freelancer `0x2aAEABf549E313f2cF19d2928Ee95603C218AC0c`.

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

## The 1% fee on chain

Clients pay Segundo 1% on top of every budget and top-up; freelancers pay nothing. The fee is not part of the contract: it is an AUSD `transferWithAuthorization` (EIP-3009) from the client to the treasury, signed in the same step as the open or top-up. Fee = amount ÷ 100, rounded up to the next AUSD unit (6 decimals). The order, in `web/app/api/relay/route.ts`:

1. **Checked.** The relayer refuses a fee from anyone but the signer, to anyone but the treasury, under 1%, or with under two minutes to run; checks the wallet holds the budget plus the fee; and simulates both the fee transfer and the open.
2. **Fee first.** The relayer sends the fee and waits for it to land.
3. **Then the open or top-up**, simulated again now that the fee has moved, then sent through the forwarder.
4. **If that fails, the whole fee goes back** from the treasury straight away.
5. **At close, 1% of the unspent budget goes back**: `floor(refunded ÷ 100)`, never more than the fees that tab actually paid (`refundClosedTab` in `web/lib/refund.ts`).

Every refund is an EIP-3009 transfer **signed by the treasury and submitted by the relayer**, so the treasury never needs MON. Its nonce is derived from what is being refunded, so AUSD itself refuses a second refund of the same thing, from any server instance:

```
close refund:  nonce = keccak256("segundo:fee-refund:tab" ‖ pad32(Till) ‖ pad32(tab id))
failed open:   nonce = keccak256("segundo:fee-refund:fee" ‖ the client's fee-authorisation nonce)
```

### One tab through the whole cycle

Tab № 124, client `0xA4980bae43FC09C0ee7B764121E63cCA93b01065`, demo freelancer Tunde Bakare (`0x929835102eb2e16F5678C8c3B4830C369D1d4bE0`), $1.00 an hour, $2.00 budget, memo "Fee refund check". Every transaction was sent by the relayer `0xe77f…ABF40`; the client never held MON.

| # | Step | Transaction | Block | UTC | What moved |
|---|---|---|---|---|---|
| 1 | Fee, first | [0xd7ccc65e…](https://testnet.monadvision.com/tx/0xd7ccc65eb21b9445d31736e1fb1af962868db197c9b36e1d8125f2f65162a3dd) | 70,683,058 | 12:34:43 | 20,000 units client → treasury (1% of 2,000,000) |
| 2 | Open, 27 blocks later | [0x59737997…](https://testnet.monadvision.com/tx/0x59737997b5d745133c42114cc337348aa5aa9fd00dfbfeb4dd9b1e5dd5846956) | 70,683,085 | 12:34:51 | `Opened(id = 124, budget = 2,000,000)`; 2,000,000 units client → Till |
| 3 | Close | [0xc864b77e…](https://testnet.monadvision.com/tx/0xc864b77edbb87b2ebd9cad2acdbc05ae9c59ff4685f90a6cfa7135ac4841d984) | 70,686,400 | 12:51:43 | Last 171,389 units to the freelancer; `Closed(paid = 280,000, refunded = 1,720,000)` |
| 4 | Fee refund | [0xe431e833…](https://testnet.monadvision.com/tx/0xe431e833aef54acc52eb5b117b65b08d6b0dd95d1bce35128a3bb21a5449bb5b) | 70,686,435 | 12:51:54 | 17,200 units treasury → client = floor(1,720,000 ÷ 100) |

Net: the client paid 20,000 − 17,200 = **2,800 units, exactly 1% of the 280,000 the freelancer earned**. The refund's `AuthorizationUsed` nonce is `0xee5931b8…3836`, the close-refund nonce for tab 124 above; `authorizationState(treasury, that nonce)` on AUSD returns `true`, so no second refund for tab 124 can go through.

### A failed open: the whole fee back

| Step | Transaction | Block | UTC | What moved |
|---|---|---|---|---|
| Fee for a $0.50 open | [0x61e72472…](https://testnet.monadvision.com/tx/0x61e724722028b29661b305c24a5f977118b3ab91571b0b91fbd682ea24b5464c) | 70,686,938 | 12:54:28 | 5,000 units client → treasury |
| The open, made to fail after the fee landed | none | | | No Till event in blocks 70,686,930 to 70,686,990 |
| Whole fee refunded | [0x1070c7ef…](https://testnet.monadvision.com/tx/0x1070c7ef593272edb33af3e63dfcabbd93f1553fab96ae94d4cd3ac209e889c8) | 70,686,951 | 12:54:32 | 5,000 units treasury → client |

The refund's nonce, `0x55f7c2e7…5b7c`, is `keccak256("segundo:fee-refund:fee" ‖ 0x97c0b9c7…1b0f)`, built from the nonce of the client's own fee authorisation in the first transaction.

### Find every fee and refund yourself

Every fee is an AUSD `Transfer` log whose recipient (topic 2) is the treasury; every refund is one whose sender (topic 1) is the treasury. Envio HyperRPC answers a log query over the whole range in one call (Monad's public RPC caps `eth_getLogs` at 100 blocks):

```bash
# Fees in. For refunds out, put the treasury topic in the sender position (topic 1) and null in topic 2.
curl -s https://monad-testnet.rpc.hypersync.xyz/$ENVIO_API_TOKEN -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
    "address":"0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
    "topics":["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              null,
              "0x000000000000000000000000adf0f9443eafd19916cbd8f7541ea5e19e69f62c"],
    "fromBlock":"0x4300000","toBlock":"latest"}]}'
```

(`0x4300000` is block 70,254,592, before the fee went live. If a range is too heavy, split it. Without a token, the same filter works on `https://testnet-rpc.monad.xyz` 100 blocks at a time, or open the [treasury's token transfers on MonadVision](https://testnet.monadvision.com/address/0xAdF0F9443EafD19916cBd8f7541ea5e19e69F62c).)

The first fees, from before the fee moved ahead of the open (the relayer then sent it right after the open). Both are from passkey end-to-end runs (`scripts/e2e-mera.cjs`), each with a fresh Mera account:

| # | Fee transaction | Block | From (client) | Fee | Matching open | Block | Tab |
|---|---|---|---|---|---|---|---|
| 1 | [0xe1b850e8…](https://testnet.monadvision.com/tx/0xe1b850e8d7c93a155af39ee6e7173b77e42fdd2709cb823d047c936cb2888e31) | 70,674,757 | `0xca158574f9f167A186C0fe66591081a7072582f3` | 0.020000 AUSD | [0x1a67bc4a…](https://testnet.monadvision.com/tx/0x1a67bc4ac068cd905a287e028bb1d8798212ce6bc86ec609ae78278b6d206ba6) | 70,674,749 | № 20, $2.00 budget |
| 2 | [0xf3fd946b…](https://testnet.monadvision.com/tx/0xf3fd946bbf466db65971adf340a606937ff5243e22bdea3cb8e41e66b0338d3a) | 70,676,847 | `0xAD7F23EC8C2c6c86e84ED063C525542EA6749d93` | 0.020000 AUSD | [0x7c0468f2…](https://testnet.monadvision.com/tx/0x7c0468f29b0bad2836e3ddafaadc30eae937c10d3ed664ad4f4e49d94a29e0ef) | 70,676,844 | № 21, $2.00 budget |

To pair a fee with its tab yourself: find an `Opened` or `ToppedUp` event from the same client within 600 blocks of the fee, either side, whose amount ÷ 100, rounded up, equals the fee, and take the nearest. That is the rule the site uses (`feeTabs` in `web/lib/envio.ts`); a transfer into the treasury that pairs with nothing is not counted as a fee. The demo studios run their own keys and pay the fee right after their open (`bots/till-bots.mjs`). Live totals, net of refunds, are on [the business page](https://segundo.world/business#live) and at `GET /api/stats`.

What the fee path guarantees, and what it doesn't, is in [SECURITY.md](SECURITY.md#the-fee-path).

## Sending, cashing out and requesting

Sends and cash-outs are AUSD transfer authorisations (EIP-3009) the relayer submits through `/api/send`, so nobody needs MON.

- **Send by link.** `web/lib/sendlink.ts`, `web/app/claim/page.tsx`. The sender's browser makes a fresh key, sends the AUSD to its address, and puts the key after the `#` of `/claim#k=…`. Collecting is that key signing its whole balance to the receiver (`sweepFromKey` in `web/lib/relay.ts`); taking it back is the same transfer to the sender. On MonadVision a used link's address shows one transfer in and one out. `scripts/e2e-sendlink.cjs` runs it with two passkey accounts and checks the receiver ends with exactly $1.00.
- **Send to an email.** `web/app/api/recipient/route.ts` asks Privy for that email's wallet, creating the user with a pregenerated Ethereum wallet if needed (`web/lib/privy-server.ts`); the transfer goes to that address.
- **Cash out (simulated on testnet).** A $1.00 cash-out: [0xb983cf55…](https://testnet.monadvision.com/tx/0xb983cf55afa085dec092a40238b6ac197934e476d7ea03f6644602ca0aafa351), block 70,688,912, 1,000,000 units from `0xA498…1065` to the demo partner wallet `0x0921…77e6`. No real money moves and no partner is signed.
- **Request a tab.** `web/lib/request.ts`: a link to `/open?to=…&rate=…&budget=…&memo=…&from=…`. Nothing is signed to make it; the open page checks every field, strips hidden characters from the name and note, and shows the address in groups of four.

## Chainlink CRE on chain

`cre workflow simulate --broadcast` (CRE CLI v1.38.0) ran the workflow against Monad testnet on Oct 13 2026: [0x17d86a59…](https://testnet.monadvision.com/tx/0x17d86a590a0ed22bc60d941db6d0b0e462a449a6f7fe48a43704d97ebe975d03), block 70,688,328, status success. Keeper wallet → CRE MockKeystoneForwarder `0xB9F7…D192` → `SegundoKeeper.onReport`: `RatesPosted` with six rates, then `Till.settleMany` paid tabs 4, 5 and 2 a total of **4.238888 AUSD** (`Kept`), and the forwarder's `ReportProcessed` result is `true`. Full log and decoded events: [cre/SIMULATION.md](cre/SIMULATION.md). Read the rates back:

```bash
cast call 0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D "allRates()(bytes3[],uint64[],uint64[])" --rpc-url https://testnet-rpc.monad.xyz
```

Since then an always-on server runs the same simulation with `--broadcast` every 2 hours (`scripts/cre-loop.sh`), signed by the loop's own key `0x022875424E1556FEC66Fdc5A7D52820dea4dBb8D`. The workflow isn't deployed to a live DON. The mock forwarder relays a report from anyone, so the stored `allRates` can be written by anyone on testnet. The app uses a `RatesPosted` report only when its transaction's `from` is that key (or the keeper key `0xe77f…BF40`, which signed the first runs) and its time is at most 5 minutes past its block (`web/lib/cre.ts`). To check a report yourself:

```bash
cast tx <report tx hash> from --rpc-url https://testnet-rpc.monad.xyz   # expect 0x0228…Bb8D
```

## Monad under load

On Oct 13 2026, 96 fresh tabs (ids 26 to 121) were settled every second for five seconds from 16 sender keys: 480 transactions, all landed (461 succeeded; 19 ran out of a deliberately tight shared gas limit) in 4.67 s, 102.8 a second, up to 96 in one block (70,681,941 and 70,681,944), send to block median 0.92 s and 90th percentile 1.56 s. A single key sending 48 consecutive nonces at once landed all 48 in block 70,681,999; one key sending one at a time and waiting for each receipt managed 1.1 a second. Average block time over the 10,000 blocks to 70,682,181: 0.305 s.

Samples: [first of the burst](https://testnet.monadvision.com/tx/0x17b4822eb39ab9a457c108fd6c10c36a9ee879c84437bdd01fc85639237984a2) · [one of 96 in one block](https://testnet.monadvision.com/tx/0x71ac4e4b0c8667b90a16c2de1d81eef4dcd1fb344267d5881ee486e6836836cb) · [one of 48 from one key](https://testnet.monadvision.com/tx/0xcfa891a7eb63113bfe96faaf7ce3a6466ade71c19f567a5622cc1378b0ddfdb6) · [a revert](https://testnet.monadvision.com/tx/0x56e0d8d1ce716521d4cbf1e42bb0c5ec52034131224f26e2a91cad7a4ee96f8d). Method and what it does not show: [scripts/bench/README.md](scripts/bench/README.md); every number: [web/public/bench.json](web/public/bench.json) and [/network](https://segundo.world/network).

## Tests

```bash
cd contracts
forge test                                                    # 52 tests pass: units, edges, adversary, a 1,000-run fuzz, stateful invariants (+1 fork rehearsal, skipped off-fork)
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

The Chainlink CRE receiver, workflow and indexer have their own suites:

```bash
cd cre/contracts && forge test                                                        # SegundoKeeper: 9 tests (the 2 fork tests skip off-fork)
forge test --mt test_fork --fork-url https://testnet-rpc.monad.xyz                    # 2 fork tests against the live Till
cd cre/segundo-keeper && bun test                                                     # workflow: 6 tests with the CRE SDK's test runtime
cd indexer && pnpm test                                                               # HyperIndex handlers: 5 tests
```

| Claim | Test |
|---|---|
| Only an allowed forwarder can deliver a report; only the owner can change the allowlist | `test_rejectsNonForwarder`, `test_onlyOwnerAdmin` |
| A report settles the listed tabs and posts the rates; a stale report's rates are ignored but it still settles | `test_settlesAndEmitsRates`, `test_staleRatesIgnoredButStillSettles` |
| One tab that can't be paid doesn't block the rest | `test_oneBadTabDoesNotBlockTheRest` |
| Malformed reports are refused; with a workflow id set, other workflows are refused | `test_rejectsMalformedReport`, `test_workflowIdCheck` |
| Works against the live Till and the CRE mock forwarder | `test_fork_settlesLiveTabs`, `test_fork_mockForwarderDelivers` |
| The workflow parses each rate source, takes medians, picks owing tabs largest first, scans in chunks, and builds one report | `cre/segundo-keeper/workflow.test.ts` |

The web app has four end-to-end tests that drive the real UI with Playwright; the passkey ones use a Chrome virtual authenticator with PRF in place of a fingerprint:

- `scripts/e2e.cjs` (practice wallet): faucet, profile, open a tab to a demo freelancer, payouts while watching, pause, close and refund, then an invite joined from a second browser at phone width.
- `scripts/e2e-mera.cjs` (passkey): creates a Mera account, waits for test AUSD, opens a tab with the 1% fee, watches a payout land, closes the tab (the unspent budget and 1% of it come back), then seals private details. Fees № 1 and № 2 above are from this script.
- `scripts/e2e-sendlink.cjs` (two passkey accounts): A sends $1 by one link and $0.50 by another; B opens the first at phone width, makes a passkey account and collects it, and must hold exactly $1.00; A takes the second link back, and both used links say so.
- `scripts/e2e-keys.cjs` (one passkey, many keys): a client opens a tab by invite, clears the browser, signs back in and rebuilds the invite link, which must match exactly; a freelancer joins with it from another browser; then a verifier asks for sealed details on the income statement and the client discloses two fields, which the verifier's page opens and checks.

```bash
node scripts/e2e.cjs <baseUrl>
node scripts/e2e-mera.cjs <baseUrl>
node scripts/e2e-sendlink.cjs <baseUrl>
node scripts/e2e-keys.cjs <baseUrl>
```

## Claim to code

| Claim on the site | Where |
|---|---|
| "Pay builds up every second" | `Till._earned`: `banked + (now - since) * rate / 3600`, capped at the budget |
| "Can only pay you or refund the client" | `Till._settle` pays `payee` only; `Till.close` refunds `payer` only; no owner or admin functions exist |
| "No gas, one signature" | `web/lib/relay.ts` (EIP-712 forward requests, EIP-2612 permit and EIP-3009 transfers on AUSD), `web/app/api/relay/route.ts` |
| "Clients pay 1% on top; freelancers pay nothing" | `feeFor` in `web/lib/money.ts`; `signFee` in `web/lib/relay.ts`; the relayer checks and simulates the fee, sends it first, then the open (`web/app/api/relay/route.ts`); the demo studios pay it right after their open (`bots/till-bots.mjs`) |
| "If the tab can't be opened, the fee comes straight back" | `refundFee` in `web/app/api/relay/route.ts`, `fromTreasury` and `feeRefundNonce` in `web/lib/refund.ts` |
| "1% of what you don't spend comes back at close" | `refundClosedTab` in `web/lib/refund.ts`: floor(refunded ÷ 100), capped at the fees the tab paid; nonce `tabRefundNonce(id)`; a missed refund can be retried with `POST /api/relay {"refund": "<tab id>"}` |
| "Send by link; they need nothing but the link" | `web/lib/sendlink.ts` (`newLinkKey`, `claimLink`, `readFragment`), `sweepFromKey` in `web/lib/relay.ts`, `web/app/claim/page.tsx` |
| "Send to an email address" | `web/app/api/recipient/route.ts`, `recipientWallet` in `web/lib/privy-server.ts` |
| "Cash out to local money" (simulated on testnet) | `web/app/cashout/page.tsx`, `web/app/cashout/corridors.ts` (`DEMO_PARTNER`, corridors and sources) |
| "Request a tab" | `web/lib/request.ts` (`requestLink`, `parseRequest`), `web/app/request/page.tsx`, the request banner in `web/app/open/page.tsx` |
| "One passkey, four keys" | `SALT_LABELS` in `web/lib/keys.ts`; `familyPrfOutputs` in `web/lib/mera.ts` |
| "Invite links rebuilt from your passkey and the chain" | `nextInviteKey`, `rebuildInviteKey` in `web/lib/keys.ts`; `web/components/RebuildInvite.tsx` |
| "Show a verifier only the details you pick" | `web/lib/disclose.ts` (token format in its header), `web/components/Disclosure.tsx`, `/proof/<address>?request=1` |
| "Passkeys work only on Segundo's own address" | `relyingParty` in `web/lib/mera.ts` (`NEXT_PUBLIC_RP_ID`, default `segundo.world`) |
| "Payouts and rates from a Chainlink CRE workflow" (run with `cre workflow simulate --broadcast` every 2 hours; not on a live DON) | `cre/segundo-keeper/workflow.ts`, `cre/contracts/src/SegundoKeeper.sol`, `scripts/cre-loop.sh`, the trust filter in `web/lib/cre.ts`, [cre/SIMULATION.md](cre/SIMULATION.md) |
| "Monad, measured" | `scripts/bench/*.mjs`, `web/public/bench.json`, `web/app/network/page.tsx` |
| "A pool of relayer keys" | `web/lib/pool.ts` (`pool`, `laneOf`, `richest`), `relayerFor` and `sendAndWait` in `web/lib/server.ts` |
| "Your passkey is your account" | `web/lib/mera.ts`: PRF output → BIP-39 entropy → key at `m/44'/60'/0'/0/0` → Mera signing session; `web/lib/wallet.tsx` locks it after 15 min idle or 5 min in the background |
| "Sealed with your passkey; our servers never see them" | `web/lib/seal.ts`: PRF with salt `sha256("segundo/seal/v1")` → HKDF-SHA-256 → AES-256-GCM; account, passkey, format version and seal time as additional data (version 2); stored in this browser only |
| "Revenue, live from the chain" and income statements | `web/lib/envio.ts` reads every Till event, every fee into the treasury and every refund out of it through Envio HyperRPC; `web/app/api/stats`, `web/app/api/history`, `web/app/proof/[address]` |
| "Payouts every few seconds while you watch" | `web/app/tab/[id]/page.tsx` calls `/api/settle` every 6 s for the first two minutes a page is open, then every 20 s, then once a minute; it also settles once when a clock stops |
| Live numbers on the landing page | `web/app/api/live/route.ts` reads every tab's state from the contract |
| Pay stub from chain | `web/lib/hooks.ts` `useHistory` walks `Activity(id, prevBlock)` one exact block at a time |

## Agora Instant Settlement

Agora's bounty asks teams to mock any real movement of funds with its Instant Settlement contract on Monad testnet. On testnet, the cash-out's local-currency payout is mocked that way. After a freelancer's cash-out lands at the demo partner wallet `0x0921…77e6`, the partner swaps that AUSD for Agora's test token CTK. The swap goes through Agora's AUSD/CTK Instant Settlement pair [`0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae`](https://testnet.monadvision.com/address/0x1Aa8958Aa34cEC8096EF4381cb335effe977b0ae) (factory `0x8468587Af422ad440F58a57E955eCA6A970b5375`; token0 is CTK, token1 is the same AUSD Segundo pays in). The swap runs at the pair's fixed price of 1 AUSD to 1 CTK, and each cash-out is capped at 100 AUSD. On mainnet, a licensed partner pays out in local money instead. The code is in `web/lib/settlement.ts` and `web/app/api/cashout/route.ts`, and the receipt line is `SettlementLine` in `web/app/cashout/page.tsx`. The one-time setup and the manual swap use `scripts/agora-settle.mjs`.

| Step | Transaction | What it shows |
|---|---|---|
| Whitelist the partner | [`0xfa4325fa…`](https://testnet.monadvision.com/tx/0xfa4325fa21904fb03f8b16efd423897970e8f3a51e4383a738a45daec93fee53), block 70,742,905 | `Whitelister(0x7c10F56d6f04a51376393a1C3670e966863F6BD5).setApprovedSwapper(0x0921…77e6)`. The partner now holds the pair's `APPROVED_SWAPPER` role (`hasRole("APPROVED_SWAPPER", partner)` returns true). |
| Allowance | [`0x445524fa…`](https://testnet.monadvision.com/tx/0x445524fa7cbf728ad10e551ae49694a5785083827778465601ce74a0b29b4149), block 70,742,918 | `AUSD.approve(pair, max)` from the partner. This happens once. |
| Test swap, 1 AUSD | [`0xf5ab4e39…`](https://testnet.monadvision.com/tx/0xf5ab4e398b1320123b05c4e1797683bcb1de4544a2e604392d2170ec461353eb), block 70,742,951 | `swapExactTokensForTokens(1000000, 1e18, [AUSD, CTK], partner, deadline)`: 1 AUSD goes from the partner into the pair, and 1 CTK comes back. |
| A cash-out through the app ($1.50) | Transfer [`0x42b38185…`](https://testnet.monadvision.com/tx/0x42b38185411d6fcc960ae2d556b1e6b766d1581d842e310a2155ab53185f8924), block 70,750,454. Settlement [`0x9b4ba904…`](https://testnet.monadvision.com/tx/0x9b4ba904b09c9772dd314df841d9357b4e9d1741dec398d7cc4aaeee247a04ee), block 70,750,631 | Step one: a practice wallet signs an EIP-3009 transfer of 1.50 AUSD to the partner, and the relayer submits it. Step two: the server swaps those 1.50 AUSD for 1.5 CTK through the pair. The /cashout receipt links both transactions. |

To check it yourself, read `hasRole("APPROVED_SWAPPER", 0x092178787c772cbF67c2560B38D9F4f3454677e6)` and `getAmountsOut(1000000, [AUSD, CTK])` on the pair. You can also run `node scripts/agora-settle.mjs status` from the repository root to see the partner's MON, AUSD and CTK, its role, and the pair's reserves.
