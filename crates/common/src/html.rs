//! HTML escaping for user-controlled text rendered into outbound emails.

/// Escape the five characters that can break out of HTML text or an attribute
/// value. Applied to anything a user can set (tenant names, rule names, alert
/// summaries) before it lands in an email body.
pub fn escape(s: &str) -> String {
    // `&` first, so the ampersands the later replacements introduce survive.
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_markup_characters() {
        assert_eq!(
            escape("<script>alert('x')</script>"),
            "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"
        );
        assert_eq!(escape(r#"A & B "quoted""#), "A &amp; B &quot;quoted&quot;");
    }

    #[test]
    fn leaves_plain_text_untouched() {
        assert_eq!(escape("Acme Payments"), "Acme Payments");
        assert_eq!(escape(""), "");
    }
}
