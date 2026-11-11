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

**Open from your account…** lists the account's projects
(`link_account_projects`), each with the folder on this computer linked
to it, if there is one; such a project opens that folder. For the others
the dialog asks where to keep the project
(`src/components/AccountProjectsDialog.tsx`):
`link_open_account_project` makes a folder in the projects folder, or,
with `choose`, shows a folder dialog and takes the folder only when it
is new or empty (`is_empty_folder`; `.DS_Store` and the like don't
count) and not linked already. Merging a project into a folder with
files is left out on purpose. Either way the folder is linked and an
empty document saved as the copy, so the first run writes every file the
server has into it. The folder dialog runs in Rust, so the webview never
names a path.

### From the browser

**Open in the desktop app…** in the browser's menu
(`src/components/OpenInDesktopDialog.tsx`) opens
`polemic://open?project=<id>`. The desktop app registers the `polemic`
scheme (`tauri-plugin-deep-link`; installers register it, and an
AppImage or a dev build claims it at start). `link::open_from_links`
keeps the project id from such a link (`project_in_link` accepts only a
plain id) and tells the window with `link://open-project`; the window
takes it with `link_take_pending_open`, at start too, since a link can
be what starts the app. It then opens the same dialog on that project,
so a link alone never writes a folder: the reader still chooses where
it goes, and a project that isn't in the signed-in account is refused
with a message. On Windows and Linux a link starts another copy of the
app with the link as its argument, as opening a second project does.

## People

The owner invites people by email from the toolbar's Share button
(`src/components/SharePopover.tsx`) or the Share dialog
(`src/components/SharePeople.tsx`); both work through
`src/hooks/useShare.ts` (`share_members`, `share_invite`,
`share_cancel_invite`, `share_set_role`, `share_remove_member` in
`share.rs`, and the same commands in `src/web/review.ts`). The server
emails a link to its invite page, which signs the person up or in. An
editor then opens the project from their account and syncs their own
folder, with a free account; what they add counts against the owner's
storage. Commenters read and comment in the browser.

On open, `share_info` gives the account's role: the run pushes only when
the role writes, so a member made commenter keeps their edits on their
computer. Someone invited sees whose project it is and can leave it
(`share_leave`): the server takes them out, and the folder stops syncing
and keeps its files. Publishing, review links and stopping sharing are
the owner's.

A folder with a Git remote, on a project other people work on, gets a
one-time notice: their changes already arrive through the server, and
conflict markers from a Git merge would reach everyone.

## Snapshots

The server keeps the project's document once an hour while it changes,
thins those out (all of the last two days, then one a day for 30 days)
and counts none of them toward storage. The **Online snapshots** panel
(`src/components/OnlineSnapshotsPanel.tsx`, **Snapshots** in the
browser) lists them with the published ones and the project as it was
before each restore (`share_history`). Comparing one with the project
reads its files (`share_history_files`) and the folder as the sync sees
it (`share_folder`), with unsaved edits on top
(`src/lib/online-snapshots.ts`); comments are left out.

The owner and editors restore the whole project or one file
(`share_restore`). The server keeps the project as it is first, then
makes the restore as edits on its copy, so every folder and browser gets
it and comments stay. The desktop app syncs before and after, so the
folder's saved changes are in the snapshot kept first and the restore
comes down at once. A 404 for a snapshot is about the snapshot, so it
never forgets the link.

## Tests

`src/lib/link-sync.test.ts` covers the run against an in-memory folder
and server document. `src/lib/link-sync.e2e.test.ts` syncs two folders and
a live browser client through a real server; it runs when
`POLEMIC_E2E_SERVER` and `POLEMIC_E2E_TOKEN` are set.
