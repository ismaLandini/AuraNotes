/// Sanitizes a document title into a safe PDF filename stem, matching
/// `String(title || 'AuraNotes').replace(/[\\/:*?"<>|]/g, '-').slice(0, 120)`
/// from `desktop/main.cjs`.
pub fn sanitize_pdf_filename(title: &str) -> String {
    let trimmed = title.trim();
    let base = if trimmed.is_empty() {
        "AuraNotes"
    } else {
        trimmed
    };
    base.chars()
        .map(|c| match c {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .take(120)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_pdf_filename() {
        assert_eq!(sanitize_pdf_filename(""), "AuraNotes");
        assert_eq!(sanitize_pdf_filename("   "), "AuraNotes");
        assert_eq!(
            sanitize_pdf_filename("Analisi 1: Limiti / Derivate *2026*?"),
            "Analisi 1- Limiti - Derivate -2026--"
        );
        let long = "a".repeat(200);
        assert_eq!(sanitize_pdf_filename(&long).len(), 120);
    }
}
