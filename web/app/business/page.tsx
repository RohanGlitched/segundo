import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Divider } from "@/components/home/Art";
import { UnderLoad } from "@/components/home/UnderLoad";
import { Calculator } from "@/components/business/Calculator";
import { LiveRevenue } from "@/components/business/LiveRevenue";
import { Loop } from "@/components/business/Loop";
import { TREASURY, explorerAddress } from "@/lib/chain";
import { DEMO_FREELANCERS } from "@/lib/demo";
import styles from "./business.module.css";

type Src = { name: string; url: string };

/** Every outside figure on this page and where it comes from, checked October 13, 2026, numbered as in the list at the end. */
const SRC = {
  upworkFee: { name: "Upwork Help Center, Freelancer Service Fees", url: "https://support.upwork.com/hc/en-us/articles/211062538-Freelancer-Service-Fees" },
  upworkClient: { name: "Upwork Help Center, What is the Client Marketplace Fee?", url: "https://support.upwork.com/hc/en-us/articles/4660220468499-What-is-the-Client-Marketplace-Fee" },
  upworkHourly: { name: "Upwork Help Center, How payments for hourly contracts work", url: "https://support.upwork.com/hc/en-us/articles/211063668-How-payments-for-hourly-contracts-work" },
  upworkWithdraw: { name: "Upwork Help Center, How to get paid on Upwork (withdrawal fees)", url: "https://support.upwork.com/hc/en-us/articles/211060918-How-to-get-paid-on-Upwork" },
  fiverrSeller: { name: "Fiverr Help Center, Your earnings page", url: "https://help.fiverr.com/hc/en-us/articles/9234443621137-Your-earnings-page" },
  fiverrBuyer: { name: "Fiverr Help Center, Paying for orders, extras or custom offers", url: "https://help.fiverr.com/hc/en-us/articles/37553933600657-Paying-for-orders-extras-or-custom-offers" },
  fiverrClear: { name: "Fiverr Help Center, How Fiverr works for freelancers", url: "https://help.fiverr.com/hc/en-us/articles/34069565843985-How-Fiverr-works-for-freelancers" },
  deel: { name: "Deel, Pricing", url: "https://www.deel.com/pricing/" },
  remote: { name: "Remote, Pricing", url: "https://remote.com/pricing" },
  payoneer: { name: "Payoneer, Pricing (last updated January 1, 2026)", url: "https://www.payoneer.com/pricing/" },
  wise: { name: "Wise, Pricing to receive money (US)", url: "https://wise.com/us/pricing/receive" },
  wiseConvert: { name: "Wise, Pricing (US)", url: "https://wise.com/us/pricing/" },
  rpw: {
    name: "World Bank, Remittance Prices Worldwide, Issue 54 (Q3 2025)",
    url: "https://remittanceprices.worldbank.org/sites/default/files/2026-04/RPW_main_report_and_annex_Q325.pdf",
  },
  agora: { name: "LayerZero, Agora and LayerZero bring AUSD to 5 blockchains (September 2025)", url: "https://layerzero.network/blog/agora-and-layerzero-bring-ausd-to-5-blockchains" },
  agoraHome: { name: "Agora, AUSD", url: "https://www.agora.finance/" },
  gig: { name: "World Bank, Working Without Borders: The Promise and Peril of Online Gig Work (2023)", url: "https://openknowledge.worldbank.org/handle/10986/40066" },
  remit: {
    name: "World Bank blog, In 2024, remittance flows to low- and middle-income countries are expected to reach $685 billion",
    url: "https://blogs.worldbank.org/en/peoplemove/in-2024--remittance-flows-to-low--and-middle-income-countries-ar",
  },
  upworkGsv: { name: "Upwork, fourth quarter and full year 2025 results (SEC Form 8-K, exhibit 99.1)", url: "https://www.sec.gov/Archives/edgar/data/1627475/000162747526000005/exhibit991-upwork4q25andfu.htm" },
  fiverrGmv: { name: "Fiverr, annual report for 2025 (SEC Form 20-F)", url: "https://www.sec.gov/Archives/edgar/data/0001762301/000117891326000858/zk2634486.htm" },
  sablier: { name: "Sablier docs, Fees", url: "https://docs.sablier.com/concepts/fees" },
  llamapay: { name: "LlamaPay docs, Pricing", url: "https://docs.llamapay.io/pricing" },
  superfluid: { name: "Superfluid docs, Money streaming", url: "https://docs.superfluid.org/docs/concepts/overview/money-streaming" },
  monad: { name: "Monad docs, Monad for developers", url: "https://docs.monad.xyz/introduction/monad-for-developers" },
  payoneer25: {
    name: "Payoneer, fourth quarter and full year 2025 results (SEC Form 8-K, exhibit 99.1)",
    url: "https://www.sec.gov/Archives/edgar/data/1845815/000110465926020081/payo-20260226xex99d1.htm",
  },
  monadGas: { name: "Monad docs, Gas pricing", url: "https://docs.monad.xyz/developer-essentials/gas-pricing" },
  monPrice: { name: "The Block, Monad (MON) price", url: "https://www.theblock.co/price/380273/monad-mon-usd" },
} satisfies Record<string, Src>;

type Key = keyof typeof SRC;
const PROOF_SAMPLE = DEMO_FREELANCERS[0]!;
const ORDER = Object.keys(SRC) as Key[];

/** A footnote mark that links to the source page itself; the full list is at the end of the page. */
function Ref({ k }: { k: Key }) {
  return (
    <a href={SRC[k].url} target="_blank" rel="noreferrer" className={styles.ref} title={SRC[k].name} aria-label={`Source ${ORDER.indexOf(k) + 1}: ${SRC[k].name}`}>
      {ORDER.indexOf(k) + 1}
    </a>
  );
}

const COSTS: { who: string; what: string; cost: ReactNode; src: Key[]; us?: boolean }[] = [
  { who: "Upwork", what: "Freelancer service fee, taken from each payment", cost: "0% to 15% per contract", src: ["upworkFee"] },
  { who: "Upwork", what: "Client marketplace fee, on top of each payment", cost: "Up to 7.99% (3% for eligible US clients paying by bank)", src: ["upworkClient"] },
  { who: "Upwork", what: "When hourly pay is released", cost: "10 days after the weekly billing period ends", src: ["upworkHourly"] },
  { who: "Upwork", what: "Withdrawing what you earned", cost: "$0.99 to a local bank, $50 by US dollar wire", src: ["upworkWithdraw"] },
  { who: "Fiverr", what: "Seller fee, and the buyer's service fee", cost: "Sellers keep 80%; buyers add 5.5%, plus $3.50 under $200", src: ["fiverrSeller", "fiverrBuyer"] },
  { who: "Deel", what: "Contractor management, paid by the company", cost: "$49 per contractor a month", src: ["deel"] },
  { who: "Remote", what: "Contractor management, paid by the company", cost: "From $29 per contractor a month", src: ["remote"] },
  { who: "Payoneer", what: "Receiving from a client, then converting to a local bank", cost: "Up to 3.99% + $0.49 by card, 1% by US bank debit; 1.2% to 4% to convert and withdraw", src: ["payoneer"] },
  { who: "Wise", what: "Receiving a US dollar wire, then converting", cost: "$6.11 per wire received; conversion from 0.23%", src: ["wise", "wiseConvert"] },
  { who: "Sending money abroad", what: "Global average cost of sending $200", cost: "6.36% (Q3 2025)", src: ["rpw"] },
  { who: "Segundo", what: "Paid by the client, on what they spend", cost: "1%. Unspent budget and its fee come back. The freelancer pays nothing, and gas is paid for them", src: [], us: true },
];

const LINES: { title: string; status: "live" | "next" | "later"; label: string; body: ReactNode }[] = [
  {
    title: "A 1% fee on what clients spend",
    status: "live",
    label: "Live on testnet",
    body: (
      <>
        <p>
          The client signs <b>1% on top</b> of each budget and top-up. When the tab closes, the unspent budget goes back in full, and so does 1% of it
          from the treasury, so the fee comes to 1% of what was actually paid to the freelancer. Fund $1,000, use $900: the fee is $9.
        </p>
        <p>
          Freelancers pay nothing, and Segundo pays the gas for every action out of the fee; the calculator below shows what that costs and where it
          breaks even. This is the line we can show working today: the panel above counts it as it lands.
        </p>
      </>
    ),
  },
  {
    title: "A share of the reserve yield on budgets waiting in tabs",
    status: "next",
    label: "Next, with mainnet",
    body: (
      <>
        <p>
          A budget sits in the contract from the moment a client funds it until it is earned. On mainnet that money is AUSD, whose reserves earn treasury
          yield, and Agora says plainly that it <b>shares that yield with the partners who build with AUSD</b>
          <Ref k="agoraHome" />, describing revenue sharing from the treasury yield on AUSD reserves for the businesses that use it
          <Ref k="agora" />.
        </p>
        <p>
          The rate is a matter for an agreement with Agora, so we don&apos;t put a number on it here; the calculator below treats it as an assumption you can
          set to zero. Nothing about it touches a freelancer&apos;s pay or needs a change to the contract.
        </p>
      </>
    ),
  },
  {
    title: "Cash-out with local payout partners",
    status: "next",
    label: "Next",
    body: (
      <>
        <p>
          Freelancers want pesos, naira, rupees, shillings and reais in a bank account or a mobile wallet, not a token. Licensed local partners do the last
          step; Segundo earns a share of the spread on each cash-out, shown before the freelancer confirms. It isn&apos;t live yet: today pay lands in
          the freelancer&apos;s wallet as AUSD and stays there until they move it. <Link href="/cashout">See how cash-out will work</Link>, with a simulated
          partner on testnet.
        </p>
        <p>
          The bar is what people pay today. The World Bank found sending money to a mobile wallet averaged <b>3.92%</b> in Q3 2025, against <b>7.86%</b> to
          a bank account
          <Ref k="rpw" />. A dollar balance that is already digital should cash out for well under both.
        </p>
      </>
    ),
  },
  {
    title: "Advances against verified on-chain income",
    status: "later",
    label: "Later",
    body: (
      <>
        <p>
          Every second a freelancer is paid through Segundo is a public record: who paid, how much, how steadily. Segundo&apos;s income statement turns
          that into proof of income anyone can check without trusting us (<Link href={`/proof/${PROOF_SAMPLE.address}`}>here is {PROOF_SAMPLE.name}&apos;s</Link>,
          a demo freelancer in {PROOF_SAMPLE.place}), which is exactly what a lender lacks when a freelancer abroad asks for credit.
        </p>
        <p>
          An advance against next week&apos;s tabs, repaid from pay as it lands, is the natural product. It needs a lending partner and a licence in each
          market, so it comes last.
        </p>
      </>
    ),
  },
];

const ALTS: { name: string; examples: string; forWho: string; when: string; cost: ReactNode; holds: string; gone: string; us?: boolean }[] = [
  {
    name: "Marketplaces",
    examples: "Upwork, Fiverr",
    forWho: "Finding a freelancer and a client in the first place",
    when: "10 days after the week for Upwork hourly work; after a clearing period on Fiverr",
    cost: (
      <>
        Freelancer 0–15% on Upwork, 20% on Fiverr; the client adds up to 7.99% or 5.5%
        <Ref k="upworkFee" />
        <Ref k="fiverrSeller" />
      </>
    ),
    holds: "The platform, until it releases the pay",
    gone: "Payment protection if the work meets its rules, otherwise a dispute",
  },
  {
    name: "Contractor payroll",
    examples: "Deel, Remote",
    forWho: "Companies paying contractors they already have",
    when: "On the invoice or payroll date",
    cost: (
      <>
        $49 or from $29 per contractor a month, paid by the company
        <Ref k="deel" />
        <Ref k="remote" />
      </>
    ),
    holds: "The company until it pays, then the platform and banks",
    gone: "An unpaid invoice",
  },
  {
    name: "Receive and convert",
    examples: "Payoneer, Wise",
    forWho: "Freelancers getting paid from abroad",
    when: "Whenever the client pays the invoice",
    cost: (
      <>
        Receiving and conversion fees: 1% to 3.99% + $0.49 to receive and 1.2% to 4% to withdraw on Payoneer; $6.11 a wire on Wise
        <Ref k="payoneer" />
        <Ref k="wise" />
      </>
    ),
    holds: "The client, until they pay",
    gone: "An unpaid invoice",
  },
  {
    name: "Crypto streaming",
    examples: "Sablier, Superfluid, LlamaPay",
    forWho: "Crypto-native teams paying salaries and vesting",
    when: "Continuously by calendar time, whether anyone is working or not",
    cost: (
      <>
        Gas in the chain&apos;s token, a wallet and a seed phrase; Sablier&apos;s app adds $0.99 per withdrawal, LlamaPay streams are free
        <Ref k="sablier" />
        <Ref k="llamapay" />
      </>
    ),
    holds: "A contract",
    gone: "Paid up to the moment the stream runs dry or stops",
  },
  {
    name: "Segundo",
    examples: "",
    forWho: "Clients paying freelancers abroad by the hour",
    when: "Earned every second on the clock; paid out every few seconds while the tab is on screen, and in full at close. Anyone can trigger a payout",
    cost: "1% of what the client spends. Nothing for the freelancer; gas is covered",
    holds: "A public contract that can only pay the freelancer for time worked or refund the client",
    gone: "Every second worked is paid out or locked to the freelancer; the rest of the budget can only go back to the client",
    us: true,
  },
];

const DIFFS = [
  { t: "Paid while you work", d: "Not ten days after the week. Pay lands in the wallet every few seconds while the tab is on screen, and anyone can trigger a payout." },
  { t: "The budget is locked before you start", d: "The money is in the contract before the first second, so there is no invoice to chase." },
  { t: "Clients pay only for time worked", d: "The clock runs only while the freelancer is on it, and the client can pause it at once." },
  { t: "No wallet app, no gas, no seed phrase", d: "A passkey or an email. Segundo creates the wallet and pays the gas." },
  { t: "1% instead of a cut", d: "Paid by the client on what they spend. The freelancer keeps every second of what they earned." },
];

const CORRIDORS = [
  { to: "Manila", code: "PHP", ink: "#2557B0", night: "#93B4F2", from: "Studios in Europe, the US and Singapore", why: "Design, support and assistants billed by the hour." },
  { to: "Lagos", code: "NGN", ink: "#1F7A4D", night: "#7BD3A4", from: "Studios in Europe and the US", why: "Developers and designers paid in dollars." },
  { to: "Pune", code: "INR", ink: "#7B3FA0", night: "#C9A2E8", from: "Studios in Europe and the US", why: "Engineering and QA contractors on monthly hours." },
  { to: "Nairobi", code: "KES", ink: "#9A5A12", night: "#E7B477", from: "Studios in Europe and the US", why: "Remote work where everyday money is mobile money." },
  { to: "São Paulo", code: "BRL", ink: "#11777A", night: "#79CFD1", from: "Studios in the US", why: "Developers working US hours from close time zones." },
];

const ROAD: { when: string; status: "live" | "next" | "later"; label: string; items: ReactNode[] }[] = [
  {
    when: "Built during Monad Metropolis",
    status: "live",
    label: "October 2026, live on testnet",
    items: [
      <>
        <b>The tab contract</b> on Monad testnet: per-second pay, pause, top-up, refund; verified on Sourcify, 53 Foundry tests including fuzz and
        invariant runs
      </>,
      <>
        <b>Gasless everything</b>: AUSD permits and transfer authorisations, a forwarder and a relayer, so nobody holds MON
      </>,
      <>
        <b>Passkey sign-up</b> with Mera, email sign-in with Privy, and a way to try it without signing up
      </>,
      <>
        <b>The 1% client fee</b>, signed with the tab and paid into a public treasury
      </>,
      <>
        <b>Live notes</b> in twelve currencies, with demo studios paying demo freelancers around the clock
      </>,
      <>
        <b>Revenue and income read from the chain</b> with Envio: the live panel above and an{" "}
        <Link href={`/proof/${PROOF_SAMPLE.address}`}>income statement</Link> for every wallet
      </>,
    ],
  },
  {
    when: "Next",
    status: "next",
    label: "After the hackathon",
    items: [
      <>
        <b>Mainnet on AUSD</b> with the same contract, audited first
      </>,
      <>
        <b>Cash-out partners</b> to banks and mobile money in the five corridors
      </>,
      <>
        <b>Time-tracker plug-ins</b>: the tools freelancers already use clock them in and out of a tab
      </>,
      <>
        <b>A yield-share agreement</b> with Agora for budgets waiting in tabs
      </>,
    ],
  },
  {
    when: "Later",
    status: "later",
    label: "Once income history builds up",
    items: [
      <>
        <b>Advances</b> against verified on-chain income, with a lending partner
      </>,
    ],
  },
];

function Status({ status, children }: { status: "live" | "next" | "later"; children: ReactNode }) {
  return (
    <span className={`${styles.status} ${status === "live" ? styles.live : status === "next" ? styles.next : ""}`}>
      <i aria-hidden /> {children}
    </span>
  );
}

export default function Business() {
  return (
    <>
      <main>
        {/* ------------------------------------------------------------ the model in one line */}
        <section className={`wrap ${styles.top}`}>
          <div className={styles.topText}>
            <p className={styles.kicker}>Business model</p>
            <h1 className={styles.h1}>How Segundo makes money</h1>
            <p className={styles.model}>
              Clients pay <b>1%</b> of what they spend. Freelancers pay <b>nothing</b>.
            </p>
            <p className={styles.lede}>
              Today a freelancer abroad gives up a cut of every hour to a marketplace, waits ten days for it, and pays again to bring it home. Segundo charges
              the side that is buying the time, on what it actually spends, and pays the side doing the work every second, in full. The fee is already running
              on Monad testnet.
            </p>
            <div className={styles.ctas}>
              <a href="#live" className="btn primary">
                See the live treasury
              </a>
              <Link href="/deck" className="btn">
                The pitch deck
              </Link>
            </div>
          </div>
          <div className={styles.receipt} aria-label="One week of work on Segundo">
            <p className={styles.receiptHead}>
              <span>One week: 36 of 40 hours at $25</span>
              <span className="serial">№ 0001</span>
            </p>
            <dl className={styles.receiptList}>
              <div>
                <dt>The client funds $1,000, plus 1%</dt>
                <dd className="denom">$1,010.00</dd>
              </div>
              <div>
                <dt>The freelancer is paid, by the second</dt>
                <dd className="denom">$900.00</dd>
              </div>
              <div>
                <dt>Unspent budget back at close</dt>
                <dd className="denom">−$100.00</dd>
              </div>
              <div>
                <dt>Its 1% back from the treasury</dt>
                <dd className="denom">−$1.00</dd>
              </div>
              <div className={styles.fee}>
                <dt>Segundo fee: 1% of what was spent</dt>
                <dd className="denom">$9.00</dd>
              </div>
              <div className={styles.total}>
                <dt>The client pays in all</dt>
                <dd className="denom">$909.00</dd>
              </div>
              <div>
                <dt>The freelancer pays</dt>
                <dd className="denom">$0.00</dd>
              </div>
            </dl>
            <p className={styles.receiptFoot}>
              On Upwork the same week could cost the freelancer up to $135 (a 0–15% fee
              <Ref k="upworkFee" />) and the client up to $71.91 more (up to 7.99%
              <Ref k="upworkClient" />
              ), paid out 10 days after the week ends
              <Ref k="upworkHourly" />.
            </p>
          </div>
        </section>

        {/* ------------------------------------------------------------ live revenue */}
        <section id="live" className={`wrap ${styles.section} ${styles.tight}`} aria-labelledby="live-h">
          <div className={styles.sectionHead}>
            <h2 id="live-h" className={styles.h2}>
              Revenue, live from the chain
            </h2>
            <p className={styles.sub}>
              Every fee is a public transfer into Segundo&apos;s treasury on Monad, so the revenue line is something you can check rather than take on trust.
              These figures refresh every minute.
            </p>
          </div>
          <LiveRevenue />
          <ol className={styles.mech}>
            <li>
              <span className={`denom ${styles.mechNo}`} aria-hidden>
                1
              </span>
              <h3>Signed with the tab</h3>
              <p>
                When a client opens or tops up a tab, they also sign an AUSD transfer authorisation for the 1%. It is part of the same step, so there is no
                extra prompt and no gas.
              </p>
            </li>
            <li>
              <span className={`denom ${styles.mechNo}`} aria-hidden>
                2
              </span>
              <h3>Collected first, refunded in proportion</h3>
              <p>
                Segundo&apos;s relayer collects the fee, then sends the open or top-up. If that fails, the whole fee goes straight back. When the tab
                closes, the treasury returns 1% of the unspent budget with it.
              </p>
            </li>
            <li>
              <span className={`denom ${styles.mechNo}`} aria-hidden>
                3
              </span>
              <h3>Kept apart from the pay</h3>
              <p>
                The fee goes straight to the{" "}
                <a href={explorerAddress(TREASURY)} target="_blank" rel="noreferrer">
                  treasury
                </a>
                . The tab contract has no fee switch and no admin key: what is in a tab can only pay the freelancer or go back to the client. The contract
                is deployed under Segundo&apos;s working name, Till.
              </p>
            </li>
          </ol>
          <div className={styles.neutral}>
            <h3>The contract is a public good. The fee pays for the service.</h3>
            <p>
              Till, the tab contract, is neutral: it has no fee switch and no owner, and anyone can call it directly and pay their own gas. Our own{" "}
              <Link href="/network">load test</Link> did exactly that, so those tabs owe no fee. Segundo&apos;s 1% pays for what sits around the contract,
              the way a front end does: no gas for either side, passkey sign-up, and cash-out to local money as it arrives.
            </p>
          </div>
        </section>

        <div className={`wrap ${styles.gap}`}>
          <Divider seed={4} />
        </div>

        {/* ------------------------------------------------------------ what it costs today */}
        <section className={`wrap ${styles.section} ${styles.tight}`} aria-labelledby="today">
          <div className={styles.sectionHead}>
            <h2 id="today" className={styles.h2}>
              What hourly work across borders costs today
            </h2>
            <p className={styles.sub}>
              Published prices, from each company&apos;s own pages. A freelancer often pays more than one of these on the same dollar: a marketplace fee, then
              a withdrawal, then a conversion.
            </p>
          </div>
          <div className={styles.costs} role="table" aria-label="What getting paid across borders costs">
            <div className={`${styles.costRow} ${styles.costHead}`} role="row">
              <span role="columnheader">Who</span>
              <span role="columnheader">What</span>
              <span role="columnheader">Cost or wait</span>
              <span role="columnheader">Source</span>
            </div>
            {COSTS.map((c) => (
              <div className={`${styles.costRow} ${c.us ? styles.costUs : ""}`} role="row" key={c.who + c.what}>
                <span role="rowheader" className={styles.costWho}>
                  {c.who}
                </span>
                <span role="cell" className={styles.costWhat}>
                  {c.what}
                </span>
                <span role="cell" className={styles.costFig} data-label="Cost">
                  {c.cost}
                </span>
                <span role="cell" className={styles.costSrc} data-label="Source">
                  {c.us ? (
                    <a href="#live">The live treasury above</a>
                  ) : (
                    c.src.map((k, i) => (
                      <span key={k}>
                        {i > 0 && "; "}
                        <a href={SRC[k].url} target="_blank" rel="noreferrer">
                          {SRC[k].name.replace(/ \(.*\)$/, "")}
                        </a>
                      </span>
                    ))
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------------ revenue lines */}
        <section className={`wrap ${styles.section}`} aria-labelledby="lines">
          <div className={styles.sectionHead}>
            <h2 id="lines" className={styles.h2}>
              Four ways Segundo earns, in the order they arrive
            </h2>
            <p className={styles.sub}>One is live. The other three grow out of the money that already passes through a tab, and none of them charge the freelancer for being paid.</p>
          </div>
          <ol className={styles.lines}>
            {LINES.map((l, i) => (
              <li className={styles.line} key={l.title}>
                <span className={`denom ${styles.lineNo}`} aria-hidden>
                  {i + 1}
                </span>
                <div className={styles.lineHead}>
                  <h3>{l.title}</h3>
                  <Status status={l.status}>{l.label}</Status>
                </div>
                <div className={styles.lineBody}>{l.body}</div>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------------------ unit economics */}
        <section className={`wrap ${styles.section}`} aria-labelledby="units">
          <div className={styles.sectionHead}>
            <h2 id="units" className={styles.h2}>
              Unit economics
            </h2>
            <p className={styles.sub}>
              Change any figure. The fee is what Segundo charges today, and gas is what the relayer actually spends, measured from its receipts. The yield
              share and the MON price, marked in amber, are assumptions until there is an agreement with Agora and a mainnet to price gas on.
            </p>
          </div>
          <Calculator marketFee={0.1} marketLabel="On a marketplace taking 10% (Upwork's range is 0–15%)" wireCost={0.0636} />
          <p className={styles.source}>
            Marketplace range from Upwork&apos;s published freelancer fees
            <Ref k="upworkFee" />; wire cost is the World Bank&apos;s global average for Q3 2025
            <Ref k="rpw" />. Monad&apos;s minimum base fee
            <Ref k="monadGas" />; MON price reference
            <Ref k="monPrice" />.
          </p>
        </section>

        <div className={`wrap ${styles.gap}`}>
          <Divider seed={5} />
        </div>

        {/* ------------------------------------------------------------ market */}
        <section className={`wrap ${styles.section} ${styles.tight}`} aria-labelledby="market">
          <div className={styles.sectionHead}>
            <h2 id="market" className={styles.h2}>
              The market
            </h2>
            <p className={styles.sub}>Hundreds of millions of people work online, and the money they earn crosses a border to reach them.</p>
          </div>
          <div className={styles.market}>
            <div>
              <span className={`denom ${styles.marketFig}`}>154–435M</span>
              <p className={styles.marketText}>
                online gig workers worldwide, 4.4% to 12.5% of the global labour force
                <Ref k="gig" />
              </p>
            </div>
            <div>
              <span className={`denom ${styles.marketFig}`}>$685B</span>
              <p className={styles.marketText}>
                sent home to low- and middle-income countries in 2024, the World Bank&apos;s estimate
                <Ref k="remit" />
              </p>
            </div>
            <div>
              <span className={`denom ${styles.marketFig}`}>$4.03B</span>
              <p className={styles.marketText}>
                of work bought through Upwork in 2025, its gross services volume
                <Ref k="upworkGsv" />
              </p>
            </div>
            <div>
              <span className={`denom ${styles.marketFig}`}>$1.07B</span>
              <p className={styles.marketText}>
                bought through Fiverr&apos;s marketplace in 2025
                <Ref k="fiverrGmv" />
              </p>
            </div>
          </div>
          <p className={styles.marketNote}>
            We don&apos;t add these up into one big number: remittances are not freelance pay, and most freelance work never touches a marketplace.
          </p>
          <h3 className={styles.h3}>A serviceable market, built from the bottom up</h3>
          <div className={styles.sam} role="table" aria-label="Serviceable market estimate">
            <div className={styles.samRow} role="row">
              <span role="rowheader">People already paid across borders every month</span>
              <span role="cell" className="denom">536,000</span>
              <span role="cell" className={styles.samSrc}>
                Payoneer&apos;s active customers at the end of 2025, each averaging over $500 a month
                <Ref k="payoneer25" />
              </span>
            </div>
            <div className={styles.samRow} role="row">
              <span role="rowheader">The least each moves a year</span>
              <span role="cell" className="denom">$6,000</span>
              <span role="cell" className={styles.samSrc}>
                $500 a month, Payoneer&apos;s own threshold
                <Ref k="payoneer25" />
              </span>
            </div>
            <div className={styles.samRow} role="row">
              <span role="rowheader">An hourly freelancer&apos;s year</span>
              <span role="cell" className="denom">$19,500</span>
              <span role="cell" className={`${styles.samSrc} ${styles.samAssume}`}>Our assumption: 25 hours a week at $15, for 52 weeks</span>
            </div>
            <div className={`${styles.samRow} ${styles.samTotal}`} role="row">
              <span role="rowheader">Their pay in a year, and 1% of it</span>
              <span role="cell" className="denom">$3.2–10.5B</span>
              <span role="cell" className={styles.samSrc}>
                536,000 × $6,000 up to 536,000 × $19,500. At 1%: <b>$32–105 million a year</b>
              </span>
            </div>
          </div>
          <p className={styles.marketNote}>
            An estimate, not a forecast: it asks what 1% would earn if the people Payoneer already pays across borders were paid through Segundo instead.
            Payoneer&apos;s base mixes freelancers with online sellers and isn&apos;t split by country, so it isn&apos;t limited to our five corridors. For
            scale, Payoneer itself took 1.18% from small businesses in 2025
            <Ref k="payoneer25" />.
          </p>
        </section>

        {/* ------------------------------------------------------------ competition */}
        <section className={`wrap ${styles.section}`} aria-labelledby="competition">
          <div className={styles.sectionHead}>
            <h2 id="competition" className={styles.h2}>
              The competition, honestly
            </h2>
            <p className={styles.sub}>
              Each of these does its job well. Marketplaces find the work; payroll keeps companies compliant; receive-and-convert apps move money cheaply once
              it&apos;s sent. None of them pays a freelancer while the work is happening without a wallet to manage.
            </p>
          </div>
          <div className={styles.compare} role="table" aria-label="Segundo and the alternatives compared">
            <div className={`${styles.cmpRow} ${styles.cmpHead}`} role="row">
              <span role="columnheader" />
              <span role="columnheader">Who it&apos;s for</span>
              <span role="columnheader">When money arrives</span>
              <span role="columnheader">Cost</span>
              <span role="columnheader">Who holds the money</span>
              <span role="columnheader">If the client disappears</span>
            </div>
            {ALTS.map((a) => (
              <div className={`${styles.cmpRow} ${a.us ? styles.cmpUs : ""}`} role="row" key={a.name}>
                <span role="rowheader" className={styles.cmpName}>
                  {a.name}
                  {a.examples && <small>{a.examples}</small>}
                </span>
                <span role="cell" data-label="For">
                  {a.forWho}
                </span>
                <span role="cell" data-label="Money arrives">
                  {a.when}
                </span>
                <span role="cell" data-label="Cost">
                  {a.cost}
                </span>
                <span role="cell" data-label="Holds the money">
                  {a.holds}
                </span>
                <span role="cell" data-label="If the client disappears">
                  {a.gone}
                </span>
              </div>
            ))}
          </div>
          <p className={styles.source}>
            Superfluid also asks for a deposit while a stream is open, returned when it closes normally
            <Ref k="superfluid" />. Marketplace release times from Upwork
            <Ref k="upworkHourly" /> and Fiverr
            <Ref k="fiverrClear" />.
          </p>
          <h3 className={styles.h3}>What Segundo does differently</h3>
          <ul className={styles.diffs}>
            {DIFFS.map((d) => (
              <li key={d.t}>
                <b>{d.t}</b>
                <span>{d.d}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className={`wrap ${styles.gap}`}>
          <Divider seed={6} />
        </div>

        {/* ------------------------------------------------------------ go to market */}
        <section className={`wrap ${styles.section} ${styles.tight}`} aria-labelledby="gtm">
          <div className={styles.sectionHead}>
            <h2 id="gtm" className={styles.h2}>
              Go to market
            </h2>
            <p className={styles.sub}>
              Start where the wait and the fees hurt most: studios in Europe and the US paying freelancers in five cities by the hour. Each corridor is a
              currency the note already prints in.
            </p>
          </div>
          <ul className={styles.corridors}>
            {CORRIDORS.map((c) => (
              <li key={c.to} className={styles.corridor} style={{ "--c": c.ink, "--cn": c.night } as CSSProperties}>
                <span className={styles.corridorTo}>{c.to}</span>
                <span className={styles.corridorCode}>{c.code}</span>
                <span className={styles.corridorFrom}>{c.from}</span>
                <span className={styles.corridorWhy}>{c.why}</span>
              </li>
            ))}
          </ul>

          <h3 className={styles.h3}>The loop: every tab onboards a freelancer</h3>
          <Loop />

          <h3 className={styles.h3}>Distribution and timing</h3>
          <div className={styles.points}>
            <div>
              <h3>Time trackers as the front door</h3>
              <p>
                Agencies already run a tracker that knows when someone is working. A plug-in that clocks in and out of a Segundo tab turns every tracker
                install into a place pay can start, with no new habit for anyone.
              </p>
            </div>
            <div>
              <h3>Invite links as the sales team</h3>
              <p>
                A client never has to find a freelancer on Segundo, and a freelancer never has to sign up before they&apos;re paid: the tab arrives as a link,
                and the passkey takes under a minute. Both sides leave with a working account.
              </p>
            </div>
            <div>
              <h3>Why now</h3>
              <p>
                Digital dollars are becoming everyday money, and AUSD&apos;s issuer shares the yield on its reserves with partners. Monad made a block every
                0.305 seconds on average over the last 10,000 we measured, and our payouts landed 0.6 to 2.6 seconds after they were sent, so pay arrives
                while you watch (see <Link href="/network">Monad under load</Link>). Passkeys make a wallet as easy as unlocking a phone.
              </p>
            </div>
          </div>
          <UnderLoad />
        </section>

        {/* ------------------------------------------------------------ milestones */}
        <section className={`wrap ${styles.section}`} aria-labelledby="road">
          <div className={styles.sectionHead}>
            <h2 id="road" className={styles.h2}>
              Milestones
            </h2>
            <p className={styles.sub}>What exists today, and what has to happen before the first real paycheck.</p>
          </div>
          <ol className={styles.road}>
            {ROAD.map((r) => (
              <li key={r.when}>
                <div className={styles.roadWhen}>
                  <b>{r.when}</b>
                  <Status status={r.status}>{r.label}</Status>
                </div>
                <ul className={`${styles.roadItems} ${r.status === "live" ? styles.done : ""}`}>
                  {r.items.map((it, i) => (
                    <li key={i}>{it}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>

        {/* ------------------------------------------------------------ founder */}
        <section className={`wrap ${styles.section}`} aria-labelledby="founder">
          <h2 id="founder" className={styles.h2}>
            Who is building it
          </h2>
          <div className={styles.founder}>
            <p className={styles.founderName}>
              <b>Rohan Borade</b>
              <span>Founder, developer, India</span>
            </p>
            <div className={styles.founderText}>
              <p>
                Rohan is building Segundo on his own. He wrote the contract, the relayer and the app during Monad Metropolis, and every line of it is{" "}
                <a href="https://github.com/RohanGlitched/segundo" target="_blank" rel="noreferrer">
                  public on GitHub
                </a>
                .
              </p>
              <p>India is one of the five corridors Segundo starts with.</p>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ sources */}
        <section className={`wrap ${styles.section}`} aria-labelledby="sources">
          <h2 id="sources" className={styles.h2}>
            Sources
          </h2>
          <p className={styles.sub}>
            Checked October 13, 2026. Chain figures come from Monad testnet and are split into our demo studios and everyone else. Gas figures are averages
            over Segundo&apos;s relayer receipts.
          </p>
          <ol className={styles.sources}>
            {ORDER.map((k) => (
              <li key={k}>
                <a href={SRC[k].url} target="_blank" rel="noreferrer">
                  {SRC[k].name}
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section className={`wrap ${styles.closing}`} aria-labelledby="close">
          <h2 id="close" className={styles.closingH}>
            The client pays 1%. The freelancer keeps every second.
          </h2>
          <div className={styles.ctas}>
            <Link href="/open" className="btn primary">
              Open a tab
            </Link>
            <Link href="/deck" className="btn">
              The pitch deck
            </Link>
            <a href={explorerAddress(TREASURY)} target="_blank" rel="noreferrer" className="btn quiet">
              The treasury on MonadVision
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
