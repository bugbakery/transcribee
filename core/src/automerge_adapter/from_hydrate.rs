use automerge::{ScalarValue, hydrate};

pub(crate) trait FromHydrate {
    fn from_hydrate(value: hydrate::Value) -> Self;
}

impl<T: FromHydrate> FromHydrate for Option<T> {
    fn from_hydrate(value: hydrate::Value) -> Self {
        match value {
            hydrate::Value::Scalar(ScalarValue::Null) => None,
            _ => Some(T::from_hydrate(value)),
        }
    }
}

impl FromHydrate for String {
    fn from_hydrate(value: hydrate::Value) -> Self {
        match value {
            hydrate::Value::Scalar(ScalarValue::Str(str)) => str.into(),
            hydrate::Value::Text(text) => text.to_string(),
            _ => unreachable!(),
        }
    }
}

impl FromHydrate for f64 {
    fn from_hydrate(value: hydrate::Value) -> Self {
        match value {
            hydrate::Value::Scalar(ScalarValue::F64(v)) => v,
            _ => unreachable!(),
        }
    }
}

impl FromHydrate for i64 {
    fn from_hydrate(value: hydrate::Value) -> Self {
        match value {
            hydrate::Value::Scalar(ScalarValue::Int(v)) => v,
            _ => unreachable!(),
        }
    }
}
