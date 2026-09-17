mod secure_auth;

use secure_auth::{auth_token_delete, auth_token_read, auth_token_write};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    context.set_default_window_icon(Some(tauri::include_image!(
        "../public/assets/icon/dawnreach.png"
    )));

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            auth_token_read,
            auth_token_write,
            auth_token_delete
        ])
        .run(context)
        .expect("error while running Dawnreach");
}
