use std::{
    fs,
    path::{Path, PathBuf},
};

use image::{imageops::FilterType, ImageBuffer, Rgb};

fn clamp_u8(v: f32) -> u8 {
    v.clamp(0.0, 255.0) as u8
}

fn radial_glow(x: u32, y: u32, cx: f32, cy: f32, radius: f32, intensity: f32) -> f32 {
    let dx = x as f32 - cx;
    let dy = y as f32 - cy;
    let d = (dx * dx + dy * dy).sqrt();
    let t = 1.0 - (d / radius);
    (t.max(0.0)).powf(2.2) * intensity
}

fn generate_bg(w: u32, h: u32) -> ImageBuffer<Rgb<u8>, Vec<u8>> {
    // Theme (from tailwind config)
    let base = (0x10 as f32, 0x10 as f32, 0x14 as f32); // #101014
    let cyan = (0x26 as f32, 0xbb as f32, 0xff as f32); // #26bbff
    let red = (0xff as f32, 0x3f as f32, 0x56 as f32); // #ff3f56

    let cx1 = w as f32 * 0.12;
    let cy1 = h as f32 * 0.30;
    let r1 = (w.max(h)) as f32 * 0.95;

    let cx2 = w as f32 * 0.75;
    let cy2 = h as f32 * 0.10;
    let r2 = (w.max(h)) as f32 * 0.85;

    let mut img = ImageBuffer::from_fn(w, h, |x, y| {
        let a1 = radial_glow(x, y, cx1, cy1, r1, 0.30);
        let a2 = radial_glow(x, y, cx2, cy2, r2, 0.22);

        let r = base.0 + cyan.0 * a1 + red.0 * a2;
        let g = base.1 + cyan.1 * a1 + red.1 * a2;
        let b = base.2 + cyan.2 * a1 + red.2 * a2;

        Rgb([clamp_u8(r), clamp_u8(g), clamp_u8(b)])
    });

    // 1px border like background.border (#303034)
    let br = Rgb([0x30, 0x30, 0x34]);
    for x in 0..w {
        img.put_pixel(x, 0, br);
        img.put_pixel(x, h - 1, br);
    }
    for y in 0..h {
        img.put_pixel(0, y, br);
        img.put_pixel(w - 1, y, br);
    }

    img
}

fn overlay_icon(
    base: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    icon: &image::DynamicImage,
    x0: u32,
    y0: u32,
    size: u32,
) {
    let icon = icon.resize(size, size, FilterType::Lanczos3).to_rgba8();
    for (x, y, px) in icon.enumerate_pixels() {
        let bx = x0 + x;
        let by = y0 + y;
        if bx >= base.width() || by >= base.height() {
            continue;
        }
        let a = px.0[3] as f32 / 255.0;
        if a <= 0.0 {
            continue;
        }
        let under = base.get_pixel(bx, by).0;
        let out_r = under[0] as f32 * (1.0 - a) + px.0[0] as f32 * a;
        let out_g = under[1] as f32 * (1.0 - a) + px.0[1] as f32 * a;
        let out_b = under[2] as f32 * (1.0 - a) + px.0[2] as f32 * a;
        base.put_pixel(
            bx,
            by,
            Rgb([clamp_u8(out_r), clamp_u8(out_g), clamp_u8(out_b)]),
        );
    }
}

fn pick_icon(tauri_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        tauri_dir.join("icons/128x128.png"),
        tauri_dir.join("icons/icon.png"),
        tauri_dir.join("icons/64x64.png"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

fn ensure_installer_assets() {
    let tauri_dir = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = tauri_dir.join("icons/installer");
    let _ = fs::create_dir_all(&out_dir);

    let icon_path = match pick_icon(&tauri_dir) {
        Some(p) => p,
        None => return,
    };

    let icon = match image::open(&icon_path) {
        Ok(i) => i,
        Err(_) => return,
    };

    // Only (re)generate if missing.
    let targets: [(&str, u32, u32, u32, u32, u32); 4] = [
        // name, w, h, icon_size, icon_x, icon_y
        ("nsis-header.bmp", 150, 57, 40, 10, 8),
        ("nsis-sidebar.bmp", 164, 314, 96, 16, 18),
        ("wix-banner.bmp", 493, 58, 40, 10, 9),
        ("wix-dialog.bmp", 493, 312, 96, 18, 22),
    ];

    for (name, w, h, icon_size, ix, iy) in targets {
        let path = out_dir.join(name);
        if path.exists() {
            continue;
        }
        let mut bg = generate_bg(w, h);
        overlay_icon(&mut bg, &icon, ix, iy, icon_size);
        let _ = bg.save_with_format(path, image::ImageFormat::Bmp);
    }
}

fn main() {
    // Generate NSIS/WiX installer UI images (header/sidebar/banner/dialog) so the installer
    // looks closer to the launcher theme.
    // If generation fails for any reason, we still proceed with the normal tauri build.
    ensure_installer_assets();

    // Workaround: if RC.EXE is missing (Windows SDK not installed),
    // the build will fail. We can't easily bypass it in tauri_build v2,
    // so we just run the default build.
    tauri_build::build()
}
