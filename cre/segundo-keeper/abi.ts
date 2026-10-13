import { parseAbi, parseAbiParameters } from 'viem'

// The two Till views the workflow reads. Till is the contract deployed under Segundo's working name;
// the full ABI lives in web/lib/abi.ts.
export const tillAbi = parseAbi([
	'function tabCount() view returns (uint256)',
	'function getTabs(uint256[] ids) view returns ((uint256 id, (address payer, uint64 rate, bool held, bool closed, address payee, uint64 since, address invite, uint64 lastBlock, uint128 budget, uint128 banked, uint128 paid) tab, uint256 earned, uint256 owed, uint256 runway)[] out)',
])

// SegundoKeeper.onReport decodes exactly this.
export const keeperReportParams = parseAbiParameters(
	'uint256[] ids, bytes3[] currencies, uint64[] ratesE6, uint64 at',
)

export const keeperAbi = parseAbi([
	'function rateOf(bytes3 currency) view returns (uint64 rateE6, uint64 at)',
	'function lastReportAt() view returns (uint64)',
	'function onReport(bytes metadata, bytes report)',
])
