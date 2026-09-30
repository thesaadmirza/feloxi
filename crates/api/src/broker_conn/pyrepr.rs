//! Parse the Python literal reprs Celery puts in task events.
//!
//! Celery reports a task's `args` and `kwargs` as `saferepr()` strings, e.g.
//! `"('order_1', 919.25, {'currency': 'USD'})"`. To publish a retry we need
//! them back as JSON values. This covers the literal subset `repr()` produces
//! for JSON-serializable data: None/True/False, ints, floats, str, list,
//! tuple and dict with string keys. Anything else (a truncated repr ending in
//! `...`, a `datetime(...)`, bytes) is an error, never a guess.

use serde_json::{Map, Number, Value};

pub fn parse(src: &str) -> Result<Value, String> {
    let mut p = Parser { s: src.as_bytes(), i: 0 };
    p.ws();
    let v = p.value()?;
    p.ws();
    if p.i != p.s.len() {
        return Err(format!("unexpected text at position {}", p.i));
    }
    Ok(v)
}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    fn ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn eat(&mut self, c: u8) -> bool {
        if self.peek() == Some(c) {
            self.i += 1;
            true
        } else {
            false
        }
    }

    fn keyword(&mut self, kw: &str) -> bool {
        let end = self.i + kw.len();
        let is_kw = self.s.get(self.i..end) == Some(kw.as_bytes())
            && !matches!(self.s.get(end), Some(c) if c.is_ascii_alphanumeric() || *c == b'_');
        if is_kw {
            self.i = end;
        }
        is_kw
    }

    fn value(&mut self) -> Result<Value, String> {
        self.ws();
        match self.peek() {
            Some(b'[') => {
                self.i += 1;
                Ok(Value::Array(self.items(b']')?))
            }
            Some(b'(') => {
                self.i += 1;
                Ok(Value::Array(self.items(b')')?))
            }
            Some(b'{') => self.dict(),
            Some(b'\'' | b'"') => self.string().map(Value::String),
            Some(b'-' | b'+' | b'0'..=b'9' | b'.') => self.number(),
            _ if self.keyword("None") => Ok(Value::Null),
            _ if self.keyword("True") => Ok(Value::Bool(true)),
            _ if self.keyword("False") => Ok(Value::Bool(false)),
            Some(c) => Err(format!(
                "unsupported value starting with {:?} at position {}",
                c as char, self.i
            )),
            None => Err("unexpected end of input".into()),
        }
    }

    /// Comma-separated values up to `close`; allows a trailing comma, as in `(x,)`.
    fn items(&mut self, close: u8) -> Result<Vec<Value>, String> {
        let mut out = Vec::new();
        loop {
            self.ws();
            if self.eat(close) {
                return Ok(out);
            }
            out.push(self.value()?);
            self.ws();
            if self.eat(b',') {
                continue;
            }
            self.ws();
            if self.eat(close) {
                return Ok(out);
            }
            return Err(format!("expected ',' or '{}' at position {}", close as char, self.i));
        }
    }

    fn dict(&mut self) -> Result<Value, String> {
        self.i += 1; // '{'
        let mut map = Map::new();
        loop {
            self.ws();
            if self.eat(b'}') {
                return Ok(Value::Object(map));
            }
            let key = match self.value()? {
                Value::String(s) => s,
                Value::Number(n) => n.to_string(),
                other => return Err(format!("unsupported dict key {other}")),
            };
            self.ws();
            if !self.eat(b':') {
                // `{1, 2}` is a set, which JSON can't express.
                return Err(format!("expected ':' at position {}", self.i));
            }
            let v = self.value()?;
            map.insert(key, v);
            self.ws();
            if self.eat(b',') {
                continue;
            }
            if self.eat(b'}') {
                return Ok(Value::Object(map));
            }
            return Err(format!("expected ',' or '}}' at position {}", self.i));
        }
    }

    fn string(&mut self) -> Result<String, String> {
        let quote = self.s[self.i];
        self.i += 1;
        let mut out = String::new();
        loop {
            let c = self.peek().ok_or("unterminated string")?;
            self.i += 1;
            if c == quote {
                return Ok(out);
            }
            if c != b'\\' {
                // Copy a whole UTF-8 sequence.
                let start = self.i - 1;
                let len = utf8_len(c);
                let bytes = self.s.get(start..start + len).ok_or("invalid UTF-8")?;
                out.push_str(std::str::from_utf8(bytes).map_err(|_| "invalid UTF-8")?);
                self.i = start + len;
                continue;
            }
            let e = self.peek().ok_or("unterminated escape")?;
            self.i += 1;
            match e {
                b'\\' => out.push('\\'),
                b'\'' => out.push('\''),
                b'"' => out.push('"'),
                b'n' => out.push('\n'),
                b't' => out.push('\t'),
                b'r' => out.push('\r'),
                b'0' => out.push('\0'),
                b'a' => out.push('\x07'),
                b'b' => out.push('\x08'),
                b'f' => out.push('\x0c'),
                b'v' => out.push('\x0b'),
                b'x' => out.push(self.hex_char(2)?),
                b'u' => out.push(self.hex_char(4)?),
                b'U' => out.push(self.hex_char(8)?),
                other => return Err(format!("unsupported escape \\{}", other as char)),
            }
        }
    }

    fn hex_char(&mut self, n: usize) -> Result<char, String> {
        let hex = self.s.get(self.i..self.i + n).ok_or("short escape")?;
        self.i += n;
        let code = u32::from_str_radix(std::str::from_utf8(hex).map_err(|_| "bad escape")?, 16)
            .map_err(|_| "bad escape")?;
        char::from_u32(code).ok_or_else(|| "invalid code point".to_string())
    }

    fn number(&mut self) -> Result<Value, String> {
        let start = self.i;
        while matches!(self.peek(), Some(b'0'..=b'9' | b'-' | b'+' | b'.' | b'e' | b'E' | b'_')) {
            self.i += 1;
        }
        let text: String =
            std::str::from_utf8(&self.s[start..self.i]).unwrap_or("").replace('_', "");
        if text == "..." || text.ends_with("...") {
            return Err("the value was truncated".into());
        }
        if let Ok(n) = text.parse::<i64>() {
            return Ok(Value::Number(n.into()));
        }
        text.parse::<f64>()
            .ok()
            .and_then(Number::from_f64)
            .map(Value::Number)
            .ok_or_else(|| format!("invalid number {text:?}"))
    }
}

fn utf8_len(first: u8) -> usize {
    match first {
        0xF0..=0xF7 => 4,
        0xE0..=0xEF => 3,
        0xC0..=0xDF => 2,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::parse;
    use serde_json::json;

    #[test]
    fn scalars() {
        assert_eq!(parse("None").unwrap(), json!(null));
        assert_eq!(parse("True").unwrap(), json!(true));
        assert_eq!(parse("-12").unwrap(), json!(-12));
        assert_eq!(parse("919.25").unwrap(), json!(919.25));
        assert_eq!(parse("1e3").unwrap(), json!(1000.0));
    }

    #[test]
    fn containers() {
        assert_eq!(parse("('order_1', 919.25, 'USD')").unwrap(), json!(["order_1", 919.25, "USD"]));
        assert_eq!(parse("('only',)").unwrap(), json!(["only"]));
        assert_eq!(parse("()").unwrap(), json!([]));
        assert_eq!(
            parse("['https://cdn.example.com/a.jpg', ['320x240', '640x480']]").unwrap(),
            json!(["https://cdn.example.com/a.jpg", ["320x240", "640x480"]])
        );
        assert_eq!(
            parse("{'user_id': 'u1', 'opts': {'dry_run': False, 'n': None}}").unwrap(),
            json!({"user_id": "u1", "opts": {"dry_run": false, "n": null}})
        );
        assert_eq!(parse("{}").unwrap(), json!({}));
    }

    #[test]
    fn strings_and_escapes() {
        assert_eq!(parse(r#""it's""#).unwrap(), json!("it's"));
        assert_eq!(parse(r"'say \'hi\''").unwrap(), json!("say 'hi'"));
        assert_eq!(parse(r"'a\nb\\c'").unwrap(), json!("a\nb\\c"));
        assert_eq!(parse(r"'caf\xe9 ☃'").unwrap(), json!("café ☃"));
        assert_eq!(parse("'naïve'").unwrap(), json!("naïve"));
    }

    #[test]
    fn rejects_what_json_cannot_hold() {
        assert!(parse("('a', ...)").is_err());
        assert!(parse("['a', 'b'...").is_err());
        assert!(parse("datetime.datetime(2026, 1, 1)").is_err());
        assert!(parse("{1, 2}").is_err());
        assert!(parse("b'raw'").is_err());
        assert!(parse("('a', 'b') extra").is_err());
    }
}
