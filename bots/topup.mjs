/**
 * Moves test MON between the project's own gas wallets, e.g. from the faucet/deployer wallet to the
 * relayer (keeper) when it runs low. Usage: node bots/topup.mjs keeper=10   (amounts in MON)
 */
import fs from "node:fs";
import { createPublicClient, createWalletClient, defineChain, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const RPC = "https://testnet-rpc.monad.xyz";
const keys = JSON.parse(fs.readFileSync(process.env.KEYS || "keys/wallets.json", "utf8"));
const chain = defineChain({ id: 10143, name: "Monad Testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const from = privateKeyToAccount(keys[process.env.FROM || "deployer"].privateKey);
const wallet = createWalletClient({ account: from, chain, transport: http(RPC) });

for (const arg of process.argv.slice(2)) {
  const [name, amount] = arg.split("=");
  const to = keys[name].address || privateKeyToAccount(keys[name].privateKey).address;
  const hash = await wallet.sendTransaction({ to, value: parseEther(amount), gas: 21_000n });
  const rc = await pub.waitForTransactionReceipt({ hash });
  console.log(name, amount, "MON", rc.status, hash);
  console.log(`  ${name} now ${formatEther(await pub.getBalance({ address: to }))} MON, ${process.env.FROM || "deployer"} now ${formatEther(await pub.getBalance({ address: from.address }))} MON`);
}
