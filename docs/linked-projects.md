# Linked projects

A project shared from the desktop app syncs both ways with its copy on
the Polemic server, so the same project opens in the desktop app, in the
browser (`docs/web.md`) and on another computer. The server's Yjs
document (layout in `src/lib/project-doc.ts`) is the merge point; the
folder stays the place you work, and the server holds nothing a file
doesn't.

## Pieces

| Where                    | Does                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/link-sync.ts`   | One sync run: finish interrupted writes, fold changes made here into the editor's copy of the document, merge the server's changes and write them, push the rest  |
| `src/store/link.ts`      | Runs the sync while the project is open: on open, after every command that changes files (`onProjectFilesChanged` in `src/lib/tauri.ts`), on focus and on a timer |
| `src/store/project.ts`   | `applyFolderChanges`: open files follow what a sync wrote; unsaved edits merge with it (`mergeText`)                                                              |
| `src-tauri/src/link.rs`  | Keeps the copy of the document in the app data folder, writes the server's changes into the folder (never over a file changed since), fetches assets              |
| `src-tauri/src/share.rs` | The link (folder → server project, `twoWay`), the document and asset routes                                                                                       |

## How a run goes

1. Paths an interrupted run left unwritten are written from the copy.
2. When something changed here, the folder is read and its difference
   from the copy goes in as edits. Files keep their ids by path, and a
   rename made in the app moves the id, so history and comment anchors
   survive. Files the folder leaves out (`.gitignore`, over 50 MB) are
   not deleted from the project.
3. `document/sync` gives what the server has that the copy lacks. It is
   merged, and `diskChanges` lists the moves, writes and deletes for the
   folder. Before writing, the paths are saved as pending. A write is
   refused when the file changed since the copy last saw it; the run
   then merges the file's new text into the copy and writes the merge.
   A file deleted on the server but edited here stays.
4. What the server lacks goes up with `document/update`, assets first.

Only saved files sync. Unsaved edits stay in the editor and merge with
what arrives; saving sends them. The app syncs a project while it is
open: changes made while it is closed, on either side, sync on the next
open.

## Links from before

A folder shared before linked projects published one way (`twoWay:
false`, server source `desktop`, read-only in the browser). On its next
open, reviewers' comments are pulled first as a publish did, then
`link_enable` marks the project `linked` on the server and the first run
starts from the server's document, which the folder then overrides.

## Opening a project from the account

`link_open_account_project` makes a folder in the projects folder, links
it and saves an empty document as the copy, so the first run writes every
file the server has into the folder.

## Tests

`src/lib/link-sync.test.ts` covers the run against an in-memory folder
and server document. `src/lib/link-sync.e2e.test.ts` syncs two folders and
a live browser client through a real server; it runs when
`POLEMIC_E2E_SERVER` and `POLEMIC_E2E_TOKEN` are set.
