mod commands;

use commands::ai;
use commands::codeforces;
use commands::data_center;
use commands::debug_session;
use commands::diagnostics;
use commands::luogu;
use commands::network_session;
use commands::notes;
use commands::oj;
use commands::workspace;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args = std::env::args().collect::<Vec<_>>();
    if args.get(1).map(String::as_str) == Some("--isolated-webview") {
        run_isolated_webview(&args);
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(debug_session::DebugSessions::default())
        .manage(network_session::IsolatedWebSessions::default())
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
            workspace::save_local_statement,
            workspace::load_code_history,
            workspace::create_code_snapshot,
            workspace::create_code_branch,
            workspace::switch_code_branch,
            workspace::restore_code_snapshot,
            workspace::delete_code_snapshot,
            workspace::delete_code_branch,
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
            notes::pick_note_image,
            notes::paste_note_image,
            notes::load_note_image_assets,
            workspace::detect_toolchains,
            ai::list_ai_models,
            ai::ai_chat,
            oj::import_problem_url,
            oj::fetch_problems_luogu,
            oj::fetch_problems_atcoder,
            oj::fetch_problem_qoj,
            oj::fetch_qoj_archive,
            oj::fetch_contest_catalog,
            oj::inspect_external_account,
            oj::open_external_account,
            oj::external_account_session_status,
            oj::fetch_luogu_training_list,
            oj::fetch_luogu_training_detail,
            oj::analyze_contest_luogu,
            oj::load_imported_problems,
            oj::save_imported_problems,
            luogu::login_luogu_browser,
            luogu::inspect_luogu_account,
            luogu::fetch_luogu_solution,
            luogu::submit_luogu,
            luogu::fetch_luogu_record_detail,
            luogu::find_luogu_record_id,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn run_isolated_webview(args: &[String]) {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

    let platform = args.get(2).cloned().unwrap_or_default();
    let url = args.get(3).cloned().unwrap_or_default();
    let title = args.get(4).cloned().unwrap_or_else(|| "OJ 账号".into());
    if network_session::validate_session_url(&platform, &url).is_err() {
        return;
    }
    // 普通 AtCoder 登录会话若已经从持久 Cookie 恢复出用户名，则无需
    // 继续展示登录页。切换账号使用 /logout，不启用这段自动关闭逻辑。
    let auto_close_atcoder = platform == "atcoder"
        && reqwest::Url::parse(&url)
            .ok()
            .is_some_and(|value| value.path().trim_end_matches('/') == "/login");
    let (auto_close_script, mut auto_close_rx) = if auto_close_atcoder {
        match commands::callback::callback_server() {
            Ok((port, receiver)) => (
                format!(
                    r#"(function(){{
                      if(window.__acmAtcoderAccountCloser)return;window.__acmAtcoderAccountCloser=true;
                      var check=function(){{
                        if(window.__acmAtcoderAccountFound)return;
                        var link=Array.from(document.querySelectorAll('a[href^="/users/"],a[href*="atcoder.jp/users/"]')).find(function(item){{return /\/users\/[^/?#]+/.test(item.getAttribute('href')||'');}});
                        if(!link)return;
                        window.__acmAtcoderAccountFound=true;
                        new Image().src='http://127.0.0.1:{port}/result?logged-in';
                      }};
                      check();setInterval(check,400);window.addEventListener('load',check);
                    }})();"#
                ),
                Some(receiver),
            ),
            Err(_) => (String::new(), None),
        }
    } else {
        (String::new(), None)
    };
    let mut context = tauri::generate_context!();
    // The normal application declares its main window in tauri.conf.json.
    // Remove that declaration for this helper so only the requested OJ window
    // exists in the child process.
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_data_dir()?
                .join("webview-sessions")
                .join(&platform);
            std::fs::create_dir_all(&data_dir)?;
            let mut window_builder = WebviewWindowBuilder::new(
                app,
                "isolated_network_window",
                WebviewUrl::External(url.parse()?),
            )
            .title(format!("{title} · 关闭窗口即结束本次会话"))
            .inner_size(980.0, 760.0)
            .min_inner_size(720.0, 520.0)
            .data_directory(data_dir);
            if !auto_close_script.is_empty() {
                window_builder = window_builder.initialization_script(&auto_close_script);
            }
            let window = window_builder.build()?;
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::CloseRequested { .. }) {
                    app_handle.exit(0);
                }
            });
            if let Some(receiver) = auto_close_rx.take() {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    if receiver.recv().is_ok() {
                        app_handle.exit(0);
                    }
                });
            }
            Ok(())
        })
        .run(context)
        .expect("isolated webview failed");
}
