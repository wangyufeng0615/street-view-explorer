package openai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

const (
	apiEndpoint = "https://api.openai.com/v1/chat/completions"
	model       = "gpt-4o-mini"
)

type Client interface {
	GenerateLocationDescription(latitude, longitude float64) (string, error)
}

type client struct {
	apiKey     string
	httpClient *http.Client
}

type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func NewClient(apiKey string) Client {
	return &client{
		apiKey:     apiKey,
		httpClient: &http.Client{},
	}
}

func (c *client) GenerateLocationDescription(latitude, longitude float64) (string, error) {
	log.Printf("正在请求 OpenAI 生成位置描述 (%.6f, %.6f)", latitude, longitude)

	prompt := fmt.Sprintf(
		"请为经纬度 (%.6f, %.6f) 生成一段简短但生动的位置描述。"+
			"如果是著名地点，简要介绍其特点和历史意义；"+
			"如果是普通地点，描述当地的地理特征和有趣之处。"+
			"可以包含一个有趣的历史趣闻或当地特色。"+
			"要求：\n"+
			"1. 描述要生动有趣\n"+
			"2. 突出地点特色\n"+
			"3. 字数限制在100字以内",
		latitude, longitude,
	)

	reqBody := chatRequest{
		Model: model,
		Messages: []chatMessage{
			{
				Role:    "system",
				Content: "你是一位资深的开发者，同时也是一个环球旅行家，擅长用简洁生动的语言描述世界各地的特色。",
			},
			{
				Role:    "user",
				Content: prompt,
			},
		},
	}

	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("编码请求失败: %w", err)
	}

	req, err := http.NewRequest("POST", apiEndpoint, bytes.NewBuffer(reqJSON))
	if err != nil {
		return "", fmt.Errorf("创建请求失败: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	log.Printf("发送请求到 OpenAI API...")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		log.Printf("OpenAI API 请求失败: %v", err)
		return "", fmt.Errorf("发送请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("读取响应失败: %w", err)
	}

	var chatResp chatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		log.Printf("解析 OpenAI 响应失败: %v", err)
		return "", fmt.Errorf("解析响应失败: %w", err)
	}

	if chatResp.Error != nil {
		log.Printf("OpenAI API 返回错误: %s", chatResp.Error.Message)
		return "", fmt.Errorf("OpenAI API错误: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("OpenAI 未返回任何结果")
		return "", fmt.Errorf("OpenAI未返回任何结果")
	}

	desc := chatResp.Choices[0].Message.Content
	log.Printf("成功获取位置描述: %s", desc)
	return desc, nil
}
