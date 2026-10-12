//! Design sizes are logical pixels. Placement and native calls use target-DPI
//! physical pixels only, including negative origins and taskbar work areas.
pub const MAIN_WIDTH: f64 = 1060.0;
pub const MAIN_HEIGHT: f64 = 720.0;
pub const HUD_WIDTH: f64 = 140.0;
pub const HUD_HEIGHT: f64 = 64.0;
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
    geometry_with_frame(area, surface, 0, 0)
}

/// Main design dimensions refer to the CSS content viewport. Frame dimensions
/// are measured physical pixels, and are added before clamping/centering.
pub fn main_geometry(area: WorkArea, frame_width: u32, frame_height: u32) -> Geometry {
    geometry_with_frame(area, Surface::Main, frame_width, frame_height)
}

fn geometry_with_frame(
    area: WorkArea,
    surface: Surface,
    frame_width: u32,
    frame_height: u32,
) -> Geometry {
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
        .saturating_add(frame_width)
        .min(area.width.saturating_sub(margin_x * 2))
        .max(1);
    let height = pixels(design_height)
        .saturating_add(frame_height)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn main_preserves_the_design_content_viewport_at_each_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = WorkArea {
                x: -4096,
                y: -180,
                width: 4096,
                height: 3000,
                scale,
            };
            let frame_width = (16.0 * scale) as u32;
            let frame_height = (39.0 * scale) as u32;
            let rect = main_geometry(area, frame_width, frame_height);
            assert_eq!(
                rect.width - frame_width,
                (MAIN_WIDTH * scale).round() as u32
            );
            assert_eq!(
                rect.height - frame_height,
                (MAIN_HEIGHT * scale).round() as u32
            );
            assert!(rect.x < 0);
            assert!(rect.x >= area.x && rect.y >= area.y);
            assert!(rect.x as i64 + rect.width as i64 <= area.x as i64 + area.width as i64);
            assert!(rect.y as i64 + rect.height as i64 <= area.y as i64 + area.height as i64);
        }
    }

    #[test]
    fn small_scaled_work_area_clamps_the_entire_main_window() {
        let area = WorkArea {
            x: -1280,
            y: 36,
            width: 1280,
            height: 684,
            scale: 2.0,
        };
        let rect = main_geometry(area, 32, 78);
        assert_eq!((rect.width, rect.height), (1184, 588));
        assert!(rect.width - 32 < (MAIN_WIDTH * area.scale) as u32);
        assert!(rect.x >= area.x && rect.y >= area.y);
        assert!(rect.x as i64 + rect.width as i64 <= area.x as i64 + area.width as i64);
        assert!(rect.y as i64 + rect.height as i64 <= area.y as i64 + area.height as i64);
    }

    #[test]
    fn borderless_surfaces_keep_their_css_sizes_and_work_area_placement() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let area = WorkArea {
                x: -2560,
                y: 60,
                width: 2560,
                height: 1380,
                scale,
            };
            let hud = geometry(area, Surface::Hud);
            let card = geometry(area, Surface::Card);
            assert_eq!(hud.width, (HUD_WIDTH * scale).round() as u32);
            assert_eq!(hud.height, (HUD_HEIGHT * scale).round() as u32);
            assert_eq!(card.width, (CARD_WIDTH * scale).round() as u32);
            assert_eq!(card.height, (CARD_HEIGHT * scale).round() as u32);
            assert_eq!(hud.x, area.x + ((area.width - hud.width) / 2) as i32);
            assert!((hud.y as i64 + hud.height as i64) < area.y as i64 + area.height as i64);
        }
    }
}
