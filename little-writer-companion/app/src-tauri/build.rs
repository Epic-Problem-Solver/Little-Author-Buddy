fn main() {
    // Listing the commands here turns on the app ACL. Each window's capability
    // then has to name the commands it may call. Commands absent from every
    // capability are rejected at runtime.
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "race_arrived",
                "get_snapshot",
                "list_hats",
                "list_games",
                "game_catalog",
                "open_games",
                "play_game",
                "focus_start",
                "focus_pause",
                "focus_back",
                "focus_finish",
                "focus_tag",
                "set_focus_minutes",
                "place_tag_hit",
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
                "get_welcome",
                "dismiss_welcome",
                "check_update",
                "open_download_page",
                "activate_supporter",
                "dash_event",
            ]),
        ),
    )
    .expect("failed to build tauri application");
}
