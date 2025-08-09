use anchor_lang::prelude::*;


pub trait DictTreeMap {
    fn insert(&mut self, key: u64, value: u64) -> Result<()>;
    fn remove(&mut self, key: u64) -> Result<Option<u64>>;
    fn get(&self, key: u64) -> Result<Option<u64>>;
    fn contains_key(&self, key: u64) -> bool;
    fn len(&self) -> usize;
    fn swap(&mut self, key1: u64, key2: u64) -> Result<()>;
}

const MAX_LEAVES: usize = 64;
const MAX_MIDDLES: usize = 64;

#[error_code]
pub enum ErrorCode {
    MaxLeavesReached,
    MaxMiddlesReached,

    TooLongKey,
    KeyNotFound,
}


#[zero_copy]
#[derive(Debug)]
struct DictTreeLeaf {
    next: i16,
    pad: [i16; 3],
    key: u64,
    value: u64,
}


#[zero_copy]
#[derive(Debug)]
struct DictTreeMiddle {
    next: i16,
    one: i16,
    zero: i16,
}

#[zero_copy]
#[derive(Debug)]
pub struct DictTreeMapImpl {
    leaves: [DictTreeLeaf; MAX_LEAVES],
    middles: [DictTreeMiddle; MAX_MIDDLES],
    root: i16,          
    first_free_leaf: i16,
    first_free_middle: i16,
    size: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NodeType {
    Leaf,
    Middle,
    Null,
}

impl DictTreeMapImpl {
    pub fn new() -> Self {
        let mut leaves = [DictTreeLeaf { next: -1, pad: [0; 3], key: 0, value: 0 }; MAX_LEAVES];
        for i in 0..MAX_LEAVES - 1 {
            leaves[i].next = i as i16 + 1 + MAX_MIDDLES as i16;
        }
        let mut middles = [DictTreeMiddle { next: -1, one: -1, zero: -1 }; MAX_MIDDLES];
        for i in 0..MAX_MIDDLES - 1 {
            middles[i].next = i as i16 + 1;
        }
        DictTreeMapImpl {
            leaves: leaves,
            middles: middles,
            root: -1,
            first_free_leaf: MAX_MIDDLES as i16,
            first_free_middle: 0,
            size: 0,
        }
    }

    fn allocate_leaf(&mut self) -> Result<i16> {
        if self.first_free_leaf < MAX_MIDDLES as i16 || 
            self.first_free_leaf >= (MAX_LEAVES + MAX_MIDDLES) as i16 {
            return Err(ErrorCode::MaxLeavesReached.into());
        }
        let idx = self.first_free_leaf;
        self.first_free_leaf = self.leaves[idx as usize - MAX_MIDDLES].next;
        Ok(idx)
    }

    fn allocate_middle(&mut self) -> Result<i16> {
        if self.first_free_middle >= MAX_MIDDLES as i16 || self.first_free_middle < 0 {
            return Err(ErrorCode::MaxMiddlesReached.into());
        }
        let idx = self.first_free_middle;
        self.first_free_middle = self.middles[idx as usize].next;
        Ok(idx)
    }

    fn deallocate_leaf(&mut self, idx: i16) {
        if idx < MAX_MIDDLES as i16 || idx as usize >= MAX_LEAVES + MAX_LEAVES {
            return;
        }
        self.leaves[idx as usize - MAX_MIDDLES].next = self.first_free_leaf;
        self.first_free_leaf = idx;
    }

    fn deallocate_middle(&mut self, idx: i16) {
        if idx < 0 || idx as usize >= MAX_MIDDLES {
            return;
        }
        self.middles[idx as usize].next = self.first_free_middle;
        self.first_free_middle = idx;
    }

    fn to_leaf(&self, idx: i16) -> Option<&DictTreeLeaf> {
        if idx < 0 {
            return None;
        }
        if idx < MAX_MIDDLES as i16 {
            return None; // idx is a middle node index
        }
        if idx as usize >= MAX_LEAVES + MAX_MIDDLES {
            return None; // idx is out of bounds
        }
        Some(&self.leaves[idx as usize - MAX_MIDDLES])
    }
    fn to_leaf_mut(&mut self, idx: i16) -> Option<&mut DictTreeLeaf> {
        if idx < 0 {
            return None;
        }
        if idx < MAX_MIDDLES as i16 {
            return None; // idx is a middle node index
        }
        if idx as usize >= MAX_LEAVES + MAX_MIDDLES {
            return None; // idx is out of bounds
        }
        Some(&mut self.leaves[idx as usize - MAX_MIDDLES])
    }
    fn to_middle(&self, idx: i16) -> Option<&DictTreeMiddle> {
        if idx < 0 || idx as usize >= MAX_MIDDLES {
            return None; // idx is out of bounds
        }
        Some(&self.middles[idx as usize])
    }
    fn to_middle_mut(&mut self, idx: i16) -> Option<&mut DictTreeMiddle> {
        if idx < 0 || idx as usize >= MAX_MIDDLES {
            return None; // idx is out of bounds 
        }
        Some(&mut self.middles[idx as usize])
    }
    fn get_node_type(&self, idx: i16) -> NodeType {
        if idx < 0 {
            return NodeType::Null;
        }
        if idx < MAX_MIDDLES as i16 {
            return NodeType::Middle;
        }
        if idx as usize >= MAX_LEAVES + MAX_MIDDLES {
            return NodeType::Null; // out of bounds
        }
        NodeType::Leaf
    }

    fn has_no_sibling(&self, parent: i16, node: i16) -> bool {
        if parent < 0 || parent as usize >= MAX_MIDDLES {
            return false; 
        }
        let middle = self.to_middle(parent).unwrap();
        if middle.one != node && middle.zero != node {
            return false; 
        }

        (middle.one == node && self.get_node_type(middle.zero) == NodeType::Null) 
        || (middle.zero == node && self.get_node_type(middle.one) == NodeType::Null)
    }
}

impl DictTreeMap for DictTreeMapImpl { 
    fn insert(&mut self, key: u64, value: u64) -> Result<()> { 
        let mut node = self.root;
        let mut node_type = self.get_node_type(node);
        let mut bitmap: u64 = 1;

        match node_type {
            NodeType::Null => {
                if let Ok(leaf_idx) = self.allocate_leaf() {
                    self.leaves[leaf_idx as usize - MAX_MIDDLES].key = key;
                    self.leaves[leaf_idx as usize - MAX_MIDDLES].value = value;
                    self.leaves[leaf_idx as usize - MAX_MIDDLES].next = -1;
                    self.root = leaf_idx;
                    self.size += 1;
                } else {
                    return Err(ErrorCode::MaxLeavesReached.into());
                }
                return Ok(());
            },
            NodeType::Leaf => {
                let leaf = self.to_leaf_mut(node).unwrap(); 
                if leaf.key == key {
                    leaf.value = value; // Update existing leaf
                    return Ok(());
                } else {
                    let leaf_key = leaf.key;
                    // Need to split the leaf into a middle node
                    let middle_idx = self.allocate_middle()?;
                    self.root = middle_idx;     // Update root to new middle node
                    
                    let mut new_leaf_idx = -1;
                    if (leaf_key & bitmap) != (key & bitmap) {
                        new_leaf_idx = self.allocate_leaf()?;
                        let new_leaf = self.to_leaf_mut(new_leaf_idx).unwrap();
                        new_leaf.key = key;
                        new_leaf.value = value;
                        new_leaf.next = -1;
                    }
                    
                    let middle = self.to_middle_mut(middle_idx).unwrap();
                    if leaf_key & bitmap != 0 {
                        middle.one = node;
                        middle.zero = new_leaf_idx;       // Old leaf becomes one child
                    } else {
                        middle.zero = node;
                        middle.one = new_leaf_idx;        // Old leaf becomes zero child
                    }

                    if new_leaf_idx != -1 {
                        self.size += 1;
                        return Ok(());
                    }
                }
            },
            NodeType::Middle => {
                node = if (key & bitmap) != 0 {
                    self.to_middle(node).unwrap().one
                } else {
                    self.to_middle(node).unwrap().zero
                };
            }
        }
        let mut parent_node = self.root;
        node_type = self.get_node_type(node);
        bitmap <<= 1;
        loop {
            match node_type {
                NodeType::Leaf => {
                    let leaf = self.to_leaf_mut(node).unwrap();
                    if leaf.key == key {
                        leaf.value = value; 
                        return Ok(());
                    } else {
                        let leaf_key = leaf.key;   
                        let middle_idx = self.allocate_middle()?;
                        let parent = self.to_middle_mut(parent_node).unwrap();
                        if parent.one == node {
                            parent.one = middle_idx;
                        } else {
                            parent.zero = middle_idx;
                        }
                        
                        let mut new_leaf_idx = -1;
                        if leaf_key & (bitmap as u64) != key & (bitmap as u64) {
                            new_leaf_idx = self.allocate_leaf()?;
                            let new_leaf = self.to_leaf_mut(new_leaf_idx).unwrap();
                            new_leaf.key = key;
                            new_leaf.value = value;
                            new_leaf.next = -1;
                        }
                        
                        let middle = self.to_middle_mut(middle_idx).unwrap();
                        if leaf_key & (bitmap as u64) != 0 {
                            middle.one = node;
                            middle.zero = new_leaf_idx; 
                        } else {
                            middle.zero = node;
                            middle.one = new_leaf_idx; 
                        }
                        if new_leaf_idx != -1{
                            self.size += 1;
                            return Ok(());
                        }
                    }
                },
                NodeType::Middle => {
                    let middle = self.to_middle(node).unwrap();
                    parent_node = node;
                    if (key & bitmap) != 0 {
                        node = middle.one;
                    } else {
                        node = middle.zero;
                    }

                },
                NodeType::Null => {
                    let leaf_idx = self.allocate_leaf()?;
                    let leaf = self.to_leaf_mut(leaf_idx).unwrap();
                    leaf.key = key;
                    leaf.value = value;
                    leaf.next = -1; // No next leaf
                    if let Some(parent) = self.to_middle_mut(parent_node) {
                        if (key & (bitmap >> 1)) != 0 {
                            parent.one = leaf_idx;
                        } else {
                            parent.zero = leaf_idx;
                        }
                    }
                    return Ok(());
                },
            }
            node_type = self.get_node_type(node);
            bitmap <<= 1;
            if bitmap == 0 {
                break;
            }
        }
        return Err(ErrorCode::TooLongKey.into())
    }
    
    fn remove(&mut self, key: u64) -> Result<Option<u64>> {
        let mut bitmap: u64 = 1;
        let mut node = self.root;
        let mut node_type = self.get_node_type(node);
        let mut path: Vec<i16> = Vec::new();
        match node_type {
            NodeType::Null => {
                return Ok(None);
            },
            NodeType::Leaf => {
                let leaf = self.to_leaf(node).unwrap();
                if leaf.key == key {
                    let value = leaf.value;
                    // Remove the leaf by updating the root
                    self.root = -1; // Set root to null
                    self.size -= 1;
                    self.deallocate_leaf(node);
                    return Ok(Some(value));
                } else {
                    return Ok(None);
                }
            },
            NodeType::Middle => {
                path.push(node);
                node = if key & bitmap != 0 {
                    self.to_middle(node).unwrap().one
                } else {
                    self.to_middle(node).unwrap().zero
                };
                bitmap <<= 1;
                node_type = self.get_node_type(node);
            }
        }

        loop {
            match node_type {
                NodeType::Leaf => {
                    let leaf_key = self.to_leaf(node).unwrap().key;
                    let leaf_value = self.to_leaf(node).unwrap().value;
                    if leaf_key == key {
                        let mut parent_node = path.pop().unwrap_or(-1);

                        if !self.has_no_sibling(parent_node, node) {
                            let parent = self.to_middle_mut(parent_node).unwrap();
                            if parent.one == node {
                                parent.one = -1;
                            } else {
                                parent.zero = -1;
                            }
                        }

                        while parent_node != -1 && self.has_no_sibling(parent_node, node) {
                            let next_parent_node = path.pop().unwrap_or(-1);
                            self.deallocate_middle(parent_node);
                            if next_parent_node == -1 {
                                self.root = -1; // If we reach the root, set it to null
                                break;
                            }
                            let next_parent = self.to_middle_mut(next_parent_node).unwrap();
                            if next_parent.one == parent_node {
                                next_parent.one = -1; // Remove the reference to the parent node
                            } else {
                                next_parent.zero = -1; // Remove the reference to the parent node
                            }
                            node = parent_node;
                            parent_node = next_parent_node;
                        }

                        self.deallocate_leaf(node);
                        self.size -= 1;
                        return Ok(Some(leaf_value));
                    } else {
                        return Ok(None);
                    }
                },
                NodeType::Middle => {
                    path.push(node);
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
    
    fn contains_key(&self, key: u64) -> bool {
        self.get(key).unwrap_or(None).is_some()
    }
    
    fn len(&self) -> usize {
        self.size as usize
    }

    fn swap(&mut self, key1: u64, key2: u64) -> Result<()> {
        let value1 = self.get(key1)?.ok_or(ErrorCode::KeyNotFound)?;
        let value2 = self.get(key2)?.ok_or(ErrorCode::KeyNotFound)?;

        self.insert(key1, value2)?;
        self.insert(key2, value1)?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_dict_tree_map() {
        let tree_map = DictTreeMapImpl::new();
        assert_eq!(tree_map.root, -1);
        assert_eq!(tree_map.first_free_leaf, MAX_MIDDLES as i16);
        assert_eq!(tree_map.first_free_middle, 0);
        assert_eq!(tree_map.size, 0);
        assert_eq!(tree_map.len(), 0);
    }

    #[test]
    fn test_insert_and_get() {
        let mut tree_map = DictTreeMapImpl::new();
        
        // Insert a key-value pair
        tree_map.insert(1, 100).unwrap();
        assert_eq!(tree_map.len(), 1);
        assert_eq!(tree_map.get(1).unwrap(), Some(100));
        assert!(tree_map.contains_key(1));
        
        // Insert another key-value pair
        tree_map.insert(2, 200).unwrap();
        assert_eq!(tree_map.len(), 2);
        assert_eq!(tree_map.get(2).unwrap(), Some(200));
        assert!(tree_map.contains_key(2));
        
        // Update existing key
        tree_map.insert(1, 300).unwrap();
        assert_eq!(tree_map.len(), 2); // Size should not change
        assert_eq!(tree_map.get(1).unwrap(), Some(300));
    }

    #[test]
    fn test_get_nonexistent_key() {
        let mut tree_map = DictTreeMapImpl::new();
        
        // Try to get from empty tree
        assert_eq!(tree_map.get(1).unwrap(), None);
        assert!(!tree_map.contains_key(1));
        
        // Insert a key and try to get a different key
        tree_map.insert(5, 100).unwrap();
        assert_eq!(tree_map.get(10).unwrap(), None);
        assert!(!tree_map.contains_key(10));
    }

    #[test]
    fn test_remove() {
        let mut tree_map = DictTreeMapImpl::new();
        
        // Remove from empty tree
        assert_eq!(tree_map.remove(1).unwrap(), None);
        
        // Insert and remove a key
        tree_map.insert(1, 100).unwrap();
        assert_eq!(tree_map.remove(1).unwrap(), Some(100));
        assert_eq!(tree_map.len(), 0);
        assert_eq!(tree_map.get(1).unwrap(), None);
        assert!(!tree_map.contains_key(1));
        
        // Insert multiple keys and remove one
        tree_map.insert(1, 100).unwrap();
        tree_map.insert(2, 200).unwrap();
        assert_eq!(tree_map.remove(1).unwrap(), Some(100));
        assert_eq!(tree_map.len(), 1);
        assert_eq!(tree_map.get(1).unwrap(), None);
        assert_eq!(tree_map.get(2).unwrap(), Some(200));
    }

    #[test]
    fn test_many_inserts_and_removes() {
        let mut tree_map = DictTreeMapImpl::new();
        
        // Insert many key-value pairs
        for i in 1..=10 {
            tree_map.insert(i, i * 100).unwrap();
        }
        assert_eq!(tree_map.len(), 10);
        
        // Check all values
        for i in 1..=10 {
            assert_eq!(tree_map.get(i).unwrap(), Some(i * 100));
        }
        
        // Remove some values
        for i in 1..=5 {
            assert_eq!(tree_map.remove(i).unwrap(), Some(i * 100));
        }
        assert_eq!(tree_map.len(), 5);
        
        // Check remaining values
        for i in 1..=5 {
            assert_eq!(tree_map.get(i).unwrap(), None);
        }
        for i in 6..=10 {
            assert_eq!(tree_map.get(i).unwrap(), Some(i * 100));
        }
    }

    #[test]
    fn test_max_leaves_error() {
        let mut tree_map = DictTreeMapImpl::new();
        
        // Try to insert more items than MAX_LEAVES
        let result = (0..(MAX_LEAVES as u64 + 1)).map(|i| tree_map.insert(i, i)).collect::<Vec<_>>();
        
        // All but the last should be Ok
        for i in 0..MAX_LEAVES {
            assert!(result[i].is_ok());
        }
        
        // The last one should be an error
        assert!(result[MAX_LEAVES].is_err());
    }
}