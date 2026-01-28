# BTMS Tokens

These tokens are defined by a UTXO-based protocol on top of PushDrop.

First the asset ID is pushed, in the format <txid>.<vout> (hex dot dec) or 'ISSUE" for new assets.

Then the amount is pushed.

Optionally, metadata is pushed. If pushed in the issuance, it must be maintained in all future outputs.

Then the fields are dropped and the P2PK locking script follows.

You can start a new coin by ISSUEing an amount. Then in a subsequent transaction, spend the output as an input, and include the asset ID in any outputs.

The rule is that you cannot have outputs with amounts that total to more than the inputs you are spending from, for any given asset.

The number of satoshis in each output must be at least 1, but beyond that it is not considered.
