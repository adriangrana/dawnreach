use std::{fs, path::Path};

fn write_dev_icon(path: &Path) -> std::io::Result<()> {
    if path.exists() {
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    const W: u8 = 16;
    const H: u8 = 16;
    const XOR_BYTES: u32 = (W as u32) * (H as u32) * 4;
    const AND_ROW_BYTES: u32 = 4; // 1-bit mask rows are padded to 32 bits.
    const AND_BYTES: u32 = AND_ROW_BYTES * (H as u32);
    const IMAGE_BYTES: u32 = 40 + XOR_BYTES + AND_BYTES;
    const IMAGE_OFFSET: u32 = 6 + 16;

    let mut ico = Vec::with_capacity((IMAGE_OFFSET + IMAGE_BYTES) as usize);

    // ICONDIR
    ico.extend_from_slice(&0u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());

    // ICONDIRENTRY
    ico.push(W);
    ico.push(H);
    ico.push(0);
    ico.push(0);
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&32u16.to_le_bytes());
    ico.extend_from_slice(&IMAGE_BYTES.to_le_bytes());
    ico.extend_from_slice(&IMAGE_OFFSET.to_le_bytes());

    // BITMAPINFOHEADER. ICO stores XOR + AND heights together, hence H * 2.
    ico.extend_from_slice(&40u32.to_le_bytes());
    ico.extend_from_slice(&(W as i32).to_le_bytes());
    ico.extend_from_slice(&((H as i32) * 2).to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&32u16.to_le_bytes());
    ico.extend_from_slice(&0u32.to_le_bytes());
    ico.extend_from_slice(&XOR_BYTES.to_le_bytes());
    ico.extend_from_slice(&0i32.to_le_bytes());
    ico.extend_from_slice(&0i32.to_le_bytes());
    ico.extend_from_slice(&0u32.to_le_bytes());
    ico.extend_from_slice(&0u32.to_le_bytes());

    // Tiny blue/gold Dawnreach placeholder icon for dev builds.
    // Rows in a DIB are stored bottom-up and pixels are BGRA.
    for y in 0..H {
        for x in 0..W {
            let border = x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2;
            let diagonal = x == y || x + y == W - 1;
            let (b, g, r) = if border || diagonal {
                (32u8, 176u8, 232u8) // gold-ish highlight in BGRA ordering
            } else {
                (118u8, 66u8, 24u8) // deep blue field
            };
            ico.extend_from_slice(&[b, g, r, 255]);
        }
    }

    // Fully opaque AND mask.
    ico.extend(std::iter::repeat(0u8).take(AND_BYTES as usize));

    fs::write(path, ico)
}

fn main() {
    let icon_path = Path::new("icons/icon.ico");
    write_dev_icon(icon_path).expect("failed to create Dawnreach development icon");
    tauri_build::build();
}
