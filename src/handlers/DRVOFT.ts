import { indexer, type EvmOnEventContext, type OFTMessage } from "envio";
import {
  CHAIN_TO_EID,
  EID_TO_CHAIN,
  ZERO_ADDRESS,
  accountId,
  allowanceId,
  bumpDaily,
  getGlobal,
  getTokenChain,
  lc,
  transferId,
} from "./shared";
 
function emptyOftMessage(guid: string): OFTMessage {
  return {
    id: guid,
    guid,
    status: "SENT",
    srcEid: undefined,
    dstEid: undefined,
    srcChainId: undefined,
    dstChainId: undefined,
    sender: undefined,
    recipient: undefined,
    amountSentLD: undefined,
    amountReceivedLD: undefined,
    sendChainId: undefined,
    receiveChainId: undefined,
    sendTxHash: undefined,
    receiveTxHash: undefined,
    sendLogId: undefined,
    receiveLogId: undefined,
  };
}

async function applyAccountTransfer(
  context: EvmOnEventContext,
  args: {
    chainId: number;
    token: string;
    address: string;
    delta: bigint;
    block: bigint;
    isMint: boolean;
    isBurn: boolean;
  },
): Promise<number> {
  const { chainId, token, address, delta, block, isMint, isBurn } = args;
  if (address === ZERO_ADDRESS) return 0;

  const id = accountId(chainId, token, address);
  const existing = await context.TokenAccount.get(id);
  const before = existing?.balance ?? 0n;
  const after = before + delta;

  let holderDelta = 0;
  if (existing === undefined) {
    holderDelta = after !== 0n ? 1 : 0;
    context.TokenAccount.set({
      id,
      token: lc(token),
      address: lc(address),
      balance: after,
      transferCount: 1n,
      totalMinted: isMint ? delta : 0n,
      totalBurned: isBurn ? -delta : 0n,
      totalOftSent: 0n,
      totalOftReceived: 0n,
      firstSeenBlock: block,
      lastActiveBlock: block,
    });
  } else {
    if (before === 0n && after !== 0n) holderDelta = 1;
    if (before !== 0n && after === 0n) holderDelta = -1;
    context.TokenAccount.set({
      ...existing,
      balance: after,
      transferCount: existing.transferCount + 1n,
      totalMinted: existing.totalMinted + (isMint ? delta : 0n),
      totalBurned: existing.totalBurned + (isBurn ? -delta : 0n),
      lastActiveBlock: block,
    });
  }
  return holderDelta;
}

indexer.onEvent(
  { contract: "DRVOFT", event: "Transfer" },
  async ({ event, context }) => {
    const { from, to, value } = event.params;
    const chainId = event.chainId;
    const token = event.srcAddress;
    const block = BigInt(event.block.number);
    const txHash = event.transaction.hash;
    const logIndex = event.logIndex;

    context.TokenTransfer.set({
      id: transferId(chainId, txHash, logIndex),
      token: lc(token),
      from: lc(from),
      to: lc(to),
      value,
      block,
      timestamp: BigInt(event.block.timestamp),
      txHash,
      logIndex,
    });

    const isMint = lc(from) === ZERO_ADDRESS;
    const isBurn = lc(to) === ZERO_ADDRESS;

    const [fromHolderDelta, toHolderDelta] = await Promise.all([
      applyAccountTransfer(context, {
        chainId,
        token,
        address: from,
        delta: -value,
        block,
        isMint: false,
        isBurn,
      }),
      applyAccountTransfer(context, {
        chainId,
        token,
        address: to,
        delta: value,
        block,
        isMint,
        isBurn: false,
      }),
    ]);

    const tc = await getTokenChain(context, chainId, token, block);
    const minted = isMint ? value : 0n;
    const burned = isBurn ? value : 0n;
    context.TokenChain.set({
      ...tc,
      totalMinted: tc.totalMinted + minted,
      totalBurned: tc.totalBurned + burned,
      totalSupply: tc.totalSupply + minted - burned,
      transferCount: tc.transferCount + 1n,
      holderCount: tc.holderCount + fromHolderDelta + toHolderDelta,
      lastBlock: block,
    });

    await bumpDaily(context, chainId, event.block.timestamp, {
      transferCount: 1n,
      transferVolume: value,
    });

    const g = await getGlobal(context);
    context.ProtocolGlobal.set({
      ...g,
      transferCount: g.transferCount + 1n,
      totalMinted: g.totalMinted + minted,
      totalBurned: g.totalBurned + burned,
      totalSupply: g.totalSupply + minted - burned,
    });
  },
);

indexer.onEvent(
  { contract: "DRVOFT", event: "Approval" },
  async ({ event, context }) => {
    const { owner, spender, value } = event.params;
    const chainId = event.chainId;
    const token = event.srcAddress;
    const block = BigInt(event.block.number);
    const txHash = event.transaction.hash;

    context.TokenApproval.set({
      id: transferId(chainId, txHash, event.logIndex),
      token: lc(token),
      owner: lc(owner),
      spender: lc(spender),
      value,
      block,
      timestamp: BigInt(event.block.timestamp),
      txHash,
    });

    context.Allowance.set({
      id: allowanceId(chainId, token, owner, spender),
      token: lc(token),
      owner: lc(owner),
      spender: lc(spender),
      amount: value,
      lastUpdatedBlock: block,
    });

    const tc = await getTokenChain(context, chainId, token, block);
    context.TokenChain.set({
      ...tc,
      approvalCount: tc.approvalCount + 1n,
      lastBlock: block,
    });

    await bumpDaily(context, chainId, event.block.timestamp, {
      approvalCount: 1n,
    });

    const g = await getGlobal(context);
    context.ProtocolGlobal.set({
      ...g,
      approvalCount: g.approvalCount + 1n,
    });
  },
);

indexer.onEvent(
  { contract: "DRVOFT", event: "OFTSent" },
  async ({ event, context }) => {
    const p = event.params;
    const chainId = event.chainId;
    const token = event.srcAddress;
    const block = BigInt(event.block.number);
    const txHash = event.transaction.hash;
    const guid = p.guid;
    const dstEid = Number(p.dstEid);
    const dstChainId = EID_TO_CHAIN[dstEid];
    const logId = `${chainId}_${event.block.number}_${event.logIndex}`;

    const existing = await context.OFTMessage.get(guid);
    const base = existing ?? emptyOftMessage(guid);
    const prevStatus = existing?.status;
    const hadReceive = base.receiveTxHash !== undefined;
    const status =
      base.status === "RECEIVED"
        ? "RECEIVED"
        : hadReceive
          ? "RECEIVED"
          : "SENT";

    // Status-partition counters: SENT / RECEIVED / ORPHAN must always sum to
    // OFTMessage row count. Late send against an orphan completes the message.
    const openedSent = existing === undefined;
    const orphanToReceived =
      status === "RECEIVED" && prevStatus === "ORPHAN_RECEIVE";
    const bridgeAdd = orphanToReceived ? (base.amountReceivedLD ?? 0n) : 0n;

    context.OFTMessage.set({
      ...base,
      guid,
      status,
      srcEid: CHAIN_TO_EID[chainId],
      dstEid,
      srcChainId: chainId,
      dstChainId: dstChainId ?? base.dstChainId,
      sender: lc(p.fromAddress),
      amountSentLD: p.amountSentLD,
      amountReceivedLD: base.amountReceivedLD ?? p.amountReceivedLD,
      sendChainId: chainId,
      sendTxHash: txHash,
      sendLogId: logId,
    });

    const senderId = accountId(chainId, token, p.fromAddress);
    const sender = await context.TokenAccount.get(senderId);
    if (sender !== undefined) {
      context.TokenAccount.set({
        ...sender,
        totalOftSent: sender.totalOftSent + p.amountSentLD,
        lastActiveBlock: block,
      });
    }

    const tc = await getTokenChain(context, chainId, token, block);
    context.TokenChain.set({
      ...tc,
      oftSentCount: tc.oftSentCount + 1n,
      oftSentVolume: tc.oftSentVolume + p.amountSentLD,
      lastBlock: block,
    });

    await bumpDaily(context, chainId, event.block.timestamp, {
      oftSentCount: 1n,
      oftSentVolume: p.amountSentLD,
    });

    const g = await getGlobal(context);
    context.ProtocolGlobal.set({
      ...g,
      oftSentCount: g.oftSentCount + 1n,
      oftMessageSentCount: g.oftMessageSentCount + (openedSent ? 1n : 0n),
      oftOrphanReceiveCount:
        g.oftOrphanReceiveCount - (orphanToReceived ? 1n : 0n),
      oftMessageReceivedCount:
        g.oftMessageReceivedCount + (orphanToReceived ? 1n : 0n),
      bridgeVolumeLD: g.bridgeVolumeLD + bridgeAdd,
    });
  },
);

indexer.onEvent(
  { contract: "DRVOFT", event: "OFTReceived" },
  async ({ event, context }) => {
    const p = event.params;
    const chainId = event.chainId;
    const token = event.srcAddress;
    const block = BigInt(event.block.number);
    const txHash = event.transaction.hash;
    const guid = p.guid;
    const srcEid = Number(p.srcEid);
    const srcChainId = EID_TO_CHAIN[srcEid];
    const logId = `${chainId}_${event.block.number}_${event.logIndex}`;

    const existing = await context.OFTMessage.get(guid);
    const base = existing ?? emptyOftMessage(guid);
    const hadSend = base.sendTxHash !== undefined;
    const prevStatus = existing?.status;
    const status =
      prevStatus === "RECEIVED"
        ? "RECEIVED"
        : hadSend
          ? "RECEIVED"
          : "ORPHAN_RECEIVE";

    // Partition transitions: SENT→RECEIVED decrements sent; new orphan opens
    // the orphan bucket; duplicate receives on an already-RECEIVED guid are no-ops.
    const sentToReceived =
      status === "RECEIVED" && prevStatus === "SENT";
    const becameOrphan =
      status === "ORPHAN_RECEIVE" && existing === undefined;
    const bridgeAdd = sentToReceived ? p.amountReceivedLD : 0n;

    context.OFTMessage.set({
      ...base,
      guid,
      status,
      srcEid,
      dstEid: base.dstEid ?? CHAIN_TO_EID[chainId],
      srcChainId: srcChainId ?? base.srcChainId,
      dstChainId: chainId,
      recipient: lc(p.toAddress),
      amountReceivedLD: p.amountReceivedLD,
      receiveChainId: chainId,
      receiveTxHash: txHash,
      receiveLogId: logId,
    });

    const recipientId = accountId(chainId, token, p.toAddress);
    const recipient = await context.TokenAccount.get(recipientId);
    if (recipient !== undefined) {
      context.TokenAccount.set({
        ...recipient,
        totalOftReceived: recipient.totalOftReceived + p.amountReceivedLD,
        lastActiveBlock: block,
      });
    }

    const tc = await getTokenChain(context, chainId, token, block);
    context.TokenChain.set({
      ...tc,
      oftReceivedCount: tc.oftReceivedCount + 1n,
      oftReceivedVolume: tc.oftReceivedVolume + p.amountReceivedLD,
      lastBlock: block,
    });

    await bumpDaily(context, chainId, event.block.timestamp, {
      oftReceivedCount: 1n,
      oftReceivedVolume: p.amountReceivedLD,
    });

    const g = await getGlobal(context);
    context.ProtocolGlobal.set({
      ...g,
      oftReceivedCount: g.oftReceivedCount + 1n,
      oftMessageSentCount: g.oftMessageSentCount - (sentToReceived ? 1n : 0n),
      oftMessageReceivedCount:
        g.oftMessageReceivedCount + (sentToReceived ? 1n : 0n),
      oftOrphanReceiveCount: g.oftOrphanReceiveCount + (becameOrphan ? 1n : 0n),
      bridgeVolumeLD: g.bridgeVolumeLD + bridgeAdd,
    });
  },
);
