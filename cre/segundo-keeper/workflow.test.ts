import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import {
	addContractMock,
	EvmMock,
	HttpActionsMock,
	newTestRuntime,
	REPORT_METADATA_HEADER_LENGTH,
	test,
} from '@chainlink/cre-sdk/test'
import { type Address, bytesToHex, decodeAbiParameters, hexToString } from 'viem'
import { keeperAbi, keeperReportParams, tillAbi } from './abi'
import {
	combine,
	type Config,
	initWorkflow,
	medianOf,
	onCronTrigger,
	parseSource,
	pickDue,
	scanChunks,
	type TabView,
} from './workflow'

const MONAD_TESTNET = 2183018362218727504n
const TILL = '0xeb6c2c519c9bcc4495364c34ac116c20098113d1' as Address
const KEEPER = '0xFEf8d6A7aF00ACd33FDdd2Ef8800cab78164d80D' as Address

const config: Config = {
	schedule: '0 */5 * * * *',
	chainSelectorName: 'monad-testnet',
	tillAddress: TILL,
	keeperAddress: KEEPER,
	gasLimit: '1500000',
	minOwed: '10000',
	scanWindow: 240,
	chunkSize: 40,
	maxSettle: 40,
	fxSources: [
		{ name: 'er-api', url: 'https://open.er-api.com/v6/latest/USD', format: 'er-api' },
		{ name: 'currency-api', url: 'https://cdn.example/usd.min.json', format: 'currency-api' },
		{ name: 'frankfurter', url: 'https://api.frankfurter.dev/v1/latest?base=USD', format: 'frankfurter' },
	],
}

const bodies: Record<string, unknown> = {
	'er-api': { result: 'success', rates: { PHP: 62.7, NGN: 1530.1, INR: 95.8, BRL: 4.99, KES: 129.2, EUR: 0.894 } },
	'currency-api': { usd: { php: 62.8, ngn: 1532.3, inr: 95.7, brl: 5.01, kes: 129.4, eur: 0.895 } },
	frankfurter: { base: 'USD', rates: { PHP: 62.757, INR: 95.78, BRL: 4.9923, EUR: 0.89437 } },
}

const tab = (id: bigint, owed: bigint, closed = false, since = 1n): TabView => ({
	id,
	tab: { closed, held: false, since, payee: '0x0000000000000000000000000000000000000001' },
	owed,
})

describe('rates', () => {
	test('parses each source format', () => {
		expect(parseSource('er-api', bodies['er-api']).NGN).toBe(1_530_100_000n)
		expect(parseSource('currency-api', bodies['currency-api']).KES).toBe(129_400_000n)
		expect(parseSource('frankfurter', bodies.frankfurter).NGN).toBeUndefined()
		expect(parseSource('er-api', { result: 'error' })).toEqual({})
	})

	test('takes the median per currency across sources', () => {
		expect(medianOf([3n, 1n, 2n])).toBe(2n)
		expect(medianOf([2n, 4n])).toBe(3n)
		const r = combine([
			parseSource('er-api', bodies['er-api']),
			parseSource('currency-api', bodies['currency-api']),
			parseSource('frankfurter', bodies.frankfurter),
		])
		expect(r.PHP).toBe(62_757_000n)
		expect(r.NGN).toBe(1_531_200_000n)
		expect(r.sources).toBe(3n)
	})
})

describe('tabs', () => {
	test('picks open tabs that owe enough, largest first', () => {
		const due = pickDue([tab(1n, 5_000n), tab(2n, 90_000n), tab(3n, 400_000n, true), tab(4n, 20_000n)], 10_000n, 40)
		expect(due.map((v) => v.id)).toEqual([2n, 4n])
	})

	test('scans the newest tabs in chunks', () => {
		expect(scanChunks(24n, 240, 40)).toEqual([Array.from({ length: 24 }, (_, i) => BigInt(i + 1))])
		const chunks = scanChunks(300n, 100, 40)
		expect(chunks.map((c) => c.length)).toEqual([40, 40, 20])
		expect(chunks[0][0]).toBe(201n)
		expect(chunks[2][19]).toBe(300n)
	})
})

describe('onCronTrigger', () => {
	test('settles owing tabs and posts DON rates in one report', () => {
		const evm = EvmMock.testInstance(MONAD_TESTNET)
		const till = addContractMock(evm, { address: TILL, abi: tillAbi })
		till.tabCount = () => 3n
		till.getTabs = () => [
			{ ...tab(1n, 250_000n), earned: 0n, runway: 0n, tab: { ...tab(1n, 0n).tab, payer: TILL, rate: 1n, invite: TILL, lastBlock: 0n, budget: 1n, banked: 0n, paid: 0n } },
			{ ...tab(2n, 0n), earned: 0n, runway: 0n, tab: { ...tab(2n, 0n).tab, payer: TILL, rate: 1n, invite: TILL, lastBlock: 0n, budget: 1n, banked: 0n, paid: 0n } },
			{ ...tab(3n, 80_000n, true), earned: 0n, runway: 0n, tab: { ...tab(3n, 0n, true).tab, payer: TILL, rate: 1n, invite: TILL, lastBlock: 0n, budget: 1n, banked: 0n, paid: 0n } },
		]

		const http = HttpActionsMock.testInstance()
		http.sendRequest = (req) => {
			const source = config.fxSources.find((s) => s.url === req.url)!
			return { statusCode: 200, body: new TextEncoder().encode(JSON.stringify(bodies[source.name])) }
		}

		const keeper = addContractMock(evm, { address: KEEPER, abi: keeperAbi })
		let payload: `0x${string}` | undefined
		keeper.writeReport = (input) => {
			payload = bytesToHex(input.report.rawReport.slice(REPORT_METADATA_HEADER_LENGTH))
			return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32).fill(0xab) }
		}

		const runtime = newTestRuntime(null, { timeProvider: () => 1_791_900_000_000 }, config)
		const result = onCronTrigger(runtime as any)
		expect(result).toContain('Settled 1 tabs')

		const [ids, currencies, rates, at] = decodeAbiParameters(keeperReportParams, payload!)
		expect(ids).toEqual([1n])
		expect(currencies.map((c) => hexToString(c))).toEqual(['PHP', 'NGN', 'INR', 'BRL', 'KES', 'EUR'])
		expect(rates[0]).toBe(62_757_000n)
		expect(at).toBe(1_791_900_000n)
	})

	test('registers one cron handler', () => {
		const handlers = initWorkflow(config)
		expect(handlers).toHaveLength(1)
		expect(handlers[0].fn).toBe(onCronTrigger)
	})
})
