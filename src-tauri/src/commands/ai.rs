use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;

use super::network_client;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResult {
    text: String,
    response_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStreamEvent {
    delta: String,
}

fn endpoint_url(base: &str, protocol: &str) -> String {
    let trimmed = base.trim().trim_end_matches('/');
    let suffix = if protocol == "chat_completions" {
        "chat/completions"
    } else {
        "responses"
    };
    if trimmed.ends_with(suffix) {
        trimmed.to_string()
    } else {
        format!("{}/{}", trimmed, suffix)
    }
}

fn models_url(base: &str) -> String {
    let trimmed = base.trim().trim_end_matches('/');
    let root = trimmed
        .strip_suffix("/chat/completions")
        .or_else(|| trimmed.strip_suffix("/responses"))
        .or_else(|| trimmed.strip_suffix("/models"))
        .unwrap_or(trimmed);
    format!("{root}/models")
}

fn extract_model_ids(body: &Value) -> Vec<String> {
    let entries = body
        .get("data")
        .or_else(|| body.get("models"))
        .unwrap_or(body)
        .as_array();
    let mut models = entries
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.as_str().or_else(|| {
                item.get("id")
                    .or_else(|| item.get("name"))
                    .and_then(Value::as_str)
            })
        })
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    models.sort_by_key(|id| id.to_lowercase());
    models.dedup();
    models
}

fn assistance_instruction(level: &str) -> &'static str {
    match level {
        "full" => "用户允许完整解法与代码。先简述算法和复杂度，再给出可运行代码，并指出易错点。",
        "guided" => "采用引导式辅导。分步骤解释关键观察与状态/算法选择，可给伪代码；除非用户明确追问，否则不要直接给完整可提交代码。",
        _ => "只提供最小必要提示。优先用问题和一个关键观察帮助用户自行推导，不泄露完整算法或代码。",
    }
}

fn extract_responses_text(body: &Value) -> String {
    body.get("output")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .flat_map(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn extract_api_error(body: &Value) -> Option<&str> {
    body.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| body.get("msg").and_then(Value::as_str))
        .or_else(|| body.get("message").and_then(Value::as_str))
        .or_else(|| body.get("error").and_then(Value::as_str))
}

fn request_body(
    model: &str,
    protocol: &str,
    assistance_level: &str,
    messages: &[AiMessage],
    context: &str,
    previous_response_id: Option<String>,
    stream: bool,
) -> Value {
    let instruction = format!(
        "你是 ACM/ICPC 训练助手。回答必须基于题目和用户学习档案，不虚构评测结果。{}\n\n当前上下文：\n{}",
        assistance_instruction(assistance_level), context
    );
    if protocol == "chat_completions" {
        let mut chat_messages = vec![json!({"role":"system", "content": instruction})];
        chat_messages.extend(
            messages
                .iter()
                .map(|m| json!({"role": m.role, "content": m.content})),
        );
        json!({"model": model, "messages": chat_messages, "stream": stream})
    } else {
        let mut body = json!({
            "model": model,
            "instructions": instruction,
            "input": messages.iter().map(|m| json!({"role":m.role, "content":m.content})).collect::<Vec<_>>(),
            "store": false,
            "stream": stream
        });
        if let Some(id) = previous_response_id.filter(|id| !id.is_empty()) {
            body["previous_response_id"] = Value::String(id);
        }
        body
    }
}

fn response_text(body: &Value, protocol: &str) -> String {
    if protocol == "chat_completions" {
        body.pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    } else {
        extract_responses_text(body)
    }
}

fn stream_delta(body: &Value, protocol: &str) -> Option<String> {
    if protocol == "chat_completions" {
        body.pointer("/choices/0/delta/content")
            .and_then(Value::as_str)
            .map(str::to_string)
    } else if body.get("type").and_then(Value::as_str) == Some("response.output_text.delta") {
        body.get("delta")
            .and_then(Value::as_str)
            .map(str::to_string)
    } else {
        None
    }
}

fn sse_data(event: &str) -> String {
    event
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n")
}

fn take_sse_event(buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    let (index, delimiter_length) = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4))
        .or_else(|| {
            buffer
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| (index, 2))
        })?;
    let event = buffer[..index].to_vec();
    buffer.drain(..index + delimiter_length);
    Some(event)
}

fn consume_stream_event(
    event: &[u8],
    protocol: &str,
    on_event: &Channel<AiStreamEvent>,
    text: &mut String,
    response_id: &mut Option<String>,
) -> Result<(), String> {
    let event = String::from_utf8_lossy(event);
    let data = sse_data(&event);
    if data.is_empty() || data == "[DONE]" {
        return Ok(());
    }
    let body: Value =
        serde_json::from_str(&data).map_err(|e| format!("AI 流式响应包含无效 JSON: {e}"))?;
    if let Some(message) = extract_api_error(&body) {
        return Err(format!("AI API: {message}"));
    }
    if response_id.is_none() {
        *response_id = body
            .pointer("/response/id")
            .or_else(|| body.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    if let Some(delta) = stream_delta(&body, protocol).filter(|delta| !delta.is_empty()) {
        text.push_str(&delta);
        on_event
            .send(AiStreamEvent { delta })
            .map_err(|e| format!("刷新助手页面失败: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_ai_models(endpoint: String, api_key: String) -> Result<Vec<String>, String> {
    if endpoint.trim().is_empty() {
        return Err("请先填写 API 地址".into());
    }
    if api_key.trim().is_empty() {
        return Err("请先填写 API Key".into());
    }

    let (client_builder, proxy_configured) = network_client::builder();
    let response = client_builder
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 AI 客户端失败: {e}"))?
        .get(models_url(&endpoint))
        .bearer_auth(api_key.trim())
        .send()
        .await
        .map_err(|e| {
            let proxy_hint = if proxy_configured {
                "（已通过系统代理连接）"
            } else {
                "（未检测到可用代理）"
            };
            format!("获取模型列表失败{proxy_hint}: {e}")
        })?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("模型列表返回内容不是有效 JSON: {e}"))?;
    if !status.is_success() {
        let message = extract_api_error(&body).unwrap_or("未知 API 错误");
        return Err(format!("模型列表 API {status}: {message}"));
    }

    let models = extract_model_ids(&body);
    if models.is_empty() {
        return Err("接口调用成功，但没有返回可用模型".into());
    }
    Ok(models)
}

#[tauri::command]
pub async fn ai_chat(
    endpoint: String,
    api_key: String,
    model: String,
    protocol: String,
    assistance_level: String,
    messages: Vec<AiMessage>,
    context: String,
    previous_response_id: Option<String>,
) -> Result<AiChatResult, String> {
    if endpoint.trim().is_empty() || model.trim().is_empty() {
        return Err("请配置 API 地址和模型".into());
    }
    if api_key.trim().is_empty() {
        return Err("请输入 API Key（仅保留在本次运行内存中）".into());
    }
    let url = endpoint_url(&endpoint, &protocol);
    let request_body = request_body(
        &model,
        &protocol,
        &assistance_level,
        &messages,
        &context,
        previous_response_id,
        false,
    );
    let (client_builder, proxy_configured) = network_client::builder();
    let response = client_builder
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 AI 客户端失败: {}", e))?
        .post(url)
        .bearer_auth(api_key.trim())
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            let proxy_hint = if proxy_configured {
                "（已通过系统代理连接）"
            } else {
                "（未检测到可用代理）"
            };
            format!("AI 请求失败{proxy_hint}: {e}")
        })?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("AI 返回内容不是有效 JSON: {}", e))?;
    if !status.is_success() {
        let message = extract_api_error(&body).unwrap_or("未知 API 错误");
        return Err(format!("AI API {}: {}", status, message));
    }
    let text = response_text(&body, &protocol);
    if text.trim().is_empty() {
        return Err("模型没有返回文本内容".into());
    }
    Ok(AiChatResult {
        text,
        response_id: body.get("id").and_then(Value::as_str).map(str::to_string),
    })
}

#[tauri::command]
pub async fn ai_chat_stream(
    endpoint: String,
    api_key: String,
    model: String,
    protocol: String,
    assistance_level: String,
    messages: Vec<AiMessage>,
    context: String,
    previous_response_id: Option<String>,
    on_event: Channel<AiStreamEvent>,
) -> Result<AiChatResult, String> {
    if endpoint.trim().is_empty() || model.trim().is_empty() {
        return Err("请配置 API 地址和模型".into());
    }
    if api_key.trim().is_empty() {
        return Err("请输入 API Key（仅保留在本次运行内存中）".into());
    }
    let request_body = request_body(
        &model,
        &protocol,
        &assistance_level,
        &messages,
        &context,
        previous_response_id,
        true,
    );
    let (client_builder, proxy_configured) = network_client::builder();
    let mut response = client_builder
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 AI 客户端失败: {e}"))?
        .post(endpoint_url(&endpoint, &protocol))
        .bearer_auth(api_key.trim())
        .json(&request_body)
        .send()
        .await
        .map_err(|e| {
            let proxy_hint = if proxy_configured {
                "（已通过系统代理连接）"
            } else {
                "（未检测到可用代理）"
            };
            format!("AI 请求失败{proxy_hint}: {e}")
        })?;
    let status = response.status();
    if !status.is_success() {
        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("AI 错误响应不是有效 JSON: {e}"))?;
        return Err(format!(
            "AI API {status}: {}",
            extract_api_error(&body).unwrap_or("未知 API 错误")
        ));
    }

    let is_event_stream = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/event-stream"));
    if !is_event_stream {
        let body: Value = response
            .json()
            .await
            .map_err(|e| format!("AI 返回内容不是有效 JSON: {e}"))?;
        let text = response_text(&body, &protocol);
        if text.trim().is_empty() {
            return Err("模型没有返回文本内容".into());
        }
        on_event
            .send(AiStreamEvent {
                delta: text.clone(),
            })
            .map_err(|e| format!("刷新助手页面失败: {e}"))?;
        return Ok(AiChatResult {
            text,
            response_id: body.get("id").and_then(Value::as_str).map(str::to_string),
        });
    }

    let mut buffer = Vec::new();
    let mut text = String::new();
    let mut response_id = None;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("读取 AI 流式响应失败: {e}"))?
    {
        buffer.extend_from_slice(&chunk);
        while let Some(event) = take_sse_event(&mut buffer) {
            consume_stream_event(&event, &protocol, &on_event, &mut text, &mut response_id)?;
        }
    }
    if !buffer.is_empty() {
        consume_stream_event(&buffer, &protocol, &on_event, &mut text, &mut response_id)?;
    }
    if text.trim().is_empty() {
        return Err("模型没有返回文本内容".into());
    }
    Ok(AiChatResult { text, response_id })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_protocol_endpoints_without_duplicate_suffixes() {
        assert_eq!(
            endpoint_url("https://api.openai.com/v1/", "responses"),
            "https://api.openai.com/v1/responses"
        );
        assert_eq!(
            endpoint_url(
                "https://example.test/v1/chat/completions",
                "chat_completions"
            ),
            "https://example.test/v1/chat/completions"
        );
    }

    #[test]
    fn builds_models_endpoint_from_base_or_request_endpoint() {
        assert_eq!(
            models_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url("https://example.test/v1/chat/completions"),
            "https://example.test/v1/models"
        );
        assert_eq!(
            models_url("https://example.test/v1/models"),
            "https://example.test/v1/models"
        );
    }

    #[test]
    fn extracts_and_sorts_common_model_list_shapes() {
        assert_eq!(
            extract_model_ids(&json!({"data":[{"id":"gpt-z"},{"id":"gpt-a"},{"id":"gpt-a"}]})),
            vec!["gpt-a", "gpt-z"]
        );
        assert_eq!(
            extract_model_ids(&json!({"models":[{"name":"model-b"}, "model-a"]})),
            vec!["model-a", "model-b"]
        );
    }

    #[test]
    fn assistance_levels_enforce_distinct_disclosure() {
        assert!(assistance_instruction("hint").contains("最小必要提示"));
        assert!(assistance_instruction("guided").contains("不要直接给完整"));
        assert!(assistance_instruction("full").contains("完整解法与代码"));
    }

    #[test]
    fn extracts_all_responses_output_text_parts() {
        let body = json!({
            "output": [
                {"content": [{"type": "output_text", "text": "第一段"}]},
                {"content": [{"type": "reasoning", "text": "隐藏"}, {"type": "output_text", "text": "第二段"}]}
            ]
        });
        assert_eq!(extract_responses_text(&body), "第一段\n第二段");
    }

    #[test]
    fn extracts_openai_and_gateway_error_messages() {
        assert_eq!(
            extract_api_error(&json!({"error":{"message":"OpenAI error"}})),
            Some("OpenAI error")
        );
        assert_eq!(
            extract_api_error(&json!({"code":401,"msg":"Invalid API Key!"})),
            Some("Invalid API Key!")
        );
    }

    #[test]
    fn extracts_streaming_deltas_for_both_protocols() {
        assert_eq!(
            stream_delta(
                &json!({"type":"response.output_text.delta","delta":"你好"}),
                "responses"
            ),
            Some("你好".into())
        );
        assert_eq!(
            stream_delta(
                &json!({"choices":[{"delta":{"content":"world"}}]}),
                "chat_completions"
            ),
            Some("world".into())
        );
    }

    #[test]
    fn keeps_partial_utf8_bytes_until_a_complete_sse_event() {
        let raw = "data: {\"delta\":\"中文\"}\n\nnext".as_bytes();
        let mut buffer = raw.to_vec();
        assert_eq!(
            String::from_utf8(take_sse_event(&mut buffer).unwrap()).unwrap(),
            "data: {\"delta\":\"中文\"}"
        );
        assert_eq!(buffer, b"next");
    }
}
