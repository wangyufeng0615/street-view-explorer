package utils

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// RedactProxyURL returns a proxy URL that is safe to log: user and password
// are removed. A string that cannot be parsed keeps only the part after the
// last "@".
func RedactProxyURL(proxyURL string) string {
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		if at := strings.LastIndex(proxyURL, "@"); at >= 0 {
			return "<redacted>@" + proxyURL[at+1:]
		}
		return proxyURL
	}
	if parsed.User == nil {
		return proxyURL
	}
	parsed.User = nil
	return parsed.String()
}

// proxyParseError drops the raw URL from url.Parse errors, which would
// otherwise carry proxy credentials into logs.
func proxyParseError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return fmt.Errorf("解析代理URL失败: %v", urlErr.Err)
	}
	return fmt.Errorf("解析代理URL失败")
}

// CheckProxyHealth 检查代理是否可用
func CheckProxyHealth(proxyURL string, timeout time.Duration) error {
	if proxyURL == "" {
		return nil // 没有设置代理，视为健康
	}

	// 解析代理URL
	proxy, err := url.Parse(proxyURL)
	if err != nil {
		return proxyParseError(err)
	}

	// 创建带有代理的HTTP客户端
	transport := &http.Transport{
		Proxy: http.ProxyURL(proxy),
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   timeout,
	}

	// 创建一个测试请求
	req, err := http.NewRequestWithContext(
		context.Background(),
		"HEAD",
		"https://www.google.com", // 使用Google作为测试目标
		nil,
	)
	if err != nil {
		return fmt.Errorf("创建测试请求失败: %w", err)
	}

	// 发送请求
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("通过代理发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	// 检查响应状态码
	if resp.StatusCode >= 400 {
		return fmt.Errorf("代理测试请求返回错误状态码: %d", resp.StatusCode)
	}

	return nil
}
