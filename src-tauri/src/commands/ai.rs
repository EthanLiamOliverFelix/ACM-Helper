use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    let instruction = format!(
        "你是 ACM/ICPC 训练助手。回答必须基于题目和用户学习档案，不虚构评测结果。{}\n\n当前上下文：\n{}",
        assistance_instruction(&assistance_level), context
    );
    let request_body = if protocol == "chat_completions" {
        let mut chat_messages = vec![json!({"role":"system", "content": instruction})];
        chat_messages.extend(
            messages
                .iter()
                .map(|m| json!({"role": m.role, "content": m.content})),
        );
        json!({"model": model, "messages": chat_messages})
    } else {
        let mut body = json!({
            "model": model,
            "instructions": instruction,
            "input": messages.iter().map(|m| json!({"role":m.role, "content":m.content})).collect::<Vec<_>>(),
            "store": false
        });
        if let Some(id) = previous_response_id.filter(|id| !id.is_empty()) {
            body["previous_response_id"] = Value::String(id);
        }
        body
    };
    let response = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("创建 AI 客户端失败: {}", e))?
        .post(url)
        .bearer_auth(api_key.trim())
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {}", e))?;
    let status = response.status();
    let body: Value = response
        .json()
        .await
        .map_err(|e| format!("AI 返回内容不是有效 JSON: {}", e))?;
    if !status.is_success() {
        let message = body
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("未知 API 错误");
        return Err(format!("AI API {}: {}", status, message));
    }
    let text = if protocol == "chat_completions" {
        body.pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    } else {
        extract_responses_text(&body)
    };
    if text.trim().is_empty() {
        return Err("模型没有返回文本内容".into());
    }
    Ok(AiChatResult {
        text,
        response_id: body.get("id").and_then(Value::as_str).map(str::to_string),
    })
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
}
