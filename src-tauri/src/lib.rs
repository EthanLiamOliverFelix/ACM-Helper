mod commands;

use commands::ai;
use commands::codeforces;
use commands::data_center;
use commands::debug_session;
use commands::diagnostics;
use commands::luogu;
use commands::notes;
use commands::oj;
use commands::workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(debug_session::DebugSessions::default())
        .invoke_handler(tauri::generate_handler![
            codeforces::login_via_browser,
            codeforces::fetch_problems_cf,
            codeforces::open_cf_manual_submit,
            codeforces::open_atcoder_manual_submit,
            codeforces::open_qoj_manual_submit,
            codeforces::restore_session,
            codeforces::inspect_cf_account,
            data_center::get_data_center_info,
            data_center::read_data_center_value,
            data_center::write_data_center_value,
            data_center::pick_data_center_directory,
            data_center::pick_toolchain_executable,
            data_center::migrate_data_center,
            data_center::create_data_center_backup,
            data_center::ensure_daily_data_center_backup,
            data_center::list_data_center_backups,
            data_center::restore_data_center_backup,
            data_center::export_data_center,
            data_center::import_data_center,
            diagnostics::record_oj_diagnostic,
            diagnostics::get_oj_diagnostics,
            diagnostics::export_oj_diagnostics,
            diagnostics::clear_oj_diagnostics,
            codeforces::fetch_problem_detail_cf,
            codeforces::analyze_contest_cf,
            workspace::load_draft,
            workspace::save_draft,
            workspace::list_drafts,
            workspace::create_empty_draft,
            workspace::list_workspace_entries,
            workspace::workspace_root_path,
            workspace::create_workspace_folder,
            workspace::create_workspace_file,
            workspace::read_workspace_file,
            workspace::save_workspace_file,
            workspace::rename_workspace_entry,
            workspace::delete_workspace_entry,
            workspace::paste_workspace_entry,
            workspace::run_code,
            workspace::run_test_suite,
            workspace::debug_code,
            debug_session::start_debug_session,
            debug_session::debug_session_action,
            debug_session::stop_debug_session,
            workspace::load_learning_profile,
            workspace::save_learning_profile,
            workspace::load_cf_translation,
            workspace::save_cf_translation,
            workspace::load_oj_translation,
            workspace::save_oj_translation,
            workspace::load_submissions,
            workspace::save_submissions,
            notes::notes_root_path,
            notes::list_note_entries,
            notes::read_note,
            notes::save_note,
            notes::create_note_folder,
            notes::create_note_file,
            notes::get_or_create_problem_note,
            notes::rename_note_entry,
            notes::delete_note_entry,
            notes::paste_note_entry,
            workspace::detect_toolchains,
            ai::ai_chat,
            oj::import_problem_url,
            oj::fetch_problems_luogu,
            oj::fetch_problems_atcoder,
            oj::fetch_problem_qoj,
            oj::fetch_qoj_archive,
            oj::fetch_luogu_training_list,
            oj::fetch_luogu_training_detail,
            oj::analyze_contest_luogu,
            oj::load_imported_problems,
            oj::save_imported_problems,
            luogu::login_luogu_browser,
            luogu::inspect_luogu_account,
            luogu::submit_luogu,
            luogu::fetch_luogu_record_detail,
            luogu::find_luogu_record_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
