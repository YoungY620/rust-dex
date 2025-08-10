# 修改部分总结

## 市价单处理逻辑不合理

### 问题场景

假设首先在对手方队列放入 6 个卖出数量为 10 的限价单。然后发送一个市价买入单，数量为 50。

正常情况下，最终市价单应当完全成交，并剩余一个数量为 10 的限价单在对手方队列。

然而在旧版本中，限价单完全成交，同时还生成了一个未完全匹配的回退事件在 event_list 中。

```typescript
  it("should consume events for a user", async () => {
    // 使用新的工具函数发起限价交易
    for (let i = 0; i < 6; i++) {
      await placeLimitOrder(
        program,
        user1,
        baseMint,
        quoteMint,
        "sell",
        100,
        10,
        dexManagerPda,
        buyBaseQueuePda,
        sellBaseQueuePda,
        user1EventsPda,
        user1BaseTokenLedgerPda,
        user1QuoteTokenLedgerPda,
        user1OrderbookPda
      );
    }
    await placeMarketOrder(
        program,
        user2,
        baseMint,
        quoteMint,
        "buy",
        50,
        dexManagerPda,
        buyBaseQueuePda,
        sellBaseQueuePda,
        user2EventsPda,
        user2BaseTokenLedgerPda,
        user2QuoteTokenLedgerPda,
        user2OrderbookPda
    )
  });
```

### 问题原因

设当前请求 order 的 支出token 为 A，收入 token 为 B。

撮合引擎没有考虑买单和卖单的区别，统一使用 “order 支出 A 的数量” 作为判断撮合是否完成的标准（order_match函数）。

只有对手方价格优于自己价格时，才能进入 order_match 函数。在限价单场景，支出金额和收入金额是通过价格相互锚定的，因此只判断支出金额，就能对两个订单能否完全匹配进行判断。

```rust
    fn order_match(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType
    ) -> bool {
        let best_sell_order: &OrderNode;
        match sell_queue.get_best_order() {
            Some(best_sell_inner) => {
                best_sell_order = best_sell_inner;
            },
            None => {
                return false;
            }
        }
        let oppo_buy_quantity = best_sell_order.buy_quantity;
        if order.sell_quantity < oppo_buy_quantity {
            let buy_quantity = order.sell_quantity * best_sell_order.buy_price() as u64;
            // 省略
            return true;
        } else if order.sell_quantity > oppo_buy_quantity {
            let oppo_sell_order_mut: &mut OrderNode;
            match sell_queue.get_best_order_mut() {
                Some(order) => oppo_sell_order_mut = order,
                None => return false,
            }
            order.sell_quantity -= oppo_sell_order_mut.buy_quantity;
            // 省略
            return false;
        } else {
            // 省略
            return true;
        }
    }

```

对于市价单请求，会构造一个理论最优惠出价的限价单（即 $sell\_price = \frac{buy\_quantity}{sell\_quantity}$ 最小）。这样就能够复用同样的撮合引擎，尽可能匹配任何对手方队列的订单。具体来说：

| 订单方向 | buy_amount 初始化 | sell_amount 初始化 | sell_price |
|----------|------------------|-------------------|------------|
| 买单      | amount           | available_balance | $\frac{amount}{available\_balance}$ |
| 卖单      | 0                | amount            | $\frac{0}{amount}$ |

- `amount` 表示用户输入的数量（买入或卖出）。
- `available_balance` 表示当前可用余额（买单时用于支付）。
- `sell_price` 在市价单场景下通常取 $\frac{buy\_amount}{sell\_amount}$，买单时 $buy\_amount > 0$，卖单时 $buy\_amount = 0$，$sell\_price = 0$。

在市价单卖单场景，由于用户指定了支出数量而没有规定收入数量，因此也可以仅通过判断收入金额来判断是否完成撮合。

而对于买单，sell_amount 设为理论最大值即用户的余额，因此按照旧版本逻辑，只有耗尽所有余额，才能够完全匹配。用户规定的买量 amount 完全失去作用。

### 修改

解决方案是将买单和卖单的信息传给撮合引擎，然后分别实现卖单和买单的撮合逻辑。买单匹配 和 卖单匹配 分别使用 `order.buy_quantity` 和 `order.sell_quantity` 来判断三个条件分支，而这两个值都对应 `amount` 的值。这样撮合何时停止直接受到用户指定的成交数量 amount 控制。

```rust
    fn order_match_sell(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType
    ) -> bool {
        let best_sell_result = sell_queue.get_best_order();
        let best_sell_order: &OrderNode;
        match best_sell_result {
            Some(best_sell_inner) => {
                best_sell_order = best_sell_inner;
            },
            None => {
                return false;
            }
        }
        let oppo_buy_quantity = best_sell_order.buy_quantity;
        if order.sell_quantity < oppo_buy_quantity {
            let buy_quantity = order.sell_quantity * best_sell_order.buy_price() as u64;
            // 省略
            return true;
        } else if order.sell_quantity > oppo_buy_quantity {
            // 省略
            return false;
        } else {
            // 省略
            return true;
        }
    }

    fn order_match_buy(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType
    ) -> bool {
        let best_sell_order: &OrderNode;
        match sell_queue.get_best_order() {
            Some(best_sell_inner) => {
                best_sell_order = best_sell_inner;
            },
            None => {
                return false;
            }
        }
        let oppo_sell_quantity = best_sell_order.sell_quantity;
        if order.buy_quantity < oppo_sell_quantity {
            let sell_quantity = order.buy_quantity * best_sell_order.sell_price() as u64;
            // 省略
            return true;
        } else if order.buy_quantity > oppo_sell_quantity {
            // 省略
            return false;
        } else {
            // 省略
            return true;
        }
    }

    fn order_match(
        order: &mut OrderNode,
        sell_queue: &mut dyn OrderHeap,
        result: &mut OrderProcessResult,
        order_type: OrderType,
        is_sell: bool,
    ) -> bool {
        if is_sell {
            Self::order_match_sell(order, sell_queue, result, order_type)
        } else {
            Self::order_match_buy(order, sell_queue, result, order_type)
        }
    }
```

## OrderHeap `remove_order` 遍历搜索优化

原来的实现是从头遍历整个heap，直到找到要删除的order，然后通过heap向下调整维护 order heap 的结构。

因此 add order 的时间复杂度是 $O(\log n)$，remove order 的时间复杂度是 $O(n)$。

### 优化方案

引入了 `DictTreeMapImpl` 作为辅助索引数据结构，维护从 `order_id` 到 `heap_index` 的映射关系。这样就能够在近似常数时间内定位要删除的元素位置。

```rust
#[zero_copy]
#[derive(Debug)]
pub struct OrderHeapImpl {
    pub orders: [OrderNode; ORDER_HEAP_CAPACITY],
    pub idx_map: DictTreeMapImpl,  // 新增的索引映射
    pub size: u64,
}
```

### 复杂度分析

#### DictTreeMap 复杂度分析

`DictTreeMapImpl` 是基于二叉前缀树（Binary Trie）的实现，其复杂度特性如下：

实际的树深度不是由键的位数决定，而是由当前存储的所有键的 **最大公共后缀** 长度 $k'$ 决定的。

```rust
// 查找 Map 中 key 对应的 value 时，从个位开始，从低到高按位遍历键的每一位
impl DictTreeMap for DictTreeMapImpl { 
    fn get(&self, key: u64) -> Result<Option<u64>> {
        let mut bitmap: u64 = 1;
        let mut node = self.root;
        let mut node_type = self.get_node_type(node);
        if node_type == NodeType::Null {
            return Ok(None);
        }

        loop {
            match node_type {
                NodeType::Leaf => {
                    let leaf = self.to_leaf(node).unwrap();
                    if leaf.key == key {
                        return Ok(Some(leaf.value));
                    } else {
                        return Ok(None);
                    }
                },
                NodeType::Middle => {
                    let middle = self.to_middle(node).unwrap();
                    if (key & bitmap) != 0 {
                        node = middle.one;
                    } else {
                        node = middle.zero;
                    }
                },
                NodeType::Null => {
                    return Ok(None);
                },
            }
            bitmap <<= 1;
            node_type = self.get_node_type(node);
        }
    }
}
```

#### DictTreeMap 操作复杂度

- **insert(key, value)**: $O(k')$ - 最多遍历 $k'$ 位
- **remove(key)**: $O(k')$ - 最多遍历 $k'$ 位 + 可能的树结构调整 (最多删除 $k'$ 个中间节点)
- **get(key)**: $O(k')$ - 最多遍历 $k'$ 位
- **swap(key1, key2)**: $O(k')$ - 两次get + 两次insert = $4 \times O(k') = O(k')$

#### 当前版本 add_order 复杂度分析

1. `self.orders[idx] = order` - $O(1)$
2. `self.idx_map.insert(order.id, idx)` - $O(k')$
3. **堆上浮维护**: 
   - 上浮次数: $O(\log n)$
   - 每次上浮中的 `idx_map.swap()`: $O(k')$
   - 总上浮成本: $O(\log n \times k')$

**总复杂度**: $T(add\_order) = O(1) + O(k') + O(\log n \times k') = O(k' \times \log n)$

#### 当前版本 remove_order 复杂度分析

1. `self.idx_map.get(id)` - $O(k')$
2. 用最后一个元素替换被删除元素 - $O(1)$
3. remove + insert（删掉目标元素的索引，更新最后一个元素的位置为原目标元素的位置） - $O(k')$
4. **堆下沉维护**:
   - 下沉次数: $O(\log n)$
   - 每次下沉中的 `idx_map.swap()`: $O(k')$
   - 总下沉成本: $O(\log n \times k')$

**总复杂度**: $T(remove\_order) = O(k') + O(1) + O(k') + O(\log n \times k') = O(k' \times \log n)$

**实际情况分析**：

$k'$ 的边界分析

1. **下界**: $k' \geq \lceil \log_2(n) \rceil$ - 至少需要 $\log_2(n)$ 位来区分 $n$ 个不同的键
2. **上界**: $k' \leq 64$ - 受键位数限制

| 键分布特性 | $k'$ 的值 | add_order | remove_order | 场景示例 |
|------------|------------|-----------|--------------|----------|
| **高度聚集** | $O(\log n)$ | $O(\log^2 n)$ | $O(\log^2 n)$ | 连续分配的订单ID |
| **随机分布** | $O(64) = O(1)$ | $O(\log n)$ | $O(\log n)$ | 随机分布的64位ID，比如最早的订单一直没有删除，导致和最新的订单ID存在较长的公共后缀 |

#### 与旧版本实现的对比

| 实现方式 | add_order | remove_order | 备注 |
|----------|-----------|--------------|------|
| **传统二叉堆** | $O(\log n)$ | $O(n)$ | remove需要$O(n)$线性查找 |
| **本实现（聚集分布）** | $O(\log^2 n)$ | $O(\log^2 n)$ | 键高度聚集时 |
| **本实现（随机分布）** | $O(\log n)$ | $O(\log n)$ | 键随机分布时 |

在当前版本中，订单ID采用递增序列的方式生成，且通过从个位到高位的形式在 字典树 中存储，且删除 key-value 时，字典树会及时删除代表公共后缀的中间节点。因此：

- **预期 $k'$**: 较小，接近 $\log n$（$n < 2^{64}$）。最差情况为 64
- **实际复杂度**: $O(\log^2 n)$
- remove_order 从 $O(n)$ 提升到 $O(\log^2 n)$
- add_order 从 $O(\log n)$ 降低到 $O(\log^2 n)$
- 如果最早的订单能够能够被及时删除，那么 $k'$ 值会更小，整体时间复杂度也是最优的。
