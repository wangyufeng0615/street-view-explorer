package utils

import (
	"errors"
	"testing"
)

func TestAppError(t *testing.T) {
	// 测试创建应用错误
	originalErr := errors.New("database connection failed")
	appErr := NewAppError(ErrorTypeInternal, "无法连接到数据库", originalErr)
	
	if appErr.Error() != "无法连接到数据库" {
		t.Errorf("期望用户消息为 '无法连接到数据库'，实际得到：%s", appErr.Error())
	}
	
	if appErr.InternalMsg != "无法连接到数据库: database connection failed" {
		t.Errorf("内部消息不正确：%s", appErr.InternalMsg)
	}
}

func TestWrapError(t *testing.T) {
	// 测试包装错误
	originalErr := errors.New("connection timeout")
	wrappedErr := WrapError(originalErr, "操作超时，请稍后重试")
	
	if wrappedErr.Error() != "操作超时，请稍后重试" {
		t.Errorf("期望用户消息为 '操作超时，请稍后重试'，实际得到：%s", wrappedErr.Error())
	}
	
	// 测试包装nil错误
	nilWrapped := WrapError(nil, "测试消息")
	if nilWrapped != nil {
		t.Error("包装nil错误应该返回nil")
	}
}

func TestIsTimeout(t *testing.T) {
	// 测试超时错误检测
	timeoutErr := NewAppError(ErrorTypeTimeout, "请求超时", nil)
	if !IsTimeout(timeoutErr) {
		t.Error("应该检测到超时错误")
	}
	
	// 测试包含timeout关键词的错误
	regularErr := errors.New("connection timeout")
	if !IsTimeout(regularErr) {
		t.Error("应该检测到包含timeout关键词的错误")
	}
	
	// 测试非超时错误
	otherErr := NewAppError(ErrorTypeInternal, "内部错误", nil)
	if IsTimeout(otherErr) {
		t.Error("不应该将非超时错误识别为超时")
	}
}

func TestIsNotFound(t *testing.T) {
	// 测试未找到错误检测
	notFoundErr := NewAppError(ErrorTypeNotFound, "资源不存在", nil)
	if !IsNotFound(notFoundErr) {
		t.Error("应该检测到未找到错误")
	}
	
	// 测试包含not found关键词的错误
	regularErr := errors.New("file not found")
	if !IsNotFound(regularErr) {
		t.Error("应该检测到包含not found关键词的错误")
	}
	
	// 测试非未找到错误
	otherErr := NewAppError(ErrorTypeInternal, "内部错误", nil)
	if IsNotFound(otherErr) {
		t.Error("不应该将非未找到错误识别为未找到")
	}
}

func TestSafeError(t *testing.T) {
	// 测试安全错误创建
	originalErr := errors.New("sensitive database connection string: user:pass@host")
	safeErr := SafeError(ErrorTypeExternal, "数据库连接失败", originalErr)
	
	// 确保敏感信息不在用户消息中
	if safeErr.Error() != "数据库连接失败" {
		t.Errorf("期望安全的用户消息，得到：%s", safeErr.Error())
	}
	
	// 确保原始错误被保留（用于内部日志）
	var appErr *AppError
	if errors.As(safeErr, &appErr) {
		if appErr.Err == nil {
			t.Error("原始错误应该被保留")
		}
	}
}