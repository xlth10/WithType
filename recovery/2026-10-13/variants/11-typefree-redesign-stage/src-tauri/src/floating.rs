//! Design sizes are logical pixels. Placement and native calls use target-DPI
//! physical pixels only, including negative origins and taskbar work areas.
pub const MAIN_WIDTH: f64 = 1060.0;
pub const MAIN_HEIGHT: f64 = 720.0;
pub const HUD_WIDTH: f64 = 196.0;
pub const HUD_HEIGHT: f64 = 74.0;
pub const CARD_WIDTH: f64 = 460.0;
pub const CARD_HEIGHT: f64 = 520.0;

#[derive(Clone, Copy, Debug)]
pub struct WorkArea {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy)]
pub enum Surface {
    Main,
    Hud,
    Card,
}

pub fn geometry(area: WorkArea, surface: Surface) -> Geometry {
    let scale = if area.scale.is_finite() && area.scale > 0.0 {
        area.scale
    } else {
        1.0
    };
    let pixels = |value: f64| (value * scale).round() as u32;
    let (design_width, design_height, margin) = match surface {
        Surface::Main => (MAIN_WIDTH, MAIN_HEIGHT, 24.0),
        Surface::Hud => (HUD_WIDTH, HUD_HEIGHT, 18.0),
        Surface::Card => (CARD_WIDTH, CARD_HEIGHT, 20.0),
    };
    let margin_x = pixels(margin).min(area.width / 4);
    let margin_y = pixels(margin).min(area.height / 4);
    let width = pixels(design_width)
        .min(area.width.saturating_sub(margin_x * 2))
        .max(1);
    let height = pixels(design_height)
        .min(area.height.saturating_sub(margin_y * 2))
        .max(1);
    let (x, y) = match surface {
        Surface::Main => (
            area.x as i64 + (area.width.saturating_sub(width) / 2) as i64,
            area.y as i64 + (area.height.saturating_sub(height) / 2) as i64,
        ),
        Surface::Hud => (
            area.x as i64 + (area.width.saturating_sub(width) / 2) as i64,
            area.y as i64 + area.height.saturating_sub(height + margin_y) as i64,
        ),
        Surface::Card => (
            area.x as i64 + area.width.saturating_sub(width + margin_x) as i64,
            area.y as i64 + margin_y as i64,
        ),
    };
    Geometry {
        x: x.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
        y: y.clamp(i32::MIN as i64, i32::MAX as i64) as i32,
        width,
        height,
    }
}
