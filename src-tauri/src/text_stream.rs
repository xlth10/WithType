/// Completion state shared by the SSE transport and its regression tests.
#[derive(Default)]
pub(crate) struct TextStream {
    pub text: String,
    chars: usize,
    done: bool,
    reason: Option<String>,
}
impl TextStream {
    pub fn push(&mut self, data: &str) -> Result<bool, String> {
        if data == "[DONE]" {
            self.done = true;
            self.validate()?;
            return Ok(true);
        }
        let value: serde_json::Value =
            serde_json::from_str(data).map_err(|_| "文字模型流式响应格式错误".to_string())?;
        if value.get("error").is_some() {
            return Err("文字模型流式处理失败".into());
        }
        if let Some(reason) = value
            .pointer("/choices/0/finish_reason")
            .and_then(|r| r.as_str())
        {
            if reason != "stop" {
                return Err("文字模型未完整生成成稿，请重试或缩短单次输入".into());
            }
            self.reason = Some(reason.into());
        }
        if let Some(piece) = value
            .pointer("/choices/0/delta/content")
            .and_then(|p| p.as_str())
        {
            self.chars += piece.chars().count();
            if self.chars > 60000 {
                return Err("文字模型输出超限，原文已保留".into());
            }
            self.text.push_str(piece);
        }
        Ok(false)
    }
    pub fn validate(&self) -> Result<(), String> {
        if !self.done && self.reason.as_deref() != Some("stop") {
            return Err("文字模型流式响应提前结束，原文已保留".into());
        }
        if self.text.trim().is_empty() {
            return Err("文字模型没有返回内容".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn complete_unicode_stream_requires_a_completion_marker() {
        let mut s = TextStream::default();
        s.push(r#"{"choices":[{"delta":{"content":"金额123，不批准。😀"}}]}"#)
            .unwrap();
        assert!(s.validate().is_err());
        assert!(s.push("[DONE]").unwrap());
        assert_eq!(s.text, "金额123，不批准。😀");
    }
    #[test]
    fn length_filter_error_and_malformed_streams_are_not_success() {
        for reason in ["length", "content_filter", "tool_calls"] {
            let mut s = TextStream::default();
            assert!(s
                .push(&format!(
                    r#"{{"choices":[{{"finish_reason":"{reason}"}}]}}"#
                ))
                .is_err());
        }
        assert!(TextStream::default()
            .push(r#"{"error":{"message":"private"}}"#)
            .is_err());
        assert!(TextStream::default().push("{bad").is_err());
        assert!(TextStream::default().push("[DONE]").is_err());
    }
    #[test]
    fn stop_reason_allows_gateways_without_done_and_output_limit_is_not_silent() {
        let mut s = TextStream::default();
        s.push(r#"{"choices":[{"delta":{"content":"完整正文"},"finish_reason":"stop"}]}"#)
            .unwrap();
        s.validate().unwrap();
        assert!(s
            .push(
                &serde_json::json!({"choices":[{"delta":{"content":"字".repeat(60001)}}]})
                    .to_string()
            )
            .is_err());
    }
}
