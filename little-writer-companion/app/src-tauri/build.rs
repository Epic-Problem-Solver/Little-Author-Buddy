fn main() {
    // Listing the commands here turns on the app ACL. Each window's capability
    // then has to name the commands it may call. Commands absent from every
    // capability are rejected at runtime.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "race_arrived",
                "get_snapshot",
                "get_data",
                "get_warnings",
                "new_project",
                "start_next",
                "update_settings",
                "save_letter",
                "export_journal",
                "default_journal_dir",
                "open_settings",
                "quit_app",
                "track_window",
                "initial_tab",
                "finish_onboarding",
                "reopen_onboarding",
            ]),
        ),
    )
    .expect("failed to build tauri application");
}
