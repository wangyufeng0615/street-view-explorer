package utils

import (
	"context"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"time"
)

// CheckProxyHealth 检查代理是否可用
func CheckProxyHealth(proxyURL string, timeout time.Duration) error {
	if proxyURL == "" {
		return nil // 没有设置代理，视为健康
	}

	// 解析代理URL
	proxy, err := url.Parse(proxyURL)
	if err != nil {
		return fmt.Errorf("解析代理URL失败: %w", err)
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

// SetupProxyWithFallback 设置代理并在代理不可用时回退到直接连接
func SetupProxyWithFallback(proxyURL string, timeout time.Duration) func(*http.Request) (*url.URL, error) {
	if proxyURL == "" {
		return nil // 没有设置代理
	}

	// 解析代理URL
	proxy, err := url.Parse(proxyURL)
	if err != nil {
		log.Printf("解析代理URL失败: %v，将不使用代理", err)
		return nil
	}

	// 检查代理健康状态
	err = CheckProxyHealth(proxyURL, timeout)
	if err != nil {
		log.Printf("代理健康检查失败: %v，将不使用代理", err)
		return nil
	}

	// 返回代理函数
	return http.ProxyURL(proxy)
}

// CheckTCPConnection 检查TCP连接是否可用
func CheckTCPConnection(host string, port int, timeout time.Duration) error {
	address := fmt.Sprintf("%s:%d", host, port)
	conn, err := net.DialTimeout("tcp", address, timeout)
	if err != nil {
		return fmt.Errorf("连接到 %s 失败: %w", address, err)
	}
	conn.Close()
	return nil
}
