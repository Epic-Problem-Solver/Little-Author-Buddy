//! Home-window geometry published with atomics.
//! The window-event handler calls `moved` and returns. It takes no locks.

use std::sync::atomic::{AtomicI32, AtomicU32, AtomicU64, Ordering::Relaxed};

static X: AtomicI32 = AtomicI32::new(i32::MIN);
static Y: AtomicI32 = AtomicI32::new(i32::MIN);
static W: AtomicU32 = AtomicU32::new(0);
static H: AtomicU32 = AtomicU32::new(0);
static SCALE_MILLI: AtomicU64 = AtomicU64::new(1000);

/// Two stores. Nothing else: the Moved event fires inside Windows' modal drag loop.
pub fn moved(x: i32, y: i32) { X.store(x, Relaxed); Y.store(y, Relaxed); }
pub fn sized(w: u32, h: u32) { W.store(w, Relaxed); H.store(h, Relaxed); }
pub fn scaled(s: f64) { SCALE_MILLI.store((s * 1000.0) as u64, Relaxed); }

pub fn get() -> Option<(i32, i32, u32, u32, f64)> {
    let x = X.load(Relaxed);
    if x == i32::MIN { return None; }
    Some((x, Y.load(Relaxed), W.load(Relaxed), H.load(Relaxed), SCALE_MILLI.load(Relaxed) as f64 / 1000.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moved_stores_the_point_and_nothing_else() {
        moved(12, 34);
        sized(200, 200);
        scaled(1.5);
        let (x, y, w, h, scale) = get().unwrap();
        assert_eq!((x, y, w, h), (12, 34, 200, 200));
        assert!((scale - 1.5).abs() < 1e-9);
    }
}
