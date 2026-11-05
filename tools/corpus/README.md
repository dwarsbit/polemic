# Corpus test

Compiles real LaTeX projects to find where Polemic fails and to collect compiler logs for better error help.

`catalog.json` lists 829 public projects from GitHub, arXiv and CTAN, in a mixed order. The [Corpus test workflow](../../.github/workflows/corpus.yml) compiles all of them every Monday, each one twice:

- **Polemic**: the files, main file and engine the editor would pick, sent to the compile service built from polemic-server
- **Plain latexmk**: the author's main file and engine in the same TeX Live, with the project's own latexmkrc and shell escape

A project that builds with plain latexmk but fails in Polemic points at something to fix in Polemic. A project that fails in both is a broken or incomplete document, and its log helps improve the error messages and fixes.

Results go to the `corpus-results` branch: `SUMMARY.md`, one line per project in `batches/`, and the logs and parsed issues per project in `logs/<id>/`.

`probe/` builds the editor's engine choice, upload rules and log parser from `src-tauri/src`, so the test uses the same code as the app.

A run stops taking new projects after about 5 hours, and the next run goes on from there. After the last project, the next run starts over. To test sooner, run the workflow by hand with a batch size.
