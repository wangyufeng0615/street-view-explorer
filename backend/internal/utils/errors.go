package utils

import (
	"errors"
	"fmt"
)

// ErrorType 定义错误类型
type ErrorType string

const (
	ErrorTypeValidation   ErrorType = "validation"
	ErrorTypeNotFound     ErrorType = "not_found"
	ErrorTypeInternal     ErrorType = "internal"
	ErrorTypeExternal     ErrorType = "external_service"
	ErrorTypeTimeout      ErrorType = "timeout"
	ErrorTypeRateLimit    ErrorType = "rate_limit"
	ErrorTypeUnauthorized ErrorType = "unauthorized"
)

// AppError 应用错误结构
type AppError struct {
	Type       ErrorType
	UserMsg    string // 给用户看的错误消息
	InternalMsg string // 内部日志用的详细错误消息
	Err        error  // 原始错误
}

func (e *AppError) Error() string {
	return e.UserMsg
}

func (e *AppError) Unwrap() error {
	return e.Err
}

// NewAppError 创建新的应用错误
func NewAppError(errType ErrorType, userMsg string, err error) *AppError {
	internalMsg := userMsg
	if err != nil {
		internalMsg = fmt.Sprintf("%s: %v", userMsg, err)
	}
	return &AppError{
		Type:        errType,
		UserMsg:     userMsg,
		InternalMsg: internalMsg,
		Err:         err,
	}
}

// WrapError 包装错误，隐藏内部细节
func WrapError(err error, userMsg string) error {
	if err == nil {
		return nil
	}
	
	// 如果已经是 AppError，保留类型但更新消息
	var appErr *AppError
	if errors.As(err, &appErr) {
		return &AppError{
			Type:        appErr.Type,
			UserMsg:     userMsg,
			InternalMsg: appErr.InternalMsg,
			Err:         appErr.Err,
		}
	}
	
	// 否则创建新的内部错误
	return NewAppError(ErrorTypeInternal, userMsg, err)
}

// SafeError 创建安全的用户友好错误消息
func SafeError(errType ErrorType, userMsg string, err error) error {
	// 记录详细错误到日志
	if err != nil {
		logger := SystemLogger()
		logger.Error("safe_error", userMsg, err, map[string]interface{}{
			"error_type": string(errType),
		})
	}
	
	return NewAppError(errType, userMsg, err)
}

// IsTimeout 检查是否是超时错误
func IsTimeout(err error) bool {
	if err == nil {
		return false
	}
	
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr.Type == ErrorTypeTimeout
	}
	
	// 检查是否包含超时关键词
	errStr := err.Error()
	return contains(errStr, "timeout") || contains(errStr, "deadline exceeded")
}

// IsNotFound 检查是否是未找到错误
func IsNotFound(err error) bool {
	if err == nil {
		return false
	}
	
	var appErr *AppError
	if errors.As(err, &appErr) {
		return appErr.Type == ErrorTypeNotFound
	}
	
	// 检查是否包含未找到关键词
	errStr := err.Error()
	return contains(errStr, "not found") || contains(errStr, "no such")
}

// contains 不区分大小写的字符串包含检查
func contains(s, substr string) bool {
	return len(s) >= len(substr) && 
		(s == substr || 
		 len(s) > len(substr) && 
		 (containsIgnoreCase(s, substr)))
}

func containsIgnoreCase(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	if len(s) < len(substr) {
		return false
	}
	
	// 简单的不区分大小写搜索
	for i := 0; i <= len(s)-len(substr); i++ {
		match := true
		for j := 0; j < len(substr); j++ {
			if s[i+j] != substr[j] && 
			   s[i+j] != substr[j]-32 && // 大写转小写
			   s[i+j] != substr[j]+32 {   // 小写转大写
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}