#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    context.set_default_window_icon(Some(tauri::include_image!(
        "../public/assets/icon/dawnreach.png"
    )));

    tauri::Builder::default()
        .run(context)
        .expect("error while running Dawnreach");
}
