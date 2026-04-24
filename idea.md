# PHULAX 

A withdraw-only agent for Ethereum yield/lending protocols (Aave, Compound, Morpho, Radiant, Pendle, etc.) that evacuates user funds when a transaction is flagged as nefarious. The detector is a model fine-tuned on 0G that classifies incoming txns as malicious or benign. Also uses other signals (subscribes to new blocks, scores each tx against the index, combines with invariant/oracle/liquidity/social signals, emits a per-protocol risk number).

1) We add 0G chain to Keeperhub - the repo has an "Add Chain" skill that will help us. This should be a PR to the main chain
2) We create a plugin or protocol (tbd on which makes the more sense) to allow people to store things and retrieve them using 0g storage
3) We create a plugin or protocol to allow user to use the 0g inference
4) We train (fine tune) the 0g model with a corpus of data showing some example nefarious transactions. Need to gather data for this. This data can then be stored in 0g storage for later retrieval or we can keep it to ourselves.
5) We create all of the Smart Contracts:

A) INFT smart contract for our agent. Has all inft functions. Has a deposit function where a user deposits funds to it, it takes a share, and forwards the deposit to the treasurer contract. The treasurer contract is in charge on depositing the funds to the yield protocol (aave). The agent when it receives money takes a fee and creates a smart contract for the user (or a smart contract is already deployed that he controls). There could be a fee % based on the APY of the lending pool.

B) Treasurer contract. This contract interacts with the lending/yield protocol. It allows the bot to deposit for a user and withdraw for a user. 

C) Create a fake lending protocol pool with vulnerabilities. We will fake the APY of the pool and when we send a nefarious transaction to it, our agent will recognize that the lending protocol is being attacked and it will withdraw all funds to protect the user. Example: it is losing over 5% of the pool, in 1 txn, that **could** be a draining txn, our agent will need to figure that out.

6) Create a keeperhub workflow that will be watching our vault and running the inference as needed on new txns to it. This workflow should work everytime there is a txn that goes to the lending protocol
7) Create a frontend that will show the current positions in the lending protocol, the txns that flow through it and the agent's decision whether to remove or not.
7) Wire everything up so a user can simply send some 0g to the agent, the agent smart contract delivers it to the lending protocol and the agent keeps watching the protocol


Stretch goals:
- Create an INFT creation flow in Keeperhub (the inft is in charge of the model)
- Create a fine tuning flow in Keeperhub
- Have an agent scour twitter for knowledge of a hack on defi. If they do they immediately remove the funds.