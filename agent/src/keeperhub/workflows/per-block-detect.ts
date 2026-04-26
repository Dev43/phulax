import type { Address } from "viem";
import { config } from "../../config.js";

/**
 * KeeperHub workflow definition for the per-block detection loop (todo §7.4).
 *
 * Trigger:    Block (every block on 0G chain)
 * Step 1:     web3/query-transactions
 *             contractAddress = FakeLendingPool
 *             fromBlock = toBlock = trigger.blockNumber
 *             Returns 0..N decoded txs hitting our pool that block.
 * Step 2:     HTTP Request → agent /detect-batch
 *             Posts the tx array; agent runs detection + aggregator and
 *             returns the max score + decision.
 * Step 3:     Conditional → 0g-storage/logAppend (always)
 *                          → web3/sendTransaction (only if fire == true)
 *
 * NB: we deliberately don't write a per-tx trigger — todo §7.4 locks the
 * decision. Block + query-transactions covers the use case with zero new
 * trigger plumbing.
 */
export interface WorkflowSpec {
  name: string;
  description: string;
  trigger: {
    type: "Block";
    chain: string;
    everyN: number;
  };
  steps: WorkflowStep[];
}

type WorkflowStep =
  | {
      id: string;
      plugin: "web3";
      action: "query-transactions";
      params: {
        chain: string;
        contractAddress: Address;
        // KeeperHub `abi-with-auto-fetch` — explorer-fetched at run time.
        // We ship contracts/abis/FakeLendingPool.json as a fallback (todo §5).
        abi: { kind: "abi-with-auto-fetch"; address: Address };
        fromBlock: string;
        toBlock: string;
      };
    }
  | {
      id: string;
      plugin: "http";
      action: "request";
      params: {
        url: string;
        method: "POST";
        body: { txs: string };
      };
    }
  | {
      id: string;
      plugin: "0g-storage";
      action: "logAppend";
      params: {
        log: "phulax.incidents";
        entry: string;
      };
    }
  | {
      id: string;
      plugin: "web3";
      action: "sendTransaction";
      condition: string;
      params: {
        chain: string;
        to: string;
        // Hardcoded selector + adapter — agent path is single-selector.
        data: string;
      };
    };

export function buildPerBlockDetectWorkflow(args: {
  pool: Address;
  account: Address;
  agentServerUrl: string;
}): WorkflowSpec {
  const chain = "0G";
  return {
    name: `phulax.detect.${args.account}`,
    description: "Per-block detection + conditional withdraw for one Phulax account",
    trigger: { type: "Block", chain, everyN: 1 },
    steps: [
      {
        id: "queryTxs",
        plugin: "web3",
        action: "query-transactions",
        params: {
          chain,
          contractAddress: args.pool,
          abi: { kind: "abi-with-auto-fetch", address: args.pool },
          fromBlock: "{{trigger.blockNumber}}",
          toBlock: "{{trigger.blockNumber}}",
        },
      },
      {
        id: "detect",
        plugin: "http",
        action: "request",
        params: {
          url: `${args.agentServerUrl}/detect-batch`,
          method: "POST",
          body: { txs: "{{queryTxs.transactions}}" },
        },
      },
      {
        id: "logIncident",
        plugin: "0g-storage",
        action: "logAppend",
        params: { log: "phulax.incidents", entry: "{{detect.body}}" },
      },
      {
        id: "withdraw",
        plugin: "web3",
        action: "sendTransaction",
        condition: "{{detect.body.fire}} == true",
        params: {
          chain,
          to: args.account,
          // selector("withdraw(address)") = 0x51cff8d9; adapter passed by agent.
          data: "{{detect.body.withdrawCalldata}}",
        },
      },
    ],
  };
}

/** For the demo, a top-level config knob to dump the JSON. */
export function exampleSpec(): WorkflowSpec {
  return buildPerBlockDetectWorkflow({
    pool: config().pool,
    account: "0x0000000000000000000000000000000000000000",
    agentServerUrl: `http://localhost:${config().serverPort}`,
  });
}
