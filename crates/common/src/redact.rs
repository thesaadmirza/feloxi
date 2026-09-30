//! Keep connection-string passwords out of logs, API errors and stored
//! error text. Broker clients often echo the URL they failed to use.

/// Replaces the password in every `scheme://user:password@host` in `text`
/// with `***`. Text without credentials comes back unchanged.
pub fn redact_url_credentials(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find("://") {
        let (head, tail) = rest.split_at(i + 3);
        out.push_str(head);
        // The authority ends at the first '/', whitespace or quote.
        let end = tail
            .find(|c: char| c == '/' || c.is_whitespace() || matches!(c, '\'' | '"' | ')' | ','))
            .unwrap_or(tail.len());
        let authority = &tail[..end];
        match authority.rfind('@') {
            Some(at) => {
                let userinfo = &authority[..at];
                match userinfo.find(':') {
                    Some(colon) => {
                        out.push_str(&userinfo[..colon]);
                        out.push_str(":***");
                    }
                    // A lone token (redis://secret@host) is the password.
                    None if !userinfo.is_empty() => out.push_str("***"),
                    None => {}
                }
                out.push_str(&authority[at..]);
            }
            None => out.push_str(authority),
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::redact_url_credentials as r;

    #[test]
    fn masks_passwords() {
        assert_eq!(r("amqp://guest:guest@rabbit:5672/vh"), "amqp://guest:***@rabbit:5672/vh");
        assert_eq!(
            r("Invalid URL: 'redis://:s3cret@cache:6379/0'"),
            "Invalid URL: 'redis://:***@cache:6379/0'"
        );
        assert_eq!(r("redis://token@host"), "redis://***@host");
        assert_eq!(r("a amqp://u:p@h b redis://x:y@z"), "a amqp://u:***@h b redis://x:***@z");
    }

    #[test]
    fn leaves_plain_text_alone() {
        assert_eq!(r("redis://localhost:6379/0"), "redis://localhost:6379/0");
        assert_eq!(r("connection refused"), "connection refused");
        assert_eq!(r("mail me at a@b.com"), "mail me at a@b.com");
    }
}
