import {
	bytesToHex,
	ConsensusAggregationByFields,
	cre,
	encodeCallMsg,
	getNetwork,
	json,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	ok,
	prepareReportRequest,
	TxStatus,
	type NodeRuntime,
	type Runtime,
} from '@chainlink/cre-sdk'
import { type Address, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, stringToHex, zeroAddress } from 'viem'
import { z } from 'zod'
import { keeperReportParams, tillAbi } from './abi'

// Segundo's keeper and rate oracle, as a CRE workflow.
//
// Every few minutes:
//   1. read Till on Monad testnet and find the open tabs that owe their freelancer money,
//   2. fetch USD exchange rates for the currencies Segundo shows (each node asks several public
//      sources and takes the median; the DON then takes the median across nodes),
//   3. send one signed report to SegundoKeeper, which settles those tabs on Till and posts the rates.

export const CURRENCIES = ['PHP', 'NGN', 'INR', 'BRL', 'KES', 'EUR'] as const
export type Currency = (typeof CURRENCIES)[number]

const fxSource = z.object({
	name: z.string(),
	// A pattern, not z.string().url(): the WASM runtime has no URL constructor.
	url: z.string().regex(/^https:\/\/[^\s/]+\/\S*$/),
	format: z.enum(['er-api', 'currency-api', 'frankfurter']),
})

export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	tillAddress: z.string(),
	keeperAddress: z.string(),
	gasLimit: z.string(),
	// AUSD base units (6 dp); smaller balances wait for the next run or the close.
	minOwed: z.string(),
	// How many of the newest tabs to look at, read in chunks (each chunk is one EVM read; the cap is 15 a run).
	scanWindow: z.number().int().positive(),
	chunkSize: z.number().int().positive(),
	maxSettle: z.number().int().positive(),
	fxSources: z.array(fxSource).min(1),
})
export type Config = z.infer<typeof configSchema>
export type FxSource = z.infer<typeof fxSource>

// ─── Rates ──────────────────────────────────────────────────

/** Units of each currency per 1 USD, times 1e6. Zero means no source had it. */
export type Rates = Record<Currency, bigint> & { sources: bigint }

const toE6 = (v: unknown): bigint | null =>
	typeof v === 'number' && Number.isFinite(v) && v > 0 ? BigInt(Math.round(v * 1e6)) : null

/** Pull our currencies out of one source's JSON body. */
export function parseSource(format: FxSource['format'], body: any): Partial<Record<Currency, bigint>> {
	const out: Partial<Record<Currency, bigint>> = {}
	for (const c of CURRENCIES) {
		let v: unknown
		if (format === 'er-api') v = body?.result === 'success' ? body?.rates?.[c] : undefined
		else if (format === 'currency-api') v = body?.usd?.[c.toLowerCase()]
		else v = body?.base === 'USD' ? body?.rates?.[c] : undefined
		const e6 = toE6(v)
		if (e6 !== null) out[c] = e6
	}
	return out
}

/** Median of bigints; the mean of the middle two for an even count. */
export function medianOf(values: bigint[]): bigint {
	if (values.length === 0) return 0n
	const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
	const mid = s.length >> 1
	return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2n
}

/** Combine every source a node reached into one rate per currency. */
export function combine(quotes: Partial<Record<Currency, bigint>>[]): Rates {
	const rates = { sources: BigInt(quotes.length) } as Rates
	for (const c of CURRENCIES) rates[c] = medianOf(quotes.flatMap((q) => (q[c] ? [q[c] as bigint] : [])))
	return rates
}

/** Runs on every node on its own; the DON then agrees on the median of each field. */
export const fetchRates = (nodeRuntime: NodeRuntime<Config>): Rates => {
	const http = new cre.capabilities.HTTPClient()
	const quotes: Partial<Record<Currency, bigint>>[] = []
	for (const source of nodeRuntime.config.fxSources) {
		try {
			const resp = http.sendRequest(nodeRuntime, { url: source.url, method: 'GET' }).result()
			if (!ok(resp)) {
				nodeRuntime.log(`${source.name}: HTTP ${resp.statusCode}`)
				continue
			}
			const q = parseSource(source.format, json(resp))
			if (Object.keys(q).length) quotes.push(q)
		} catch (e) {
			nodeRuntime.log(`${source.name}: ${(e as Error).message}`)
		}
	}
	if (quotes.length === 0) throw new Error('No exchange-rate source answered')
	return combine(quotes)
}

const rateConsensus = ConsensusAggregationByFields<Rates>({
	PHP: median,
	NGN: median,
	INR: median,
	BRL: median,
	KES: median,
	EUR: median,
	sources: median,
})

// ─── Tabs ───────────────────────────────────────────────────

export type TabView = {
	id: bigint
	tab: { closed: boolean; held: boolean; since: bigint; payee: Address }
	owed: bigint
}

/** Open tabs that owe at least minOwed, largest first, capped at maxSettle. */
export function pickDue(views: readonly TabView[], minOwed: bigint, maxSettle: number): TabView[] {
	return views
		.filter((v) => !v.tab.closed && v.owed >= minOwed)
		.sort((a, b) => (a.owed < b.owed ? 1 : a.owed > b.owed ? -1 : 0))
		.slice(0, maxSettle)
}

/** The ids to scan: the newest scanWindow tabs, split into chunks of chunkSize. */
export function scanChunks(tabCount: bigint, scanWindow: number, chunkSize: number): bigint[][] {
	const first = tabCount > BigInt(scanWindow) ? tabCount - BigInt(scanWindow) + 1n : 1n
	const chunks: bigint[][] = []
	for (let id = first; id <= tabCount; id += BigInt(chunkSize)) {
		const chunk: bigint[] = []
		for (let j = id; j < id + BigInt(chunkSize) && j <= tabCount; j++) chunk.push(j)
		chunks.push(chunk)
	}
	return chunks
}

const fmt = (e6: bigint) => `${e6 / 1_000_000n}.${(e6 % 1_000_000n).toString().padStart(6, '0')}`

// ─── Callback ───────────────────────────────────────────────

export const onCronTrigger = (runtime: Runtime<Config>): string => {
	const config = runtime.config
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: true })
	if (!network) throw new Error(`Unknown chain: ${config.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(network.chainSelector.selector)
	const till = config.tillAddress as Address

	const read = (data: `0x${string}`) =>
		evm
			.callContract(runtime, {
				call: encodeCallMsg({ from: zeroAddress, to: till, data }),
				blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
			})
			.result()

	// 1. Which tabs owe money right now.
	const tabCount = decodeFunctionResult({
		abi: tillAbi,
		functionName: 'tabCount',
		data: bytesToHex(read(encodeFunctionData({ abi: tillAbi, functionName: 'tabCount' })).data),
	}) as bigint

	const views: TabView[] = []
	for (const ids of scanChunks(tabCount, config.scanWindow, config.chunkSize)) {
		const out = decodeFunctionResult({
			abi: tillAbi,
			functionName: 'getTabs',
			data: bytesToHex(read(encodeFunctionData({ abi: tillAbi, functionName: 'getTabs', args: [ids] })).data),
		}) as readonly TabView[]
		views.push(...out)
	}
	const due = pickDue(views, BigInt(config.minOwed), config.maxSettle)
	const running = views.filter((v) => !v.tab.closed && v.tab.since > 0n).length
	const owedTotal = due.reduce((s, v) => s + v.owed, 0n)
	runtime.log(
		`Till has ${tabCount} tabs; scanned ${views.length}, ${running} running, ${due.length} owe at least ${fmt(BigInt(config.minOwed))} AUSD (${fmt(owedTotal)} AUSD in all)`,
	)

	// 2. Exchange rates, agreed by the DON.
	const rates = runtime.runInNodeMode(fetchRates, rateConsensus)().result()
	const currencies = CURRENCIES.filter((c) => rates[c] > 0n)
	runtime.log(
		`USD rates (median of ${rates.sources} sources): ${currencies.map((c) => `${c} ${fmt(rates[c])}`).join(', ')}`,
	)

	if (due.length === 0 && currencies.length === 0) return 'Nothing to settle and no rates; skipped'

	// 3. One report: settle the tabs that owe, post the rates.
	const at = BigInt(Math.floor(runtime.now().getTime() / 1000))
	const payload = encodeAbiParameters(keeperReportParams, [
		due.map((v) => v.id),
		currencies.map((c) => stringToHex(c, { size: 3 })),
		currencies.map((c) => rates[c]),
		at,
	])
	const report = runtime.report(prepareReportRequest(payload)).result()
	const write = evm
		.writeReport(runtime, {
			receiver: config.keeperAddress,
			report,
			gasConfig: { gasLimit: config.gasLimit },
		})
		.result()

	if (write.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Keeper report failed: ${write.errorMessage || TxStatus[write.txStatus]}`)
	}
	if (write.receiverContractExecutionStatus !== undefined && write.receiverContractExecutionStatus !== 0) {
		throw new Error(`SegundoKeeper reverted: ${write.errorMessage || 'no reason given'}`)
	}
	const txHash = bytesToHex(write.txHash || new Uint8Array(32))
	runtime.log(`Report delivered to SegundoKeeper ${config.keeperAddress}: ${txHash}`)
	runtime.log(`https://testnet.monadscan.com/tx/${txHash}`)

	return `Settled ${due.length} tabs (${fmt(owedTotal)} AUSD owed), posted ${currencies.length} rates; tx ${txHash}`
}

// ─── Workflow ───────────────────────────────────────────────

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)]
}
