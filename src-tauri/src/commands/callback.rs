use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::time::Duration;

pub(crate) fn callback_server() -> Result<(u16, std::sync::mpsc::Receiver<String>), String> {
    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("启动本地回调失败: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("获取回调端口失败: {}", e))?
        .port();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(180)));
            let mut line = String::new();
            let _ = BufReader::new(stream.try_clone().unwrap()).read_line(&mut line);
            let payload = line
                .split_once("GET /result?")
                .and_then(|(_, rest)| rest.split_once(' ').map(|(value, _)| value));
            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 2\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nOK";
            let _ = stream.write_all(response.as_bytes());
            if let Some(encoded) = payload {
                let decoded = urlencoding::decode(encoded)
                    .unwrap_or_else(|_| std::borrow::Cow::Borrowed(encoded))
                    .into_owned();
                let _ = tx.send(decoded);
            }
        }
    });
    Ok((port, rx))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;

    #[test]
    fn callback_server_decodes_large_unicode_get_payload() {
        let (port, rx) = callback_server().expect("callback server");
        let payload = format!(
            r#"{{"recordId":296017458,"title":"洛谷","cases":"{}"}}"#,
            "AC".repeat(20_000)
        );
        let encoded = urlencoding::encode(&payload);
        let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect callback");
        write!(
            stream,
            "GET /result?{encoded} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n"
        )
        .expect("write callback");
        let received = rx
            .recv_timeout(Duration::from_secs(2))
            .expect("receive callback");
        assert_eq!(received, payload);
    }
}
