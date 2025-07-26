# SPL Token 质押资金池设计文档

## 概述

这个资金池合约允许用户质押各种 SPL token，合约会自动管理资金并记录每个用户的余额。

## 核心数据结构

### 1. PoolAccount - 资金池账户
```rust
#[account]
pub struct PoolAccount {
    pub token_mint: Pubkey,      // token mint地址
    pub vault: Pubkey,           // 资金池保险库地址
    pub total_deposited: u64,    // 总质押量
    pub bump: u8,                // PDA bump
    pub is_initialized: bool,    // 是否已初始化
}
```

### 2. UserBalanceAccount - 用户余额账户
```rust
#[account]
pub struct UserBalanceAccount {
    pub user: Pubkey,            // 用户地址
    pub token_mint: Pubkey,      // token mint地址
    pub balance: u64,            // 用户在该token池中的余额
    pub bump: u8,                // PDA bump
}
```

## 核心功能

### 1. 初始化资金池
- **函数**: `initialize_pool(token_mint: Pubkey)`
- **功能**: 为指定的 SPL token 创建资金池
- **PDA**: `["pool", token_mint]`

### 2. 初始化用户余额账户
- **函数**: `initialize_user_balance(token_mint: Pubkey)`
- **功能**: 为用户在指定token池中创建余额记录
- **PDA**: `["user_balance", user_pubkey, token_mint]`

### 3. 质押 (Deposit)
- **函数**: `deposit(token_address: Pubkey, amount: u64)`
- **功能**: 
  - 将用户的 SPL token 转移到资金池保险库
  - 更新资金池总量
  - 更新用户余额记录
- **安全检查**: 
  - 验证金额大于0
  - 防止整数溢出

### 4. 取款 (Withdraw)
- **函数**: `withdraw(token_address: Pubkey, amount: u64)`
- **功能**:
  - 检查用户余额是否足够
  - 从资金池保险库转移 token 到用户账户
  - 更新资金池总量和用户余额
- **安全检查**:
  - 验证金额大于0
  - 验证用户余额充足
  - 防止整数下溢
  - 使用PDA签名授权转账

## 账户结构设计

### Deposit 账户结构
```rust
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolAccount>,
    
    #[account(
        mut,
        seeds = [
            b"user_balance",
            user.key().as_ref(),
            pool.token_mint.as_ref()
        ],
        bump = user_balance.bump
    )]
    pub user_balance: Account<'info, UserBalanceAccount>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
```

### Withdraw 账户结构
```rust
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(mut)]
    pub vault_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"pool", pool.token_mint.as_ref()],
        bump = pool.bump
    )]
    pub pool: Account<'info, PoolAccount>,
    
    #[account(
        mut,
        seeds = [
            b"user_balance",
            user.key().as_ref(),
            pool.token_mint.as_ref()
        ],
        bump = user_balance.bump
    )]
    pub user_balance: Account<'info, UserBalanceAccount>,
    
    pub token_program: Program<'info, Token>,
}
```

## 使用流程

### 管理员操作
1. 为每种要支持的 SPL token 调用 `initialize_pool`
2. 为资金池创建对应的保险库 token 账户

### 用户操作
1. 调用 `initialize_user_balance` 初始化余额账户（每个token只需一次）
2. 调用 `deposit` 质押 token
3. 调用 `withdraw` 取出 token

## 安全特性

1. **PDA 控制**: 资金池使用 PDA 控制保险库，确保只有合约能操作资金
2. **余额验证**: 严格检查用户余额，防止过度提取
3. **溢出保护**: 使用 `checked_add` 和 `checked_sub` 防止整数溢出/下溢
4. **权限控制**: 只有 token 所有者能操作自己的资金

## 多 Token 支持

- 每种 SPL token 都有独立的资金池
- 用户可以同时质押多种不同的 token
- 每个用户在每个 token 池中都有独立的余额记录
- 支持任意符合 SPL token 标准的代币

## 错误处理

定义了专门的错误码：
- `InvalidAmount`: 无效金额（<=0）
- `InsufficientBalance`: 余额不足
- `Overflow`: 数值溢出
- `Underflow`: 数值下溢

## 扩展性

这个设计支持未来扩展：
- 可以添加收益分配功能
- 可以添加锁定期功能
- 可以添加管理员费用功能
- 可以添加流动性挖矿功能
