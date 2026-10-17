import { createPublicClient, fallback, http, type PublicClient } from "viem";

// Every host below must also be added under Network access in the PayBox developer portal.
export const BASE_RPCS = ["https://mainnet.base.org", "https://base.drpc.org", "https://base-rpc.publicnode.com"];
export const SABLIER_INDEXER = "https://indexer.hyperindex.xyz/53b7e25/v1/graphql";
export const GASZIP_API = "https://backend.gas.zip";

// Sablier Lockup v4.0 on Base (docs.sablier.com/guides/lockup/deployments). Non-upgradeable.
export const SABLIER_LOCKUP = "0xc19a09A66887017F603E5dF420ed3Cb9a5c07C0A" as const;
export const UNDO_SHAPE = "lifeguard-undo";

export const BASE_TOKENS: Record<string, `0x${string}`> = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};
export const STABLES = new Set(["USDC", "USDT", "USDT0", "USD₮0", "USDt", "DAI", "USDBC"]);

export type Chain = {
  key: string; name: string; id: number; rpc: string; native: string;
  tokens: { symbol: string; address: `0x${string}` }[];
};

// Addresses checked on-chain (symbol and decimals) on 2026-10-17.
export const CHAINS: Chain[] = [
  { key: "ethereum", name: "Ethereum", id: 1, rpc: "https://eth.drpc.org", native: "ETH", tokens: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" }] },
  { key: "arbitrum", name: "Arbitrum", id: 42161, rpc: "https://arbitrum.drpc.org", native: "ETH", tokens: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9" }] },
  { key: "optimism", name: "Optimism", id: 10, rpc: "https://optimism.drpc.org", native: "ETH", tokens: [
    { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
    { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58" }] },
  { key: "polygon", name: "Polygon", id: 137, rpc: "https://polygon.drpc.org", native: "POL", tokens: [
    { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" }] },
  { key: "bsc", name: "BNB Chain", id: 56, rpc: "https://bsc-dataseed.bnbchain.org", native: "BNB", tokens: [
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955" }] },
  { key: "avalanche", name: "Avalanche", id: 43114, rpc: "https://avalanche.drpc.org", native: "AVAX", tokens: [
    { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E" },
    { symbol: "USDT", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7" }] },
  { key: "linea", name: "Linea", id: 59144, rpc: "https://linea.drpc.org", native: "ETH", tokens: [
    { symbol: "USDC", address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff" }] },
  { key: "scroll", name: "Scroll", id: 534352, rpc: "https://scroll.drpc.org", native: "ETH", tokens: [
    { symbol: "USDC", address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4" }] },
];

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as const; // same address on every chain listed here

// Each tool call has a 10-second budget, so every request is bounded well inside it.
// Reads made together are batched into one Multicall3 call: free nodes throttle bursts of parallel requests.
export function client(rpc: string | string[]): PublicClient {
  const urls = Array.isArray(rpc) ? rpc : [rpc];
  const transport = urls.length > 1
    ? fallback(urls.map(u => http(u, { timeout: 3000, retryCount: 0 })))
    : http(urls[0], { timeout: 4000, retryCount: 1 });
  return createPublicClient({
    transport,
    batch: { multicall: { wait: 16 } },
    chain: { id: 0, name: "", nativeCurrency: { name: "", symbol: "", decimals: 18 }, rpcUrls: { default: { http: urls } }, contracts: { multicall3: { address: MULTICALL3 } } } as any,
  }) as PublicClient;
}

export const base = () => client(BASE_RPCS);

export async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(4500) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}
