use std::{ops::Deref, sync::Arc};

#[derive(Default)]
pub struct TreeList<T>(Arc<TreeListInner<T>>);
impl<T> TreeList<T> {
    pub fn with_element(&self, element: T) -> Self {
        TreeList(Arc::new(TreeListInner::Element {
            previous: self.clone(),
            element,
        }))
    }
    pub fn with_elements_removed_from_end(&self, n: usize) -> Self {
        if n == 0 {
            self.clone()
        } else {
            match &*self.0 {
                TreeListInner::BeginningOfSequence => panic!(
                    "tried to with_elements_removed_from_end for longer than the sequence is"
                ),
                TreeListInner::Element { previous, .. } => {
                    previous.with_elements_removed_from_end(n - 1)
                }
            }
        }
    }
}
impl<T> Deref for TreeList<T> {
    type Target = TreeListInner<T>;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}
impl<T> Clone for TreeList<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

#[derive(Clone)]
pub enum TreeListInner<T> {
    BeginningOfSequence,
    Element { previous: TreeList<T>, element: T },
}
impl<T> Default for TreeListInner<T> {
    fn default() -> Self {
        Self::BeginningOfSequence
    }
}
impl<T> TreeListInner<T> {
    pub fn len(&self) -> usize {
        match self {
            TreeListInner::BeginningOfSequence => 0,
            TreeListInner::Element { previous, .. } => previous.len() + 1,
        }
    }
}
impl<T: Clone> TreeListInner<T> {
    pub fn to_vec(&self, offset: usize) -> Vec<T> {
        let mut to_return = vec![];
        self.append_self_to_vec(&mut to_return, offset);
        to_return
    }
    fn append_self_to_vec(&self, vec: &mut Vec<T>, offset: usize) -> usize {
        match self {
            TreeListInner::BeginningOfSequence => 0,
            TreeListInner::Element { previous, element } => {
                let prev_idx = previous.append_self_to_vec(vec, offset);
                if prev_idx >= offset {
                    vec.push(element.clone());
                }
                prev_idx + 1
            }
        }
    }
}

#[cfg(test)]
mod test {
    use crate::whisper::tree_list::TreeList;

    #[test]
    fn test_empty() {
        assert_eq!(TreeList::<()>::default().len(), 0);
        assert_eq!(TreeList::<()>::default().to_vec(0).len(), 0);
    }

    #[test]
    fn test_append_remove_to_vec() {
        let l = TreeList::<usize>::default();
        let l = l.with_element(0);
        let l = l.with_element(1);
        assert_eq!(l.to_vec(0).len(), 2);
        assert_eq!(l.to_vec(1), vec![1]);
        let l = l.with_element(2);
        let l = l.with_elements_removed_from_end(0);
        assert_eq!(l.to_vec(0), vec![0, 1, 2]);
        let l = l.with_elements_removed_from_end(2);
        assert_eq!(l.to_vec(0), vec![0]);
    }
}
