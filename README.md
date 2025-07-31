# Rust Dex

Rust Dex is an orderbook-based DEX (Decentralized Exchange) smart contract implemented using the Solana Anchor framework. It enables decentralized token trading through on-chain order matching and settlement.

## Features

- Orderbook-based design
- Support for multiple tokens, users, and orders
- Support limited/market orders
- Support cancelling orders
- Support fully-filled & partially-filled orders

## Installation

### Prerequisites

Ensure you have the following installed:
- **Rust**: Install from [Rust official website](https://rustup.rs/)
- **Solana CLI**: Install from [Solana official website](https://docs.solana.com/cli/install-solana-cli-tools)
- **Anchor CLI**: Install via cargo

### Clone the Repository

```bash
git clone https://github.com/YoungY620/rust-dex
cd rust-dex
```

### Install Dependencies

#### 1. Install Rust (if not already installed)

#### 2. Install Solana CLI

#### 3. Install Anchor CLI
```bash
avm install latest
avm use latest
```

#### 4. Install Node.js Dependencies (for TypeScript tests)
```bash
npm install
```

### Build the Project

```bash
anchor build
```

### Run Tests

#### Automatic local validator (recommended)
```bash
anchor test                 # Run all tests
anchor end-to-end-complete  # Run the end-to-end test (scenarios 1)
anchor limit-order-cancel   # Run the end-to-end test (scenarios 2)
```


## System Architecture Overview

### Core Accounts

- **DexManager**: Global DEX configuration management
- **TokenPairAccount**: Trading pair order queue (heap structure)
- **VaultTokenLedger**: Token vault ledger
- **UserOrderbook**: User personal order book
- **IndividualTokenLedger**: User single-token balance management
- **EventList**: Trading event queue

### PDA Seed Rules
```rust
// DEX Manager
["dex_manager"] -> DexManagerPda

// Token Vault Related
["vault_token_ledger", mint] -> VaultTokenLedgerPda
["vault_token_account", mint] -> VaultTokenAuthorityPda // used for signature for vault token account

// Trading Pair Queue
["token_pair", base_mint, quote_mint] -> TokenPairPda

// User Related
["user_ledger", user_pubkey] -> UserLedgerPda
["user_orderbook", user_pubkey] -> UserOrderbookPda
["order_events", user_pubkey] -> UserEventsPda
["individual_token_ledger", mint, user_pubkey] -> UserTokenLedgerPda
```

### Traits & Core Components

#### OrderHeap

OrderHeap is a trait for managing order queues, defining the basic operations interface for the order heap. OrderHeapImpl is a concrete implementation based on heap sort algorithm.

##### Public Methods

The OrderHeap trait defines the following public methods:

1. `add_order(&mut self, order: OrderNode) -> Result<()>` - Add a new order to the heap
2. `remove_order(&mut self, id: u64) -> Result<OrderNode>` - Remove an order by ID from the heap
3. `get_best_order(&self) -> Option<&OrderNode>` - Get the best order (top of heap)
4. `get_best_order_mut(&mut self) -> Option<&mut OrderNode>` - Get mutable reference to the best order
5. `len(&self) -> usize` - Get the number of orders in the heap
6. `get_order_by_id(&self, id: u64) -> Option<&OrderNode>` - Find an order by ID

##### OrderHeapImpl Implementation

OrderHeapImpl is a concrete implementation of the OrderHeap trait based on heap sort algorithm:

1. **Data Structure**:
   - `orders`: Fixed-size array storing OrderNode objects
   - `size`: Current number of orders

2. **Add Order**:
   - Insert new order at the end of array
   - Maintain heap property by comparing with parent nodes (upward adjustment)

3. **Remove Order**:
   - Find order index by ID
   - Replace found order with last order in array
   - Mark last slot as invalid
   - Maintain heap property by comparing with child nodes (downward adjustment)

4. **Heap Properties**:
   - Top element is always the "greatest" order (per OrderNode comparison logic)
   - Add operation time complexity: O(log n)
   - Removing pop best order: time complexity: O(log n)
   - Removing random order: time complexity: O(n)
   - Get best order time complexity: O(1)

#### OrderNode

The OrderNode class represents an order in the OrderHeap. It contains the order details and implements the necessary methods for the heap operations.

```rust
pub struct OrderNode {
    pub id: u64,
    pub buy_quantity: u64,
    pub sell_quantity: u64,
    pub buy_token: Pubkey,
    pub sell_token: Pubkey,
    pub owner: Pubkey,
    pub timestamp: i64,
}

pub struct OrderHeapImpl {
    pub orders: [OrderNode; ORDER_HEAP_CAPACITY], 
    pub bitmap: [u8; ORDER_HEAP_CAPACITY],  
    pub size: u64,
}
```

The OrderNode contains no information about the order's side. So, the same order heap can be used for both buy and sell orders.

#### OrderBook

OrderBook is a core component that manages buy and sell order queues for a specific trading pair. It handles order matching logic for both limit and market orders.

##### Key Functions

1. `process_order(&mut self, order: OrderRequest) -> OrderProcessResult` - Process incoming orders, including matching against existing orders
2. `process_limit_order()` - Handle limit order placement and matching logic
3. `process_market_order()` - Handle market order matching logic

##### Order Matching Logic

1. **Limit Orders**:
   - Buy limit orders are added to the buy queue (max-heap based on price)
   - Sell limit orders are added to the sell queue (min-heap based on price, but also max-heap if priced by the opposite-side token)
   - When a new limit order is placed, it attempts to match with existing opposite orders
   - Matching continues until the order is fully filled or no more matching orders exist
   - If the newly-comming order is partially matched, the remaining portion remains in the order book

2. **Market Orders**:
   - Match immediately with existing orders in the opposite queue
   - Buy market orders match with sell queue orders
   - Sell market orders match with buy queue orders
   - Execute at the price of existing orders in the queue
   - If the newly-comming order is partially matched, the remaining portion will be dropped, and a 'no matching' event will be emitted.

##### Order Storage and Logic Separation

The OrderBook follows a clear separation between data storage and business logic:
- Data is stored in OrderHeap structures for efficient order management
- Business logic is implemented in the MatchingEngine which operates on the OrderHeap structures
- When placing a new order, 2 OrderHeap instances are passed to the MatchingEngine constructor to create a new OrderBook instance
- This design allows for clear separation of concerns and easier testing of matching logic

## Security Design: Reentrancy Attack

The system implements multiple mechanisms to prevent reentrancy attacks:

### 1. State Update Before Transfer Principle

- **Deposit Flow**: Execute `token::transfer()` to complete fund transfer first, then update user and pool balance states
- **Withdrawal Flow**: Check and deduct user's available balance first, then execute `token::transfer()` to complete fund withdrawal
- **Order Processing**: Immediately lock the corresponding token amount before placing orders (`available_balance → locked_balance`), perform actual transfers only after matching is complete

### 2. Balance Locking Mechanism

- Uses a dual-balance model: `available_balance` (available balance) and `locked_balance` (locked balance)
- When placing orders: Deduct from `available_balance` and add to `locked_balance`
- **Order Completion/Cancellation**: When orders are filled or cancelled, funds are released from `locked_balance` and either allocated to `available_balance` (for successful trades) or returned to the user's available balance (for cancellations)
- **Withdrawal Restrictions**: Users can only withdraw from their `available_balance`; locked funds remain inaccessible until order resolution

### 3. Event-Driven Architecture

- Order matching generates events, final fund transfers occur only when events are consumed
- **Event Atomicity**: Events are removed from the queue before processing in the `consume_events` instruction, ensuring each event is processed exactly once and preventing duplicate consumption
- **Atomic Trade Processing**: Each trade matching and its corresponding asset transfers (including internal exchange transfers of both tokens) are processed atomically within a single event-consuming instruction, ensuring trade settlement consistency

This design ensures that even if reentrancy attacks occur, attackers cannot exploit system state inconsistencies for profit.

## Usage: Complete Interaction Flow

### Overview

Following document details the complete interaction flow of the system, including two core scenarios:

1. **Complete Trading Flow**: From system initialization to order matching and event processing, test code: [tests/end-to-end-complete.test.ts](tests/end-to-end-complete.test.ts)
2. **Partial Matching and Order Cancellation Flow**: Demonstrates order partial matching and remaining order cancellation mechanisms, test code: [tests/limit-order-cancel.test.ts](tests/end-to-end-complete.test.ts)

### Process 1: Complete Trading Flow (Market Matching)

#### 1. System Initialization Phase

##### 1.1 Account and Token Creation

```typescript
// Create key accounts
mintAuthority = Keypair.generate();
user1 = Keypair.generate();
user2 = Keypair.generate();
vault = Keypair.generate();

// Create tokens
token1Mint = await createMint(connection, mintAuthority, mintAuthority.publicKey, null, 9);
token2Mint = await createMint(connection, mintAuthority, mintAuthority.publicKey, null, 6);

// Mint tokens for users
await mintTo(connection, mintAuthority, token1Mint, user1Token1Account, mintAuthority, 10000 * 10**9);
await mintTo(connection, mintAuthority, token2Mint, user1Token2Account, mintAuthority, 100000 * 10**6);
```

##### 1.2 DEX System Initialization
```typescript
// Initialize DEX manager
await program.methods.initialize()
  .accountsPartial({
    dexManager: dexManagerPda,
    user: user1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user1])
  .rpc();
```

**Rust Contract Call**: `initialize` instruction creates global DEX configuration

#### 2. Infrastructure Registration Phase

##### 2.1 Token Vault Registration
```typescript
// Register token1 vault
await program.methods.registerVaultTokenLedger()
  .accountsPartial({
    vaultTokenLedger: vaultToken1LedgerPda,
    vaultTokenAuthority: vaultToken1AuthorityPda,
    mintAccount: token1Mint,
    vaultTokenAccount: vaultToken1Account,
    user: vault.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .signers([vault, vaultToken1AccountKeypair])
  .rpc();
```

**Function**: Create custody accounts for each token to store user deposits

##### 2.2 Trading Pair Registration
```typescript
await program.methods.registerTokenPair(token1Mint, token2Mint)
  .accountsPartial({
    user: user1.publicKey,
    systemProgram: SystemProgram.programId,
    tokenPair: token1Token2QueuePda,
    oppositePair: token2Token1QueuePda,
  })
  .signers([user1])
  .rpc();
```

**Function**: Create bidirectional trading pair queues, supporting token1→token2 and token2→token1 trades

##### 2.3 User Registration
```typescript
await program.methods.registerUser()
  .accountsPartial({
    individualLedger: user1LedgerPda,
    userOrderBook: user1OrderbookPda,
    orderEvents: user1EventsPda,
    user: user1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user1])
  .rpc();
```

**Function**: Create personal ledger, order book, and event queue for users

##### 2.4 User Token Ledger Registration
```typescript
await program.methods.registerUserTokenLedger(token1Mint)
  .accountsPartial({
    userTokenLedger: user1Token1LedgerPda,
    mintAccount: token1Mint,
    userTokenAccount: user1Token1Account,
    user: user1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user1])
  .rpc();
```

**Function**: Create balance tracking ledger for each user's token

#### 3. Fund Management Phase

##### 3.1 Token Deposit
```typescript
await program.methods.deposit(token1Mint, new anchor.BN(1000 * 10**9))
  .accountsPartial({
    vaultTokenLedger: vaultToken1LedgerPda,
    userTokenLedger: user1Token1LedgerPda,
    userTokenAccount: user1Token1Account,
    vaultTokenAccount: vaultToken1Account,
    tokenProgram: TOKEN_PROGRAM_ID,
    user: user1.publicKey,
    systemProgram: SystemProgram.programId
  })
  .signers([user1])
  .rpc();
```

**Function**: Transfer tokens from user wallet to DEX vault, update user's available balance in DEX

#### 4. Trade Execution Phase

##### 4.1 Limit Order
```typescript
// User1 places sell order: 10 token1 for 1 token2
await program.methods.placeLimitOrder(token1Mint, token2Mint, "sell", 1, new anchor.BN(10 * 10**9))
  .accountsPartial({
    baseQuoteQueue: token1Token2QueuePda,
    quoteBaseQueue: token2Token1QueuePda,
    dexManager: dexManagerPda,
    orderEvents: user1EventsPda,
    userBaseTokenLedger: user1Token1LedgerPda,
    userQuoteTokenLedger: user1Token2LedgerPda,
    userOrderbook: user1OrderbookPda,
    user: user1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user1])
  .rpc();
```

**Function**: 
- Lock user's 10 token1
- Add order to token2→token1 queue
- Update user order book

##### 4.2 Market Order
```typescript
// User2 places buy order: buy 10 token1
await program.methods.placeMarketOrder(token1Mint, token2Mint, "buy", new anchor.BN(10 * 10**9))
  .accountsPartial({
    baseQuoteQueue: token1Token2QueuePda,
    quoteBaseQueue: token2Token1QueuePda,
    dexManager: dexManagerPda,
    orderEvents: user2EventsPda,
    userBaseTokenLedger: user2Token1LedgerPda,
    userQuoteTokenLedger: user2Token2LedgerPda,
    userOrderbook: user2OrderbookPda,
    user: user2.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user2])
  .rpc();
```

**Function**:
- Match user1's limit sell order
- Generate trade events

#### 5. Event Processing Phase

##### 5.1 Consuming Trade Events
```typescript
// Process user1's events (seller)
await program.methods.consumeEvents(user2.publicKey) // Counterparty is user2
  .accountsPartial({
    eventList: user1EventsPda,
    userTokenIncomeLedger: user1Token2LedgerPda,    // User1 receives token2
    userTokenOutcomeLedger: user1Token1LedgerPda,   // User1 spends token1
    oppositeUserTokenIncomeLedger: user2Token1LedgerPda, // User2 receives token1
    oppositeUserTokenOutcomeLedger: user2Token2LedgerPda, // User2 spends token2
    user: user1.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([user1])
  .rpc();
```

**Function**:
- Release locked tokens
- Update both parties' available balances
- Complete actual token transfers

#### 6. Final State Verification

```typescript
// Verify trade results
const user1Token1Change = user1Token1LedgerAfter.availableBalance.toNumber() - user1Token1LedgerBefore.availableBalance.toNumber();
const user2Token1Change = user2Token1LedgerAfter.availableBalance.toNumber() - user2Token1LedgerBefore.availableBalance.toNumber();

expect(user1Token1Change).to.equal(-10 * 10**9); // User1 decreases by 10 token1
expect(user2Token1Change).to.equal(10 * 10**9);   // User2 increases by 10 token1
```

### Process 2: Partial Matching and Order Cancellation Flow

#### 0. System Setup & User Registration

This part is the same as Process 1's Step 1~3.

#### 1. Partial Order Matching Scenario


##### 1.1 Limit Order from User1 (Sell 10 token1 for 1 token2 per token1)
```typescript
    const user1SellAmount = 10 * 10 ** 9; // 10 token1
    const user1SellPrice = 1; // 1 token2 per token1

    await program.methods
      .placeLimitOrder(token1Mint, token2Mint, "sell", user1SellPrice, new anchor.BN(user1SellAmount))
      .accountsPartial({
        baseQuoteQueue: token1Token2QueuePda,
        quoteBaseQueue: token2Token1QueuePda,
        dexManager: dexManagerPda,
        orderEvents: user1EventsPda,
        userBaseTokenLedger: user1Token1LedgerPda,
        userQuoteTokenLedger: user1Token2LedgerPda,
        userOrderbook: user1OrderbookPda,
        user: user1.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user1])
      .rpc();
```

##### 1.2 Limit Order from User2 (Buy 20 token1 for 2 token2 per token1)

```typescript
    const user2BuyAmount = 20 * 10 ** 9; // 20 token1 (大于用户1的10个)
    const user2BuyPrice = 2; // 2 token2 per token1 (高于用户1的卖价，会匹配用户1的全部订单，剩余10个token1的买单)

    await program.methods
      .placeLimitOrder(token1Mint, token2Mint, "buy", user2BuyPrice, new anchor.BN(user2BuyAmount))
      .accountsPartial({
        baseQuoteQueue: token1Token2QueuePda,
        quoteBaseQueue: token2Token1QueuePda,
        dexManager: dexManagerPda,
        orderEvents: user2EventsPda,
        userBaseTokenLedger: user2Token1LedgerPda,
        userQuoteTokenLedger: user2Token2LedgerPda,
        userOrderbook: user2OrderbookPda,
        user: user2.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([user2])
      .rpc();
```

**After That:**

- User1 places buy order: (Sell 10 token1 for 1 token2 per token1)
- User2 places sell order: (Buy 20 token1 for 2 token2 per token1)
- User2's order is matched with User1's order, and partially filled.
- The remaining amount of User2's order will be cancelled later.

#### 2. Cancellation

```
// Get remaining order info
const activeOrder = token1Token2Queue.orderHeap.orders[0];
const orderIdToCancel = activeOrder.id;

// Call cancel order
await program.methods.cancelOrder(orderIdToCancel)
  .accountsPartial({
    baseQuoteQueue: token1Token2QueuePda,
    userOrderBook: user2OrderbookPda,
    user: user2.publicKey,
  })
  .signers([user2])
  .rpc();
```

Final state:

```
📊 最终余额:
用户1 Token1 - 可用: 990.00, 锁定: 0.00
用户1 Token2 - 可用: 60000.00, 锁定: 0.00
用户2 Token1 - 可用: 1010.00, 锁定: 0.00
用户2 Token2 - 可用: 40000.00, 锁定: 0.00
```

## References:

- [anchor-zero-copy-example](https://github.com/solana-developers/anchor-zero-copy-example)
- [Anchor](https://www.anchor-lang.com/docs)
- [Openbook-v2](https://github.com/openbook-dex/openbook-v2)
- [orderbook-rs](https://github.com/dgtony/orderbook-rs)

