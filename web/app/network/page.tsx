import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Divider } from "@/components/home/Art";
import { TILL, explorerAddress, explorerTx, publicClient } from "@/lib/chain";
import bench from "@/public/bench.json";
import { CrePanel } from "./CrePanel";
import styles from "./network.module.css";

// The block-time figure is read live from Monad; the rest is the recorded run in public/bench.json.
export const revalidate = 600;

const REPO = "https://github.com/RohanGlitched/till-pay/tree/main/scripts/bench";
const DOCS = {
  gas: "https://docs.monad.xyz/developer-essentials/gas-pricing",
  reserve: "https://docs.monad.xyz/developer-essentials/reserve-balance",
  parallel: "https://docs.monad.xyz/monad-arch/execution/parallel-execution",
};

const n = (x: number) => x.toLocaleString("en-US");
const s = (ms: number, digits = 2) => `${(ms / 1000).toFixed(digits)} s`;
const short = (block: number) => `…${String(block).slice(-3)}`;

/** Average block time over the last 10,000 blocks, from their timestamps; the recorded figure if Monad can't be reached. */
async function blockTime() {
  try {
    const head = await publicClient.getBlock();
    const back = await publicClient.getBlock({ blockNumber: head.number - 10_000n });
    const avgMs = (Number(head.timestamp - back.timestamp) * 1000) / 10_000;
    return { avgMs, from: Number(back.number), to: Number(head.number), live: true };
  } catch {
    return { ...bench.blockTime, live: false };
  }
}

const reverts = bench.failed + bench.pipelined.reverted + bench.singleSender.reverted;
const zeroAmount = bench.succeeded - bench.paidOut;
const peak = Math.max(...bench.perBlock.map((b) => b.ours + b.others));
const runDay = new Date(bench.runAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

function Sec({ id, title, sub, children }: { id?: string; title: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className={`wrap ${styles.section}`}>
      <div className={styles.sectionHead}>
        <h2 className={styles.h2}>{title}</h2>
        {sub ? <p className={styles.sub}>{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Our settles per block across the burst, against everything else in the same blocks. No chart library: just boxes. */
function PerBlock() {
  return (
    <figure className={styles.figure}>
      <div className={styles.legend} aria-hidden>
        <span>
          <i className={styles.keyOurs} /> Our settles
        </span>
        <span>
          <i className={styles.keyRevert} /> Ours that reverted
        </span>
        <span>
          <i className={styles.keyOthers} /> Everyone else on Monad
        </span>
      </div>
      <div
        className={styles.chart}
        role="img"
        aria-label={`Bar chart of blocks ${n(bench.firstBlock)} to ${n(bench.lastBlock)}. Our settles per block: ${bench.perBlock
          .map((b) => `${short(b.number)} ${b.ours}`)
          .join(", ")}. The table below has every number.`}
      >
        {bench.perBlock.map((b) => {
          const ok = b.ours - b.reverted;
          const h = (x: number) => `${(x / peak) * 100}%`;
          return (
            <div
              key={b.number}
              className={styles.col}
              title={`Block ${n(b.number)}: ${b.ours} of ours${b.reverted ? ` (${b.reverted} reverted)` : ""}, ${b.others} others, ${((b.gasUsed / b.gasLimit) * 100).toFixed(1)}% of block gas${b.seenMs != null ? `, seen ${s(b.seenMs)} after the first send` : ""}`}
            >
              <span className={styles.colValue}>{b.ours || ""}</span>
              <div className={styles.stack}>
                {b.others ? <span className={styles.others} style={{ height: h(b.others) }} /> : null}
                {b.reverted ? <span className={styles.revert} style={{ height: h(b.reverted) }} /> : null}
                {ok ? <span className={styles.ours} style={{ height: h(ok) }} /> : null}
              </div>
              <span className={`serial ${styles.colLabel}`}>{short(b.number)}</span>
            </div>
          );
        })}
      </div>
      <figcaption className={styles.caption}>
        Blocks <span className="serial">{n(bench.firstBlock)}</span> to <span className="serial">{n(bench.lastBlock)}</span>, one bar per block, in the order
        they were made. Hover or tap a bar for its gas and when we saw it.
      </figcaption>
      <details className={styles.details}>
        <summary>Show every block as a table</summary>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Block</th>
                <th scope="col">Ours</th>
                <th scope="col">Reverted</th>
                <th scope="col">Others</th>
                <th scope="col">Block gas used</th>
                <th scope="col">Seen after first send</th>
              </tr>
            </thead>
            <tbody>
              {bench.perBlock.map((b) => (
                <tr key={b.number}>
                  <td>
                    <a className="serial" href={`https://testnet.monadvision.com/block/${b.number}`} target="_blank" rel="noreferrer">
                      {n(b.number)}
                    </a>
                  </td>
                  <td>{b.ours}</td>
                  <td>{b.reverted}</td>
                  <td>{b.others}</td>
                  <td>{((b.gasUsed / b.gasLimit) * 100).toFixed(1)}%</td>
                  <td>{b.seenMs != null ? s(b.seenMs) : "not seen"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export default async function Network() {
  const bt = await blockTime();
  const waves = bench.waves;
  const lastWaves = waves.filter((w) => w.blocks.length === 1);

  return (
    <>
      <main>
        {/* ------------------------------------------------------------ the claim and the certificate */}
        <section className={`wrap ${styles.top}`}>
          <div className={styles.topText}>
            <p className={styles.kicker}>Monad, measured</p>
            <h1 className={styles.h1}>Segundo on Monad, measured</h1>
            <p className={styles.model}>
              We settled the pay of <b>{bench.tabs} freelancers every second</b> for five seconds, from {bench.senders} sender keys at once. Monad put{" "}
              <b>{bench.perBlockMax} of those payouts in a single block</b>.
            </p>
            <p className={styles.lede}>
              Per-second pay only works if many tabs can pay out at the same moment without queueing behind each other. So on {runDay} we opened{" "}
              {bench.tabs} real tabs on Monad testnet, clocked every freelancer in, and settled all of them every second. Then we sent the same kind of
              payout from a single key, the way Segundo&apos;s relayer worked before this test. Below are the numbers from that run, what they don&apos;t prove, and the
              transactions so you can check them.
            </p>
          </div>

          <aside className={styles.cert} aria-label="Test result">
            <div className={styles.certHead}>
              <span>Load test</span>
              <span className="serial">№ {n(bench.firstBlock)}</span>
            </div>
            <dl className={styles.certList}>
              <div>
                <dt>Payouts sent</dt>
                <dd>{n(bench.txs)}</dd>
              </div>
              <div>
                <dt>Landed on chain</dt>
                <dd>{n(bench.landed)}</dd>
              </div>
              <div>
                <dt>From first send to last block</dt>
                <dd>{bench.durationS.toFixed(2)} s</dd>
              </div>
              <div>
                <dt>Most of ours in one block</dt>
                <dd>{bench.perBlockMax}</dd>
              </div>
              <div>
                <dt>Median, send to block</dt>
                <dd>{s(bench.p50ms)}</dd>
              </div>
              <div className={styles.certTotal}>
                <dt>Landed per second</dt>
                <dd>{bench.txPerS.toFixed(1)}</dd>
              </div>
            </dl>
            <p className={styles.certFoot}>
              In the burst, {bench.succeeded} succeeded and {bench.failed} reverted ({reverts} across all three runs, every one out of gas, explained
              below). Monad testnet, Segundo&apos;s contract{" "}
              <a className="serial" href={explorerAddress(TILL)} target="_blank" rel="noreferrer">
                {TILL.slice(0, 8)}…{TILL.slice(-4)}
              </a>
              .
            </p>
          </aside>
        </section>

        {/* ------------------------------------------------------------ the four numbers */}
        <section className={`wrap ${styles.stats}`} aria-label="Headline numbers">
          <div className={styles.stat}>
            <span className={`denom ${styles.statFig}`}>{Math.round(bench.txPerS)}</span>
            <span className={styles.statLabel}>payouts landed a second, against {bench.offeredPerS} a second sent</span>
          </div>
          <div className={styles.stat}>
            <span className={`denom ${styles.statFig}`}>{bench.perBlockMax}</span>
            <span className={styles.statLabel}>of our settles in one block, twice: a whole second of pay for every tab</span>
          </div>
          <div className={styles.stat}>
            <span className={`denom ${styles.statFig}`}>{(bench.p50ms / 1000).toFixed(2)}</span>
            <span className={styles.statLabel}>seconds, median from sending to the block holding it ({s(bench.p90ms)} for 9 in 10)</span>
          </div>
          <div className={styles.stat}>
            <span className={`denom ${styles.statFig}`}>{bench.fullestBlockPct}%</span>
            <span className={styles.statLabel}>of the block&apos;s gas used by the busiest block of the burst</span>
          </div>
        </section>

        <div className="wrap">
          <Divider seed={7} />
        </div>

        {/* ------------------------------------------------------------ why it matters */}
        <Sec title="Why this is the test that matters" sub="Paying by the second turns one invoice a month into a steady stream of small payouts. Three things decide whether that stream keeps up.">
          <div className={styles.why}>
            <div>
              <h3>Many tabs pay out together</h3>
              <p>
                A studio with a dozen freelancers, or a platform with thousands, settles everyone on the same beat. If payouts queue, the freelancer at the
                back of the queue watches a number that isn&apos;t really theirs yet.
              </p>
            </div>
            <div>
              <h3>One address sends one thing at a time</h3>
              <p>
                Every transaction from an address carries the next number in its sequence (its nonce), and the chain takes them strictly in order. A relayer
                that pays the gas for everyone from one address is a single queue unless it is built not to be.
              </p>
            </div>
            <div>
              <h3>Blocks set the pace</h3>
              <p>
                A payout is final when it is in a block. Monad made a block every <b>{(bt.avgMs / 1000).toFixed(3)} s</b> on average over the last 10,000,
                so a once-a-second payout has about three blocks to land in.
              </p>
            </div>
          </div>
        </Sec>

        {/* ------------------------------------------------------------ the burst */}
        <Sec
          id="burst"
          title="The burst, block by block"
          sub={
            <>
              Every second for five seconds, each of the {bench.senders} sender keys sent one settle for each of its own {bench.tabs / bench.senders} tabs:{" "}
              {bench.offeredPerS} payouts a second, {n(bench.txs)} in all. Each key kept its own nonce sequence, so no key waited on another.
            </>
          }
        >
          <PerBlock />
          <ul className={styles.waves}>
            {waves.map((w) => (
              <li key={w.wave}>
                <span className={styles.waveNo}>Second {w.wave + 1}</span>
                <span>
                  {w.txs} settles landed in {w.blocks.length === 1 ? "one block, " : `${w.blocks.length} blocks, `}
                  {w.blocks.map((b, i) => (
                    <span key={b}>
                      {i ? ", " : ""}
                      <span className="serial">{n(b)}</span>
                    </span>
                  ))}
                  . Median {s(w.p50ms)} from send to block.
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.body}>
            The first second was the slowest, and not because of Monad: the three public RPC endpoints took {s(waves[0]?.sendMs ?? 0)} just to accept that
            first batch while connections opened, against about {s(waves[1]?.sendMs ?? 0)} afterwards. By the {lastWaves.length === 2 ? "last two seconds" : "end"},
            every tab&apos;s payout for that second landed together in one block.
          </p>
        </Sec>

        {/* ------------------------------------------------------------ one key vs many */}
        <Sec
          id="one-key"
          title="One key or many"
          sub="The criticism we set out to test: every transaction comes from one relayer address, in nonce order. So we ran the same payouts three ways."
        >
          <div className={styles.compare} role="table" aria-label="One key against many">
            <div className={`${styles.compareRow} ${styles.compareHead}`} role="row">
              <span role="columnheader">How it was sent</span>
              <span role="columnheader">Payouts</span>
              <span role="columnheader">Per second</span>
              <span role="columnheader">Median to block</span>
              <span role="columnheader">Most in a block</span>
            </div>
            <div className={styles.compareRow} role="row">
              <span role="cell" className={styles.compareWho}>
                {bench.senders} keys, each with its own nonces
              </span>
              <span role="cell" data-label="Payouts">
                {n(bench.txs)} in {bench.durationS.toFixed(2)} s
              </span>
              <span role="cell" data-label="Per second" className={styles.compareFig}>
                {bench.txPerS.toFixed(1)}
              </span>
              <span role="cell" data-label="Median to block">
                {s(bench.p50ms)}
              </span>
              <span role="cell" data-label="Most in a block">
                {bench.perBlockMax}
              </span>
            </div>
            <div className={styles.compareRow} role="row">
              <span role="cell" className={styles.compareWho}>
                One key, {bench.pipelined.txs} nonces sent at once
              </span>
              <span role="cell" data-label="Payouts">
                {bench.pipelined.txs}, all in block <span className="serial">{n(bench.pipelined.block)}</span>
              </span>
              <span role="cell" data-label="Per second" className={styles.compareFig}>
                {bench.pipelined.txs} in {s(bench.pipelined.durationS * 1000)}
              </span>
              <span role="cell" data-label="Median to block">
                {s(bench.pipelined.p50ms)}
              </span>
              <span role="cell" data-label="Most in a block">
                {bench.pipelined.perBlockMax}
              </span>
            </div>
            <div className={`${styles.compareRow} ${styles.compareUs}`} role="row">
              <span role="cell" className={styles.compareWho}>
                One key, one at a time: Segundo&apos;s relayer before this test
              </span>
              <span role="cell" data-label="Payouts">
                {bench.singleSender.txs} in {bench.singleSender.durationS.toFixed(1)} s
              </span>
              <span role="cell" data-label="Per second" className={styles.compareFig}>
                {bench.singleSender.txPerS.toFixed(1)}
              </span>
              <span role="cell" data-label="Median to block">
                {s(bench.singleSender.p50ms)} to receipt
              </span>
              <span role="cell" data-label="Most in a block">
                {bench.singleSender.perBlockMax}
              </span>
            </div>
          </div>
          <div className={styles.verdict}>
            <p>
              <b>Monad was not the bottleneck; our relayer was.</b> {bench.pipelined.txs} payouts from one fresh key with consecutive nonces all landed in a
              single block. Segundo&apos;s relayer used to send a transaction, wait for its receipt, then send the next, so it topped out near{" "}
              {bench.singleSender.txPerS.toFixed(1)} payouts a second however fast the chain is. That was fine for a demo and wrong for payroll, so we
              changed it: the relayer is now a pool of keys that keep many transactions in flight each.
            </p>
            <p>
              Production needs what this benchmark used: <b>a pool of relayer keys, each sending its own nonces without waiting</b>. With a pool, one stuck
              transaction holds up only its own key, server instances never race for the same nonce, and no key comes near Monad&apos;s limit on fees in
              flight per account, the lesser of 10 MON and its balance over about three blocks
              <a className={styles.ref} href={DOCS.reserve} target="_blank" rel="noreferrer" aria-label="Source: Monad docs, reserve balance">
                1
              </a>
              . At {bench.cost.perSettleMon} MON a payout, that limit is roughly a thousand payouts in flight per key.
            </p>
            <p>
              <b>Since this run, Segundo&apos;s relayer uses a pool of 7 keys.</b> Each person&apos;s actions go to one key chosen from their address (a
              tab&apos;s payouts, from its number), so they stay in order, and each key sends its next transaction without waiting for the last one&apos;s
              receipt.
            </p>
          </div>
        </Sec>

        {/* ------------------------------------------------------------ the contract's part */}
        <Sec
          id="contract"
          title="Why a running tab costs nothing"
          sub="The other half of per-second pay at scale is not writing to the chain every second. Segundo's contract (deployed under its working name, Till) is built so it doesn't have to."
        >
          <div className={styles.formulaRow}>
            <div className={styles.formula} aria-label="earned equals banked plus seconds since clock-in times hourly rate divided by 3,600, capped at the budget">
              <span>earned</span>
              <span className={styles.eq}>=</span>
              <span>banked + (now − clocked in) × rate ÷ 3,600</span>
              <span className={styles.cap}>never more than the budget</span>
            </div>
            <div className={styles.body}>
              <p>
                When a freelancer clocks in, the contract stores one timestamp. From then on nothing is written: what they have earned is worked out from the
                block&apos;s clock whenever anyone asks. Ninety-six tabs running cost the same as none.
              </p>
              <p>
                Money moves only when a tab is <b>settled</b>, and anyone may settle any tab, because the money can only ever go to that tab&apos;s
                freelancer. That is what let {bench.senders} unrelated keys pay {bench.tabs} people in this test without any of them being trusted.
              </p>
            </div>
          </div>
          <div className={styles.creRow}>
            <div className={styles.body}>
              <h3 className={styles.h3}>Who pays out when nobody is watching</h3>
              <p>
                Pay is earned every second. While a tab is open on someone&apos;s screen, the app asks for a payout every few seconds; when nobody has it
                open, a keeper settles every running tab that owes at least a cent, every few minutes. Segundo runs one keeper itself, and a second runs
                as a <b>Chainlink CRE workflow</b>: several nodes each read the running tabs from Monad and fetch exchange rates from three public
                sources, agree on one report, and SegundoKeeper settles those tabs with <span className="serial">settleMany</span> and stores the rates.
              </p>
              <p>
                Because anyone may settle any tab, neither keeper is trusted with anything: the worst either can do is stop, and then the other, the
                app or the freelancer settles instead.
              </p>
            </div>
            <CrePanel />
          </div>
        </Sec>

        {/* ------------------------------------------------------------ honesty */}
        <Sec id="limits" title="What this run does not show" sub="A benchmark is only worth its caveats. These are ours.">
          <ul className={styles.limits}>
            <li>
              <h3>Parallel execution</h3>
              <p>
                Every settle changes the contract&apos;s AUSD balance, one storage slot. Monad runs transactions in parallel optimistically and re-runs any that
                read something an earlier one changed, with the same result as running them in order
                <a className={styles.ref} href={DOCS.parallel} target="_blank" rel="noreferrer" aria-label="Source: Monad docs, parallel execution">
                  2
                </a>
                . So these settles conflict with each other, and this run says nothing about how many ran side by side. What it measures is how many
                landed, how fast, and how full the blocks got.
              </p>
            </li>
            <li>
              <h3>{reverts} reverts across the three runs</h3>
              <p>
                {bench.failed} in the burst, {bench.pipelined.reverted} from the single key sent all at once and {bench.singleSender.reverted} sent one at a
                time. All out of gas, all on the same 5 tabs. Monad charges the whole gas limit, not the gas used
                <a className={styles.ref} href={DOCS.gas} target="_blank" rel="noreferrer" aria-label="Source: Monad docs, gas pricing">
                  3
                </a>
                , so to keep the bill down we gave every tab one tight limit taken from the others; those 5 need {n(bench.gasPerSettle.steadySomeTabs)} gas, not{" "}
                {n(bench.gasPerSettle.steady)}. Segundo&apos;s relayer estimates each call and adds 15%, and refuses a
                signed request asking for more than 1.5 times its own estimate. Reverted transactions still landed and count in
                the throughput.
              </p>
            </li>
            <li>
              <h3>{zeroAmount} settles with nothing to pay</h3>
              <p>
                Block timestamps count whole seconds. When a tab&apos;s second settle landed in the same second as its first, there was nothing new earned, so
                it succeeded and paid nothing. {n(bench.paidOut)} settles moved money.
              </p>
            </li>
            <li>
              <h3>Public endpoints, one machine</h3>
              <p>
                We sent through public RPC endpoints, and the Monad Foundation one allows 50 calls a second per client, so senders were spread over three.
                Times are from one machine&apos;s clock: send to the moment it received the block&apos;s header over WebSocket.
              </p>
            </li>
            <li>
              <h3>Five seconds, testnet, test money</h3>
              <p>
                Each payout cost about {bench.cost.perSettleMon} test MON at testnet gas prices, and the whole exercise, from opening the tabs to closing them
                and sweeping funds back, cost {bench.cost.monSpent} test MON, so we kept the burst short. The tabs paid 0.36 test AUSD an hour and were all
                closed afterwards.
              </p>
            </li>
          </ul>
        </Sec>

        {/* ------------------------------------------------------------ block time + gas */}
        <Sec id="numbers" title="The pace and the price">
          <div className={styles.pair}>
            <div className={styles.paceBox}>
              <p className={styles.paceLabel}>Average block time, last 10,000 blocks</p>
              <p className={`denom ${styles.paceFig}`}>{(bt.avgMs / 1000).toFixed(3)} s</p>
              <p className={styles.source}>
                Blocks <span className="serial">{n(bt.from)}</span> to <span className="serial">{n(bt.to)}</span>,{" "}
                {bt.live ? "read from Monad testnet when this page was last refreshed (every 10 minutes)" : "as recorded at the end of the run"}. During the
                run it was {(bench.blockTime.avgMs / 1000).toFixed(3)} s.
              </p>
            </div>
            <div>
              <table className={styles.gasTable}>
                <caption>Gas for one settle, from eth_estimateGas on Monad testnet</caption>
                <tbody>
                  <tr>
                    <th scope="row">First payout to a new freelancer</th>
                    <td>{n(bench.gasPerSettle.firstPayout)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Every payout after that</th>
                    <td>{n(bench.gasPerSettle.steady)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Nothing new earned</th>
                    <td>{n(bench.gasPerSettle.nothingOwed)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Price paid per unit of gas</th>
                    <td>{bench.gasPerSettle.priceGwei} gwei</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Sec>

        {/* ------------------------------------------------------------ receipts */}
        <Sec id="check" title="Check it yourself" sub="Every payout in the run is a public transaction. A few to start with:">
          <ul className={styles.samples}>
            {bench.samples.map((t) => (
              <li key={t.hash}>
                <span>{t.label}</span>
                <a className="serial" href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                  {t.hash.slice(0, 10)}…{t.hash.slice(-6)}
                </a>
              </li>
            ))}
          </ul>
          <p className={styles.body}>
            The scripts that ran this are in the repository, with the method and how to run it again:{" "}
            <a href={REPO} target="_blank" rel="noreferrer">
              scripts/bench
            </a>
            . This page is built from the run&apos;s summary,{" "}
            <a href="/bench.json">bench.json</a>; the record of every transaction (send time, block, status, amount paid) sits next to the scripts in
            scripts/bench/out.
          </p>
          <p className={styles.ctas}>
            <Link href="/open" className="btn primary">
              Open a tab
            </Link>
            <Link href="/" className="btn">
              See tabs running now
            </Link>
          </p>
        </Sec>
        <div className={styles.last} />
      </main>
      <Footer />
    </>
  );
}
