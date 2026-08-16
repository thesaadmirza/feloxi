//! HTML escaping for user-controlled text rendered into outbound emails.

/// Escape the five characters that can break out of HTML text or an attribute
/// value. Applied to anything a user can set (tenant names, rule names, alert
/// summaries) before it lands in an email body.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
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
