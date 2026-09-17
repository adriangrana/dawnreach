#[cfg(target_os = "windows")]
mod platform {
    use std::{ffi::c_void, iter::once, os::windows::ffi::OsStrExt, ptr::null_mut};

    const TARGET: &str = "Dawnreach/AuthToken";
    const CRED_TYPE_GENERIC: u32 = 1;
    const CRED_PERSIST_LOCAL_MACHINE: u32 = 2;
    const ERROR_NOT_FOUND: i32 = 1168;

    #[repr(C)]
    struct FileTime { low: u32, high: u32 }

    #[repr(C)]
    struct CredentialW {
        flags: u32,
        kind: u32,
        target_name: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        target_alias: *mut u16,
        user_name: *mut u16,
    }

    #[link(name = "Advapi32")]
    extern "system" {
        fn CredWriteW(credential: *const CredentialW, flags: u32) -> i32;
        fn CredReadW(target: *const u16, kind: u32, flags: u32, credential: *mut *mut CredentialW) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(buffer: *mut c_void);
    }

    fn wide(value: &str) -> Vec<u16> {
        std::ffi::OsStr::new(value).encode_wide().chain(once(0)).collect()
    }

    pub fn write(token: &str) -> Result<(), String> {
        let clean = token.trim();
        if clean.is_empty() { return delete(); }
        if clean.len() > 2048 { return Err("El token de sesión supera el tamaño permitido.".into()); }
        let mut target = wide(TARGET);
        let mut user = wide("Dawnreach Desktop");
        let bytes = clean.as_bytes();
        let credential = CredentialW {
            flags: 0,
            kind: CRED_TYPE_GENERIC,
            target_name: target.as_mut_ptr(),
            comment: null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: bytes.len() as u32,
            blob: bytes.as_ptr() as *mut u8,
            persist: CRED_PERSIST_LOCAL_MACHINE,
            attribute_count: 0,
            attributes: null_mut(),
            target_alias: null_mut(),
            user_name: user.as_mut_ptr(),
        };
        let ok = unsafe { CredWriteW(&credential, 0) };
        if ok == 0 { Err(format!("No se pudo guardar la sesión de Dawnreach: {}", std::io::Error::last_os_error())) } else { Ok(()) }
    }

    pub fn read() -> Result<Option<String>, String> {
        let target = wide(TARGET);
        let mut pointer: *mut CredentialW = null_mut();
        let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut pointer) };
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(ERROR_NOT_FOUND) { return Ok(None); }
            return Err(format!("No se pudo leer la sesión segura de Dawnreach: {error}"));
        }
        if pointer.is_null() { return Ok(None); }
        let result = unsafe {
            let credential = &*pointer;
            let bytes = if credential.blob.is_null() || credential.blob_size == 0 {
                &[][..]
            } else {
                std::slice::from_raw_parts(credential.blob as *const u8, credential.blob_size as usize)
            };
            String::from_utf8(bytes.to_vec()).map(Some).map_err(|_| "La sesión segura contiene datos inválidos.".to_string())
        };
        unsafe { CredFree(pointer as *mut c_void) };
        result
    }

    pub fn delete() -> Result<(), String> {
        let target = wide(TARGET);
        let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        if ok != 0 { return Ok(()); }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_NOT_FOUND) { Ok(()) }
        else { Err(format!("No se pudo eliminar la sesión segura de Dawnreach: {error}")) }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    pub fn write(_token: &str) -> Result<(), String> { Err("El almacén seguro nativo de Dawnreach requiere Windows.".into()) }
    pub fn read() -> Result<Option<String>, String> { Ok(None) }
    pub fn delete() -> Result<(), String> { Ok(()) }
}

#[tauri::command]
pub fn auth_token_read() -> Result<Option<String>, String> { platform::read() }
#[tauri::command]
pub fn auth_token_write(token: String) -> Result<(), String> { platform::write(&token) }
#[tauri::command]
pub fn auth_token_delete() -> Result<(), String> { platform::delete() }
