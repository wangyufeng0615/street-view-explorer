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
