import type { EvmOnEventContext, ProtocolGlobal, TokenChain } from "envio";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const GLOBAL_ID = "global";

/**
 * LayerZero V2 endpoint id → EVM chain id for the four demo chains.
 * Unmapped eids are stored on OFTMessage rows with undefined chain labels.
 */
export const EID_TO_CHAIN: Record<number, number> = {
  30101: 1,
  30110: 42161,
  30111: 10,
  30184: 8453,
};

export const CHAIN_TO_EID: Record<number, number> = {
  1: 30101,
  42161: 30110,
  10: 30111,
  8453: 30184,
};
 
export function lc(address: string): string {
  return address.toLowerCase();
}

export function transferId(
  chainId: number,
  txHash: string,
  logIndex: number,
): string {
  return `${chainId}-${txHash}-${logIndex}`;
}

export function eventLogId(
  chainId: number,
  block: number,
  logIndex: number,
): string {
  return `${chainId}_${block}_${logIndex}`;
}

export function accountId(
  chainId: number,
  token: string,
  address: string,
): string {
  return `${chainId}-${lc(token)}-${lc(address)}`;
}

export function tokenChainId(chainId: number, token: string): string {
  return `${chainId}-${lc(token)}`;
}

export function allowanceId(
  chainId: number,
  token: string,
  owner: string,
  spender: string,
): string {
  return `${chainId}-${lc(token)}-${lc(owner)}-${lc(spender)}`;
}

export function dayId(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

export function dailyStatId(chainId: number, timestampSeconds: number): string {
  return `${chainId}-${dayId(timestampSeconds)}`;
}

const EMPTY_GLOBAL: ProtocolGlobal = {
  id: GLOBAL_ID,
  transferCount: 0n,
  approvalCount: 0n,
  oftSentCount: 0n,
  oftReceivedCount: 0n,
  oftMessageSentCount: 0n,
  oftMessageReceivedCount: 0n,
  oftOrphanReceiveCount: 0n,
  bridgeVolumeLD: 0n,
  totalMinted: 0n,
  totalBurned: 0n,
  totalSupply: 0n,
};

export async function getGlobal(
  context: EvmOnEventContext,
): Promise<ProtocolGlobal> {
  const g = await context.ProtocolGlobal.get(GLOBAL_ID);
  return g ?? EMPTY_GLOBAL;
}

export async function getTokenChain(
  context: EvmOnEventContext,
  chainId: number,
  token: string,
  block: bigint,
): Promise<TokenChain> {
  return context.TokenChain.getOrCreate({
    id: tokenChainId(chainId, token),
    token: lc(token),
    totalSupply: 0n,
    totalMinted: 0n,
    totalBurned: 0n,
    transferCount: 0n,
    approvalCount: 0n,
    oftSentCount: 0n,
    oftReceivedCount: 0n,
    oftSentVolume: 0n,
    oftReceivedVolume: 0n,
    holderCount: 0,
    firstBlock: block,
    lastBlock: block,
  });
}

type DailyDelta = Partial<{
  transferCount: bigint;
  transferVolume: bigint;
  approvalCount: bigint;
  oftSentCount: bigint;
  oftSentVolume: bigint;
  oftReceivedCount: bigint;
  oftReceivedVolume: bigint;
}>;

export async function bumpDaily(
  context: EvmOnEventContext,
  chainId: number,
  timestampSeconds: number,
  delta: DailyDelta,
): Promise<void> {
  const id = dailyStatId(chainId, timestampSeconds);
  const day = dayId(timestampSeconds);
  const d = await context.DailyChainStat.getOrCreate({
    id,
    day,
    transferCount: 0n,
    transferVolume: 0n,
    approvalCount: 0n,
    oftSentCount: 0n,
    oftSentVolume: 0n,
    oftReceivedCount: 0n,
    oftReceivedVolume: 0n,
  });
  context.DailyChainStat.set({
    ...d,
    transferCount: d.transferCount + (delta.transferCount ?? 0n),
    transferVolume: d.transferVolume + (delta.transferVolume ?? 0n),
    approvalCount: d.approvalCount + (delta.approvalCount ?? 0n),
    oftSentCount: d.oftSentCount + (delta.oftSentCount ?? 0n),
    oftSentVolume: d.oftSentVolume + (delta.oftSentVolume ?? 0n),
    oftReceivedCount: d.oftReceivedCount + (delta.oftReceivedCount ?? 0n),
    oftReceivedVolume: d.oftReceivedVolume + (delta.oftReceivedVolume ?? 0n),
  });
}
