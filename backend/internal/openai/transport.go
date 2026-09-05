package openai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

func (c *client) doChatCompletion(ctx context.Context, functionName string, reqJSON []byte, startTime time.Time) ([]byte, error) {
	var lastErr error
	var retryAfter time.Duration

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := retryDelay(attempt, retryAfter)
			log.Printf("[AI_RETRY] function=%s attempt=%d delay=%v previous_error=%v", functionName, attempt+1, delay, lastErr)
			if err := sleepWithContext(ctx, delay); err != nil {
				return nil, fmt.Errorf("OpenRouter 请求超时")
			}
		}
		retryAfter = 0

		req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(reqJSON))
		if err != nil {
			return nil, fmt.Errorf("创建请求失败: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("HTTP-Referer", "https://earth.wangyufeng.org")
		req.Header.Set("X-OpenRouter-Title", "Street View Explorer")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				log.Printf("[AI_ERROR] action=timeout function=%s duration=%v error=request_timeout", functionName, time.Since(startTime))
				return nil, fmt.Errorf("OpenRouter 请求超时")
			}
			lastErr = fmt.Errorf("发送请求失败: %w", err)
			log.Printf("[AI_ERROR] action=request_failed function=%s attempt=%d duration=%v error=%v", functionName, attempt+1, time.Since(startTime), err)
			if attempt < maxRetries {
				continue
			}
			return nil, lastErr
		}

		body, readErr := io.ReadAll(resp.Body)
		resp.Body.Close()
		if readErr != nil {
			lastErr = fmt.Errorf("读取响应失败: %w", readErr)
			log.Printf("[AI_ERROR] action=read_response_failed function=%s attempt=%d duration=%v error=%v", functionName, attempt+1, time.Since(startTime), readErr)
			if attempt < maxRetries {
				continue
			}
			return nil, lastErr
		}

		if resp.StatusCode == http.StatusOK {
			return body, nil
		}

		lastErr = fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
		log.Printf("[AI_ERROR] action=api_error function=%s attempt=%d duration=%v status=%d response=%s", functionName, attempt+1, time.Since(startTime), resp.StatusCode, truncateString(string(body), 200))
		if !isRetryableStatus(resp.StatusCode) || attempt >= maxRetries {
			return nil, lastErr
		}
		retryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
	}

	return nil, lastErr
}

func (c *client) doStreamingChatCompletion(ctx context.Context, functionName string, reqJSON []byte, startTime time.Time, onDelta func(string) error) (chatResponse, error) {
	var lastErr error
	var retryAfter time.Duration

	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			delay := retryDelay(attempt, retryAfter)
			log.Printf("[AI_RETRY] function=%s attempt=%d delay=%v previous_error=%v", functionName, attempt+1, delay, lastErr)
			if err := sleepWithContext(ctx, delay); err != nil {
				return chatResponse{}, fmt.Errorf("OpenRouter 请求超时")
			}
		}
		retryAfter = 0

		req, err := http.NewRequestWithContext(ctx, "POST", c.endpoint, bytes.NewReader(reqJSON))
		if err != nil {
			return chatResponse{}, fmt.Errorf("创建请求失败: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "text/event-stream")
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
		req.Header.Set("HTTP-Referer", "https://earth.wangyufeng.org")
		req.Header.Set("X-OpenRouter-Title", "Street View Explorer")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			if ctx.Err() == context.DeadlineExceeded {
				log.Printf("[AI_ERROR] action=timeout function=%s duration=%v error=request_timeout", functionName, time.Since(startTime))
				return chatResponse{}, fmt.Errorf("OpenRouter 请求超时")
			}
			lastErr = fmt.Errorf("发送请求失败: %w", err)
			log.Printf("[AI_ERROR] action=request_failed function=%s attempt=%d duration=%v error=%v", functionName, attempt+1, time.Since(startTime), err)
			if attempt < maxRetries {
				continue
			}
			return chatResponse{}, lastErr
		}

		if resp.StatusCode != http.StatusOK {
			body, readErr := io.ReadAll(resp.Body)
			resp.Body.Close()
			if readErr != nil {
				return chatResponse{}, fmt.Errorf("读取响应失败: %w", readErr)
			}
			lastErr = fmt.Errorf("API 请求失败 (状态码: %d): %s", resp.StatusCode, string(body))
			log.Printf("[AI_ERROR] action=api_error function=%s attempt=%d duration=%v status=%d response=%s", functionName, attempt+1, time.Since(startTime), resp.StatusCode, truncateString(string(body), 200))
			if !isRetryableStatus(resp.StatusCode) || attempt >= maxRetries {
				return chatResponse{}, lastErr
			}
			retryAfter = parseRetryAfter(resp.Header.Get("Retry-After"))
			continue
		}
		log.Printf("[AI] action=upstream_stream_open function=%s attempt=%d duration=%v", functionName, attempt+1, time.Since(startTime))

		result, streamErr := readChatCompletionStream(resp.Body, onDelta)
		resp.Body.Close()
		if streamErr != nil {
			log.Printf("[AI_ERROR] action=stream_failed function=%s duration=%v error=%v", functionName, time.Since(startTime), streamErr)
			return chatResponse{}, streamErr
		}
		log.Printf("[AI] action=upstream_identity function=%s generation_id=%q reported_provider=%q", functionName, truncateString(result.ID, 128), truncateString(result.Provider, 80))
		return result, nil
	}

	return chatResponse{}, lastErr
}

func readChatCompletionStream(body io.Reader, onDelta func(string) error) (chatResponse, error) {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)

	var content strings.Builder
	var annotations []annotation
	var usage completionUsage
	var generationID, provider string

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ":") || !strings.HasPrefix(line, "data:") {
			continue
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" || payload == "[DONE]" {
			continue
		}
		var chunk chatStreamChunk
		if err := json.Unmarshal([]byte(payload), &chunk); err != nil {
			return chatResponse{}, fmt.Errorf("解析流式响应失败: %w", err)
		}
		if chunk.Error != nil {
			return chatResponse{}, fmt.Errorf("AI API错误: %s", chunk.Error.Message)
		}
		if chunk.ID != "" {
			generationID = chunk.ID
		}
		if chunk.Provider != "" {
			provider = chunk.Provider
		}
		if chunk.Usage.webSearchRequests() > 0 {
			usage = chunk.Usage
		}
		for _, choice := range chunk.Choices {
			delta := choice.Delta.Content
			if delta == "" && choice.Message.Content != "" {
				delta = choice.Message.Content
			}
			if delta != "" {
				content.WriteString(delta)
				if onDelta != nil {
					if err := onDelta(delta); err != nil {
						return chatResponse{}, fmt.Errorf("向客户端发送流式响应失败: %w", err)
					}
				}
			}
			annotations = append(annotations, choice.Delta.Annotations...)
			annotations = append(annotations, choice.Message.Annotations...)
		}
	}
	if err := scanner.Err(); err != nil {
		return chatResponse{}, fmt.Errorf("读取流式响应失败: %w", err)
	}

	var result chatResponse
	result.ID, result.Provider = generationID, provider
	result.Choices = append(result.Choices, struct {
		Message struct {
			Content     string       `json:"content"`
			Annotations []annotation `json:"annotations,omitempty"`
		} `json:"message"`
	}{})
	result.Choices[0].Message.Content = content.String()
	result.Choices[0].Message.Annotations = annotations
	result.Usage = usage
	return result, nil
}

func retryDelay(attempt int, retryAfter time.Duration) time.Duration {
	if retryAfter > 0 {
		return retryAfter
	}
	return retryBaseDelay * time.Duration(1<<(attempt-1))
}

func sleepWithContext(ctx context.Context, delay time.Duration) error {
	if delay <= 0 {
		return nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func parseRetryAfter(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := time.ParseDuration(value + "s"); err == nil {
		return seconds
	}
	if retryAt, err := http.ParseTime(value); err == nil {
		if delay := time.Until(retryAt); delay > 0 {
			return delay
		}
	}
	return 0
}

func isRetryableStatus(status int) bool {
	switch status {
	case http.StatusRequestTimeout, http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
		return true
	default:
		return false
	}
}

// truncateString 截断字符串到指定长度
