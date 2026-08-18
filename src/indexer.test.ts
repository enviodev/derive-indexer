import { describe, it } from "vitest";
// Simulate respects each chain's start_block since envio 3.6 - keep simulated
// blocks above every configured start_block or items are silently unrouted.
const SIM = 300_000_000;
import { createTestIndexer, TestHelpers } from "envio";

const { Addresses } = TestHelpers;
const M = Addresses.mockAddresses;
const A = M[0]!;
const B = M[1]!;
const C = M[2]!;

const ZERO = "0x0000000000000000000000000000000000000000" as const;
const ETH_DRV = "0xb1d1eae60eea9525032a6dcb4c1ce336a1de71be";

// ===========================================================================
// PINNED REAL-DATA TESTS — first-seen blocks from spec-evidence.jsonl.
// Zero events decoded here means a wrong config signature.
// ===========================================================================
describe("DRV OFT · pinned real-data", () => {
  it("Ethereum first Transfer @ 21,224,782 decodes and seeds supply", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 1: { startBlock: 21_224_782, endBlock: 21_224_782 } },
    });

    const transfers = await indexer.TokenTransfer.getAll();
    t.expect(transfers.length, "Transfer signature decodes").toBeGreaterThan(0);

    const tc = await indexer.TokenChain.getOrThrow(`1-${ETH_DRV}`);
    t.expect(tc.transferCount).toBeGreaterThan(0n);

    const gs = await indexer.ProtocolGlobal.getOrThrow("global");
    t.expect(gs.transferCount).toBeGreaterThan(0n);
  });

  it("Ethereum first OFTSent @ 21,619,403 opens an OFTMessage", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 1: { startBlock: 21_619_403, endBlock: 21_619_403 } },
    });

    const messages = await indexer.OFTMessage.getAll();
    t.expect(messages.length, "OFTSent signature decodes").toBeGreaterThan(0);
    t.expect(messages[0]!.status).toBe("SENT");
    t.expect(messages[0]!.sendChainId).toBe(1);
    t.expect(messages[0]!.srcEid).toBe(30101);
  });

  it("Ethereum first OFTReceived @ 21,619,565 records receive leg", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 1: { startBlock: 21_619_565, endBlock: 21_619_565 } },
    });

    const messages = await indexer.OFTMessage.getAll();
    t.expect(messages.length, "OFTReceived signature decodes").toBeGreaterThan(0);
    const msg = messages[0]!;
    t.expect(["ORPHAN_RECEIVE", "RECEIVED"]).toContain(msg.status);
    t.expect(msg.receiveChainId).toBe(1);
  });

  it(
    "Optimism first Transfer @ 130,609,540 decodes on chain 10",
    async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 10: { startBlock: 130_609_540, endBlock: 130_609_540 } },
    });

    const tc = await indexer.TokenChain.getOrThrow(
      "10-0x33800de7e817a70a694f31476313a7c572bba100",
    );
    t.expect(tc.transferCount).toBeGreaterThan(0n);
  },
    180_000,
  );

  it("Base first Transfer @ 25,014,767 decodes on chain 8453", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: { 8453: { startBlock: 25_014_767, endBlock: 25_014_767 } },
    });

    const tc = await indexer.TokenChain.getOrThrow(
      "8453-0x9d0e8f5b25384c7310cb8c6ae32c8fbeb645d083",
    );
    t.expect(tc.transferCount).toBeGreaterThan(0n);
  });

  it("Arbitrum first Transfer @ 295,180,315 decodes on chain 42161", async (t) => {
    const indexer = createTestIndexer();
    await indexer.process({
      chains: {
        42161: { startBlock: 295_180_315, endBlock: 295_180_315 },
      },
    });

    const tc = await indexer.TokenChain.getOrThrow(
      "42161-0x77b7787a09818502305c95d68a2571f090abb135",
    );
    t.expect(tc.transferCount).toBeGreaterThan(0n);
  });
});

// ===========================================================================
// SIMULATE TESTS — handler arithmetic and OFT lifecycle transitions.
// ===========================================================================
describe("DRV OFT · simulated handler logic", () => {
  it("mint and burn update TokenChain supply and ProtocolGlobal", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "Transfer",
              params: { from: ZERO, to: A, value: 1000n },
              block: { number: SIM + 1000 },
            },
            {
              contract: "DRVOFT",
              event: "Transfer",
              params: { from: A, to: ZERO, value: 200n },
              block: { number: SIM + 1001 },
            },
          ],
        },
      },
    });

    const tc = await indexer.TokenChain.getOrThrow(`1-${ETH_DRV}`);
    t.expect(tc.totalMinted).toBe(1000n);
    t.expect(tc.totalBurned).toBe(200n);
    t.expect(tc.totalSupply).toBe(800n);

    const gs = await indexer.ProtocolGlobal.getOrThrow("global");
    t.expect(gs.totalSupply).toBe(800n);
  });

  it("holder balances track transfers", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "Transfer",
              params: { from: ZERO, to: A, value: 500n },
              block: { number: SIM + 2000 },
            },
            {
              contract: "DRVOFT",
              event: "Transfer",
              params: { from: A, to: B, value: 150n },
              block: { number: SIM + 2001 },
            },
          ],
        },
      },
    });

    const a = await indexer.TokenAccount.getOrThrow(`1-${ETH_DRV}-${A.toLowerCase()}`);
    const b = await indexer.TokenAccount.getOrThrow(`1-${ETH_DRV}-${B.toLowerCase()}`);
    t.expect(a.balance).toBe(350n);
    t.expect(b.balance).toBe(150n);
  });

  it("approval updates Allowance and counters", async (t) => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "Approval",
              params: { owner: A, spender: B, value: 42n },
              block: { number: SIM + 3000 },
            },
          ],
        },
      },
    });

    const allowance = await indexer.Allowance.getOrThrow(
      `1-${ETH_DRV}-${A.toLowerCase()}-${B.toLowerCase()}`,
    );
    t.expect(allowance.amount).toBe(42n);

    const gs = await indexer.ProtocolGlobal.getOrThrow("global");
    t.expect(gs.approvalCount).toBe(1n);
  });

  it("OFT send then receive completes message lifecycle", async (t) => {
    const indexer = createTestIndexer();
    const guid =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTSent",
              params: {
                guid,
                dstEid: 30184n,
                fromAddress: A,
                amountSentLD: 100n,
                amountReceivedLD: 99n,
              },
              block: { number: SIM + 4000 },
            },
          ],
        },
        8453: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTReceived",
              params: {
                guid,
                srcEid: 30101n,
                toAddress: B,
                amountReceivedLD: 99n,
              },
              block: { number: SIM + 5000 },
            },
          ],
        },
      },
    });

    const msg = await indexer.OFTMessage.getOrThrow(guid);
    t.expect(msg.status).toBe("RECEIVED");
    t.expect(msg.sendChainId).toBe(1);
    t.expect(msg.receiveChainId).toBe(8453);
    t.expect(msg.amountReceivedLD).toBe(99n);

    const gs = await indexer.ProtocolGlobal.getOrThrow("global");
    // SENT→RECEIVED must move the partition bucket, not leave a stale SENT count.
    t.expect(gs.oftMessageSentCount).toBe(0n);
    t.expect(gs.oftMessageReceivedCount).toBe(1n);
    t.expect(gs.oftOrphanReceiveCount).toBe(0n);
    t.expect(gs.bridgeVolumeLD).toBe(99n);
  });

  it("orphan then late send completes lifecycle and fixes partition counters", async (t) => {
    const indexer = createTestIndexer();
    const guid =
      "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    await indexer.process({
      chains: {
        8453: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTReceived",
              params: {
                guid,
                srcEid: 30101n,
                toAddress: B,
                amountReceivedLD: 77n,
              },
              block: { number: SIM + 8000 },
            },
          ],
        },
        1: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTSent",
              params: {
                guid,
                dstEid: 30184n,
                fromAddress: A,
                amountSentLD: 77n,
                amountReceivedLD: 77n,
              },
              block: { number: SIM + 8001 },
            },
          ],
        },
      },
    });

    const msg = await indexer.OFTMessage.getOrThrow(guid);
    t.expect(msg.status).toBe("RECEIVED");
    t.expect(msg.sendChainId).toBe(1);
    t.expect(msg.receiveChainId).toBe(8453);

    const gs = await indexer.ProtocolGlobal.getOrThrow("global");
    // ORPHAN→RECEIVED must decrement orphan and credit bridge volume once.
    t.expect(gs.oftOrphanReceiveCount).toBe(0n);
    t.expect(gs.oftMessageReceivedCount).toBe(1n);
    t.expect(gs.oftMessageSentCount).toBe(0n);
    t.expect(gs.bridgeVolumeLD).toBe(77n);
  });

  it("late receive after sent does not downgrade a completed message", async (t) => {
    const indexer = createTestIndexer();
    const guid =
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

    await indexer.process({
      chains: {
        1: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTSent",
              params: {
                guid,
                dstEid: 30111n,
                fromAddress: A,
                amountSentLD: 50n,
                amountReceivedLD: 50n,
              },
              block: { number: SIM + 6000 },
            },
          ],
        },
        10: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTReceived",
              params: {
                guid,
                srcEid: 30101n,
                toAddress: B,
                amountReceivedLD: 50n,
              },
              block: { number: SIM + 6001 },
            },
            {
              contract: "DRVOFT",
              event: "OFTReceived",
              params: {
                guid,
                srcEid: 30101n,
                toAddress: C,
                amountReceivedLD: 50n,
              },
              block: { number: SIM + 6002 },
            },
          ],
        },
      },
    });

    const msg = await indexer.OFTMessage.getOrThrow(guid);
    t.expect(msg.status).toBe("RECEIVED");
    t.expect(msg.recipient).toBe(C.toLowerCase());
  });

  it("orphan receive without prior send is ORPHAN_RECEIVE", async (t) => {
    const indexer = createTestIndexer();
    const guid =
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    await indexer.process({
      chains: {
        42161: {
          simulate: [
            {
              contract: "DRVOFT",
              event: "OFTReceived",
              params: {
                guid,
                srcEid: 30101n,
                toAddress: A,
                amountReceivedLD: 10n,
              },
              block: { number: SIM + 7000 },
            },
          ],
        },
      },
    });

    const msg = await indexer.OFTMessage.getOrThrow(guid);
    t.expect(msg.status).toBe("ORPHAN_RECEIVE");

    const gs = await indexer.ProtocolGlobal.getOrThrow("global");
    t.expect(gs.oftOrphanReceiveCount).toBe(1n);
    t.expect(gs.bridgeVolumeLD).toBe(0n);
  });
});
