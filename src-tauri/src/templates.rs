use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TemplateInfo {
    pub id: String,
    pub name: String,
    pub description: String,
}

pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    /// (path, content) pairs created for a new project.
    pub files: &'static [(&'static str, &'static str)],
}

pub const TEMPLATES: [Template; 5] = [
    Template {
        id: "blank",
        name: "No template",
        description: "An empty project folder.",
        files: &[],
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
        })
        .collect()
}
