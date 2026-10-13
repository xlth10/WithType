//! Physical-pixel placement. An anchor is frozen for the lifetime of a card.
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Debug)]
pub struct Anchor {
    pub caret: Option<Rect>,
    pub work: Rect,
    pub scale: f64,
}

pub fn place(anchor: &Anchor, width: i32, height: i32) -> Rect {
    let margin = (16.0 * anchor.scale).round() as i32;
    let gap = (12.0 * anchor.scale).round() as i32;
    let width = width.max(1).min((anchor.work.width - 2 * margin).max(1));
    let height = height.max(1).min((anchor.work.height - 2 * margin).max(1));
    let left = anchor.work.x + margin;
    let top = anchor.work.y + margin;
    let right = (anchor.work.x + anchor.work.width - margin - width).max(left);
    let bottom = (anchor.work.y + anchor.work.height - margin - height).max(top);
    let (x, y) = if let Some(caret) = anchor.caret {
        let below = caret.y + caret.height + gap;
        let above = caret.y - gap - height;
        (
            caret.x,
            if below <= bottom {
                below
            } else if above >= top {
                above
            } else {
                below
            },
        )
    } else {
        (anchor.work.x + (anchor.work.width - width) / 2, bottom)
    };
    Rect {
        x: x.clamp(left, right),
        y: y.clamp(top, bottom),
        width,
        height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn anchor(caret: Option<Rect>) -> Anchor {
        Anchor {
            caret,
            work: Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            scale: 1.0,
        }
    }
    #[test]
    fn prefers_below_caret_and_moves_above_near_bottom() {
        let mut a = anchor(Some(Rect {
            x: 300,
            y: 200,
            width: 1,
            height: 20,
        }));
        assert_eq!(
            place(&a, 420, 320),
            Rect {
                x: 300,
                y: 232,
                width: 420,
                height: 320
            }
        );
        a.caret.as_mut().unwrap().y = 900;
        assert_eq!(place(&a, 420, 320).y, 568);
    }
    #[test]
    fn fallback_centres_at_bottom_and_clamps_negative_origin_with_dpi() {
        let a = Anchor {
            caret: None,
            work: Rect {
                x: -2560,
                y: -100,
                width: 2560,
                height: 1400,
            },
            scale: 2.0,
        };
        assert_eq!(
            place(&a, 840, 640),
            Rect {
                x: -1700,
                y: 628,
                width: 840,
                height: 640
            }
        );
    }
    #[test]
    fn keeps_window_inside_small_work_area_and_right_edge() {
        let a = Anchor {
            caret: Some(Rect {
                x: 499,
                y: 350,
                width: 2,
                height: 20,
            }),
            work: Rect {
                x: 0,
                y: 0,
                width: 500,
                height: 400,
            },
            scale: 1.0,
        };
        assert_eq!(
            place(&a, 800, 700),
            Rect {
                x: 16,
                y: 16,
                width: 468,
                height: 368
            }
        );
    }
}
