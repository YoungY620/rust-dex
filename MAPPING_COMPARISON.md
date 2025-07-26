# 映射表对比：BTreeMap vs PDA

## 原来的代码（不能在 Solana 中工作）

```rust
#[account]
pub struct State {
    pub orderbooks: BTreeMap<String, orderbook::OrderBook>  // ❌ 不能序列化
}

// 使用方式
let key = format!("{}/{}", base_token, quote_token);
let orderbook = state.orderbooks.get_mut(&key).unwrap();
let result = orderbook.process_order(order);
```

## 新的 PDA 映射表（可以在 Solana 中工作）

```rust
// 1. 定义账户结构（映射表的"值"）
#[account]
pub struct OrderBookAccount {
    pub base_token: Pubkey,
    pub quote_token: Pubkey,
    pub orderbook: orderbook::OrderBook,  // 实际数据
    pub bump: u8,
    pub is_initialized: bool,
}

// 2. 封装层，模拟原来的接口
pub struct OrderBookMapping;

impl OrderBookMapping {
    // 相当于 mapping[key]
    pub fn get_orderbook(account: &mut OrderBookAccount) -> &mut orderbook::OrderBook {
        &mut account.orderbook
    }
    
    // 相当于 mapping.contains_key(key)
    pub fn contains_key(account: &OrderBookAccount) -> bool {
        account.is_initialized
    }
    
    // 生成键字符串
    pub fn get_key(base_token: &Pubkey, quote_token: &Pubkey) -> String {
        format!("{}/{}", base_token, quote_token)
    }
}

// 3. 使用方式（几乎和原来一样）
pub fn place_limit_order(ctx: Context<PlaceLimitOrder>, ...) -> Result<()> {
    let orderbook_account = &mut ctx.accounts.orderbook;
    
    // 检查是否存在（相当于 mapping.contains_key）
    require!(OrderBookMapping::contains_key(orderbook_account), ErrorCode::OrderBookNotInitialized);
    
    // 获取订单簿（相当于 mapping[key]）
    let orderbook = OrderBookMapping::get_orderbook(orderbook_account);
    
    // 调用原有的方法（完全一样！）
    let order = order::Order::new(...)?;
    let result = orderbook.process_order(order);
    
    Ok(())
}
```

## 账户约束（映射表的"键"）

```rust
#[derive(Accounts)]
pub struct PlaceLimitOrder<'info> {
    #[account(
        mut,
        seeds = [
            b"orderbook",                    // 固定前缀
            orderbook.base_token.as_ref(),   // 键的一部分
            orderbook.quote_token.as_ref()   // 键的一部分
        ],
        bump = orderbook.bump
    )]
    pub orderbook: Account<'info, OrderBookAccount>,  // 映射表的值
    
    #[account(mut)]
    pub user: Signer<'info>,
}
```

## 客户端使用

```typescript
// 计算PDA地址（相当于计算映射表的键）
const [orderbookPDA] = PublicKey.findProgramAddressSync([
    Buffer.from("orderbook"),
    solMint.toBuffer(),      // base_token
    usdcMint.toBuffer()      // quote_token
], program.programId);

// 调用函数
await program.methods
    .placeLimitOrder("buy", price, amount)
    .accounts({
        orderbook: orderbookPDA,  // 传入映射表的值
        user: wallet.publicKey,
    })
    .rpc();
```

## 总结

| 特性 | 原来的 BTreeMap | 新的 PDA 映射表 |
|------|----------------|-----------------|
| 键 | `String` | `seeds = [prefix, base_token, quote_token]` |
| 值 | `orderbook::OrderBook` | `OrderBookAccount` |
| 访问方式 | `map[key]` | `OrderBookMapping::get_orderbook(account)` |
| 存储位置 | 内存（不持久化） | 区块链账户（持久化） |
| 序列化 | ❌ 不支持 | ✅ 自动支持 |
| 原有代码复用 | - | ✅ 几乎不需要改动 |

通过这种封装，你的原有 orderbook 逻辑完全不需要改变，只是访问方式稍有不同！
