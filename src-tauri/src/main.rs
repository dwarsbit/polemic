// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Started by git as its askpass helper: answer and leave.
    if polemic_lib::git::run_askpass() {
        return;
    }
    polemic_lib::run()
}
