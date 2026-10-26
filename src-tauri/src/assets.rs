use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Asset tags, stored in the project's `.polemic/assets.json`
/// (project-relative path -> tags). Mirrors the comments file.
fn meta_file(project_dir: &Path) -> std::path::PathBuf {
    project_dir.join(".polemic").join("assets.json")
}

pub fn list(project_dir: &Path) -> HashMap<String, Vec<String>> {
    fs::read_to_string(meta_file(project_dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(
    project_dir: &Path,
    tags: &HashMap<String, Vec<String>>,
) -> Result<(), String> {
    let file = meta_file(project_dir);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create .polemic folder: {e}"))?;
    }
    let json = serde_json::to_string_pretty(tags).map_err(|e| e.to_string())?;
    crate::files::write_atomic(&file, json.as_bytes()).map_err(|e| format!("failed to write asset tags: {e}"))
}

/// System fonts for text in SVGs, loaded once per run (loading takes a
/// noticeable moment).
fn fontdb() -> std::sync::Arc<svg2pdf::usvg::fontdb::Database> {
    static FONTS: std::sync::OnceLock<std::sync::Arc<svg2pdf::usvg::fontdb::Database>> =
        std::sync::OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut db = svg2pdf::usvg::fontdb::Database::new();
            db.load_system_fonts();
            std::sync::Arc::new(db)
        })
        .clone()
}

/// Convert an SVG to a vector PDF that LaTeX can embed
/// (`\includegraphics` cannot read SVG). Relative references inside
/// the SVG resolve from its own folder.
pub fn svg_to_pdf(svg: &Path, pdf: &Path) -> Result<(), String> {
    let data = fs::read(svg).map_err(|e| format!("cannot read {}: {e}", svg.display()))?;
    let options = svg2pdf::usvg::Options {
        resources_dir: svg.parent().map(Path::to_path_buf),
        fontdb: fontdb(),
        ..Default::default()
    };
    let tree = svg2pdf::usvg::Tree::from_data(&data, &options)
        .map_err(|e| format!("cannot parse {}: {e}", svg.display()))?;
    let bytes = svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        svg2pdf::PageOptions::default(),
    )
    .map_err(|e| format!("cannot convert {}: {e}", svg.display()))?;
    crate::files::write_atomic(pdf, &bytes)
        .map_err(|e| format!("failed to write {}: {e}", pdf.display()))
}

/// Whether a path names an SVG file (by extension).
pub fn is_svg(path: &Path) -> bool {
    path.extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_svg_to_pdf() {
        let dir = std::env::temp_dir().join(format!("polemic-svg-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let svg = dir.join("shape.svg");
        fs::write(
            &svg,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>"#,
        )
        .unwrap();
        let pdf = dir.join("shape.pdf");
        svg_to_pdf(&svg, &pdf).unwrap();
        assert!(fs::read(&pdf).unwrap().starts_with(b"%PDF"));
        assert!(svg_to_pdf(&dir.join("missing.svg"), &pdf).is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn recognizes_svg_extensions() {
        assert!(is_svg(Path::new("a/b.SVG")));
        assert!(!is_svg(Path::new("b.svgz.png")));
    }
}
