use clickhouse::Client;

pub fn create_ch_client(url: &str) -> Client {
    create_ch_client_with_auth(url, None, None)
}

pub fn create_ch_client_with_auth(
    url: &str,
    user: Option<&str>,
    password: Option<&str>,
) -> Client {
    let mut client = Client::default().with_url(url).with_database("feloxi");
    if let Some(u) = user {
        client = client.with_user(u);
    }
    if let Some(p) = password {
        client = client.with_password(p);
    }
    client
}
