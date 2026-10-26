use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    pub requires: Vec<Requirement>,
}

/// Something a template needs from the TeX distribution: a file to
/// look up (as `kpsewhich` does) and the package that ships it.
#[derive(Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    pub file: &'static str,
    pub package: &'static str,
}

pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// (path, content) pairs created for a new project.
    pub files: &'static [(&'static str, &'static str)],
    /// Publisher classes (and their fonts) come from the TeX
    /// distribution, not the app: nothing is bundled.
    pub requires: &'static [Requirement],
}

/// A sample entry the paper templates cite, so the first compile
/// shows a working bibliography.
const SAMPLE_BIB: &str = r"@article{knuth84,
  author = {Knuth, Donald E.},
  title = {Literate Programming},
  journal = {The Computer Journal},
  year = {1984},
  volume = {27},
  number = {2},
  pages = {97--111},
}
";

pub const TEMPLATES: [Template; 9] = [
    Template {
        id: "blank",
        name: "No template",
        description: "An empty project folder.",
        files: &[],
        requires: &[],
    },
    Template {
        id: "article",
        name: "Article",
        description: "A clean article with sections, math, and a bibliography.",
        files: &[
            (
                "main.tex",
                r"\documentclass[11pt]{article}

\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Untitled Article}
\author{}
\date{}

\begin{document}

\maketitle

\section{Introduction}

Write here.

\section{Conclusion}

\end{document}
",
            ),
        ],
        requires: &[],
    },
    Template {
        id: "report",
        name: "Report",
        description: "A structured report with a title page, abstract, and chapters.",
        files: &[
            (
                "main.tex",
                r"\documentclass[11pt]{report}

\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Untitled Report}
\author{}
\date{}

\begin{document}

\maketitle

\begin{abstract}
Summarize the report in a few sentences.
\end{abstract}

\tableofcontents

\chapter{Introduction}

Write here.

\chapter{Conclusion}

\end{document}
",
            ),
        ],
        requires: &[],
    },
    Template {
        id: "beamer",
        name: "Presentation",
        description: "A Beamer slide deck with a title slide and section frames.",
        files: &[
            (
                "main.tex",
                r"\documentclass{beamer}

\usepackage[T1]{fontenc}

\title{Untitled Presentation}
\author{}
\date{}

\begin{document}

\begin{frame}
  \titlepage
\end{frame}

\begin{frame}{Outline}
  \tableofcontents
\end{frame}

\section{Introduction}

\begin{frame}{Introduction}
  Write here.
\end{frame}

\section{Conclusion}

\begin{frame}{Conclusion}
  Summarize your findings.
\end{frame}

\end{document}
",
            ),
        ],
        requires: &[],
    },
    Template {
        id: "thesis",
        name: "Thesis",
        description: "A thesis with chapters in separate files and a title page.",
        files: &[
            (
                "main.tex",
                r"\documentclass[11pt]{report}

\usepackage[T1]{fontenc}
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{Untitled Thesis}
\author{}
\date{}

\begin{document}

\maketitle

\begin{abstract}
Summarize the thesis in a few sentences.
\end{abstract}

\tableofcontents

\input{chapters/introduction}
\input{chapters/conclusion}

\end{document}
",
            ),
            (
                "chapters/introduction.tex",
                r"\chapter{Introduction}

Write here.
",
            ),
            (
                "chapters/conclusion.tex",
                r"\chapter{Conclusion}

Summarize your findings.
",
            ),
        ],
        requires: &[],
    },
    Template {
        id: "acm",
        name: "ACM",
        description: "An ACM conference paper (acmart, sigconf); switch to acmsmall and others in the class options.",
        files: &[
            (
                "main.tex",
                r"\documentclass[sigconf]{acmart}

\begin{document}

\title{Untitled Paper}

\author{Author Name}
\affiliation{%
  \institution{Institution}
  \city{City}
  \country{Country}}
\email{author@example.com}

\begin{abstract}
Summarize the paper in a few sentences.
\end{abstract}

\keywords{keyword, keyword}

\maketitle

\section{Introduction}

Write here, and cite sources like this~\cite{knuth84}.

\section{Conclusion}

\bibliographystyle{ACM-Reference-Format}
\bibliography{references}

\end{document}
",
            ),
            ("references.bib", SAMPLE_BIB),
        ],
        requires: &[
            Requirement {
                file: "acmart",
                package: "acmart",
            },
            Requirement {
                file: "libertine",
                package: "libertine",
            },
            Requirement {
                file: "zi4",
                package: "inconsolata",
            },
            Requirement {
                file: "newtxmath",
                package: "newtx",
            },
        ],
    },
    Template {
        id: "ieee",
        name: "IEEE",
        description: "An IEEE conference paper (IEEEtran); use the journal option for transactions.",
        files: &[
            (
                "main.tex",
                r"\documentclass[conference]{IEEEtran}

\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{cite}

\begin{document}

\title{Untitled Paper}

\author{\IEEEauthorblockN{Author Name}
\IEEEauthorblockA{Institution\\
City, Country\\
author@example.com}}

\maketitle

\begin{abstract}
Summarize the paper in a few sentences.
\end{abstract}

\begin{IEEEkeywords}
keyword, keyword
\end{IEEEkeywords}

\section{Introduction}

Write here, and cite sources like this~\cite{knuth84}.

\section{Conclusion}

\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
",
            ),
            ("references.bib", SAMPLE_BIB),
        ],
        requires: &[
            Requirement {
                file: "IEEEtran",
                package: "ieeetran",
            },
        ],
    },
    Template {
        id: "lncs",
        name: "Springer LNCS",
        description: "A Springer Lecture Notes in Computer Science paper (llncs).",
        files: &[
            (
                "main.tex",
                r"\documentclass[runningheads]{llncs}

\usepackage[T1]{fontenc}
\usepackage{graphicx}

\begin{document}

\title{Untitled Paper}

\author{Author Name}
\authorrunning{A. Name}
\institute{Institution, City, Country\\
\email{author@example.com}}

\maketitle

\begin{abstract}
Summarize the paper in a few sentences.

\keywords{keyword \and keyword}
\end{abstract}

\section{Introduction}

Write here, and cite sources like this~\cite{knuth84}.

\section{Conclusion}

\bibliographystyle{splncs04}
\bibliography{references}

\end{document}
",
            ),
            ("references.bib", SAMPLE_BIB),
        ],
        requires: &[
            Requirement {
                file: "llncs",
                package: "llncs",
            },
        ],
    },
    Template {
        id: "elsevier",
        name: "Elsevier",
        description: "An Elsevier journal submission (elsarticle).",
        files: &[
            (
                "main.tex",
                r"\documentclass[preprint,12pt]{elsarticle}

\usepackage{amsmath}
\usepackage{graphicx}

\journal{Journal Name}

\begin{document}

\begin{frontmatter}

\title{Untitled Paper}

\author[inst1]{Author Name}
\ead{author@example.com}
\affiliation[inst1]{organization={Institution},
  city={City},
  country={Country}}

\begin{abstract}
Summarize the paper in a few sentences.
\end{abstract}

\begin{keyword}
keyword \sep keyword
\end{keyword}

\end{frontmatter}

\section{Introduction}

Write here, and cite sources like this~\cite{knuth84}.

\section{Conclusion}

\bibliographystyle{elsarticle-num}
\bibliography{references}

\end{document}
",
            ),
            ("references.bib", SAMPLE_BIB),
        ],
        requires: &[
            Requirement {
                file: "elsarticle",
                package: "elsarticle",
            },
        ],
    },
];

pub fn find(template_id: &str) -> Option<&'static Template> {
    TEMPLATES.iter().find(|t| t.id == template_id)
}

pub fn infos() -> Vec<TemplateInfo> {
    TEMPLATES
        .iter()
        .map(|t| TemplateInfo {
            id: t.id.to_string(),
            name: t.name.to_string(),
            description: t.description.to_string(),
            requires: t.requires.to_vec(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique() {
        let mut ids: Vec<_> = TEMPLATES.iter().map(|t| t.id).collect();
        ids.sort();
        ids.dedup();
        assert_eq!(ids.len(), TEMPLATES.len());
    }

    #[test]
    fn paper_templates_load_the_class_they_require() {
        for t in TEMPLATES.iter().filter(|t| !t.requires.is_empty()) {
            let main = t
                .files
                .iter()
                .find(|(path, _)| *path == "main.tex")
                .unwrap()
                .1;
            let class = t.requires[0].file;
            assert!(
                main.lines()
                    .next()
                    .unwrap()
                    .ends_with(&format!("{{{class}}}")),
                "{} should load {class}",
                t.id
            );
            assert!(t.files.iter().any(|(path, _)| *path == "references.bib"));
        }
    }
}
